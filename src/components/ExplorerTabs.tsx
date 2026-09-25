import { For, Show, createSignal, onCleanup } from "solid-js";
import { CloseIcon } from "./icons";
import { baseName } from "../lib/fs";

export type ExplorerTab = {
  id: string;
  path: string;
  splitPanePaths?: string[];
  splitCols?: number;
};

type ExplorerTabsProps = {
  tabs: ExplorerTab[];
  activeTabId: string;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (from: number, to: number) => void;
};

const DRAG_THRESHOLD_PX = 5;

export function ExplorerTabs(props: ExplorerTabsProps) {
  // Pointer-based reorder rather than HTML5 DnD: Tauri's native drag-drop
  // handling (needed for Explorer→Flurer drag-in) suppresses HTML5 drag
  // events in WebView2 on Windows, so draggable/onDragStart never fire there.
  const [dragIndex, setDragIndex] = createSignal(-1);
  let stripRef: HTMLDivElement | undefined;
  let drag: { index: number; startX: number; startY: number; moved: boolean } | null = null;
  let suppressClick = false;

  function endDrag() {
    drag = null;
    setDragIndex(-1);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      drag.moved = true;
      setDragIndex(drag.index);
    }
    // Live reorder: count how many tab midpoints the pointer has passed —
    // that's the dragged tab's target slot (adjusted for its own removal
    // when moving right). Tab widths differ, so midpoints are read from the
    // live DOM each move rather than assuming uniform widths.
    const els = Array.from(stripRef?.querySelectorAll<HTMLElement>(".explorer-tab") ?? []);
    if (els.length < 2) return;
    let passed = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) passed++;
    }
    const target = passed > drag.index ? passed - 1 : passed;
    if (target !== drag.index && target >= 0 && target < props.tabs.length) {
      props.onReorder(drag.index, target);
      drag.index = target;
    }
  }

  function onPointerUp() {
    if (drag?.moved) suppressClick = true;
    endDrag();
  }

  function startDrag(e: PointerEvent, index: number) {
    drag = { index, startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  onCleanup(endDrag);

  return (
    <div class="explorer-tabs" role="tablist" ref={stripRef}>
      <For each={props.tabs}>
        {(tab, i) => (
          <div
            class="explorer-tab"
            classList={{ active: tab.id === props.activeTabId, dragging: dragIndex() === i() }}
            role="tab"
            aria-selected={tab.id === props.activeTabId}
            title={tab.path}
            onClick={() => {
              if (suppressClick) {
                suppressClick = false;
                return;
              }
              props.onSwitch(tab.id);
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                // Middle-click closes, same as every browser's tab strip.
                e.preventDefault();
                props.onClose(tab.id);
                return;
              }
              // Left button on the tab body starts a possible drag; the
              // close button stays untouched.
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest(".explorer-tab-close")) return;
              startDrag(e, i());
            }}
          >
            <span class="explorer-tab-label">{baseName(tab.path) || tab.path}</span>
            <Show when={props.tabs.length > 1}>
              <button
                type="button"
                class="explorer-tab-close"
                aria-label={`Close tab: ${tab.path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                <CloseIcon size={10} />
              </button>
            </Show>
          </div>
        )}
      </For>
      <button type="button" class="explorer-tab-new" aria-label="New tab" title="New tab" onClick={props.onNew}>
        +
      </button>
    </div>
  );
}
