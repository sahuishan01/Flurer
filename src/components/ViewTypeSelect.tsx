import { createEffect, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { Portal } from "solid-js/web";
import { CheckIcon, ChevronDownIcon } from "./icons";
import type { ExplorerViewType } from "../lib/view";

export type ViewTypeSelectProps = {
  viewTypes: ExplorerViewType[];
  value: string;
  onChange?: (id: string) => void;
};

// A selector for the explorer's listing "view type" (Details, Grid, …). Backed
// by a registry (EXPLORER_VIEW_TYPES) so new view types appear here for free —
// the trigger shows the active one and the menu lists every registered type
// with a radio checkmark. The menu is portaled to <body> to dodge the glass
// backdrop-filter ancestor in .file-list, which would mis-position any
// position:fixed descendant (same reason ContextMenu/Modal portal out).
export function ViewTypeSelect(props: ViewTypeSelectProps) {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  let triggerRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const active = () => props.viewTypes.find((v) => v.id === props.value) ?? props.viewTypes[0];

  function positionAtTrigger() {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom });
  }

  function clampToViewport() {
    if (!menuRef) return;
    const rect = menuRef.getBoundingClientRect();
    const margin = 4;
    let { x, y } = pos();
    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ x, y });
  }

  function select(id: string) {
    props.onChange?.(id);
    setOpen(false);
  }

  function toggle() {
    if (open()) {
      setOpen(false);
    } else {
      positionAtTrigger();
      setOpen(true);
    }
  }

  // Once the menu is mounted and measurable, pin it to the trigger and clamp
  // it into the viewport. Runs on every open so a window resize while open
  // repositions correctly.
  createEffect(() => {
    if (!open() || !menuRef) return;
    positionAtTrigger();
    clampToViewport();
    queueMicrotask(() => menuRef?.querySelector<HTMLElement>(".context-menu-item")?.focus());
  });

  function onEscape(e: KeyboardEvent) {
    if (open() && e.key === "Escape") {
      setOpen(false);
    }
  }

  function onOutsidePointerDown(e: MouseEvent) {
    if (!open()) return;
    const target = e.target as Node;
    if ((menuRef && menuRef.contains(target)) || (triggerRef && triggerRef.contains(target))) {
      return;
    }
    setOpen(false);
  }

  onMount(() => {
    document.addEventListener("keydown", onEscape);
    document.addEventListener("mousedown", onOutsidePointerDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onEscape);
      document.removeEventListener("mousedown", onOutsidePointerDown);
    });
  });

  const a = active();

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        class="view-mode-toggle"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label="View type"
        title="View type"
        onClick={toggle}
        onKeyDown={(e) => {
          if (!open() && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            positionAtTrigger();
            setOpen(true);
          }
        }}
      >
        {a ? a.icon({ size: 14 }) : null}
        <span>{a ? a.label : "View"}</span>
        <ChevronDownIcon size={12} />
      </button>

      <Portal>
        <Show when={open()}>
          <div
            ref={menuRef}
            class="context-menu"
            style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
            role="menu"
            aria-orientation="vertical"
          >
            <For each={props.viewTypes}>
              {(vt: ExplorerViewType) => {
                const selected = vt.id === props.value;
                return (
                  <button
                    type="button"
                    class="context-menu-item"
                    classList={{ active: selected }}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => select(vt.id)}
                  >
                    <span class="context-menu-item-icon">{vt.icon({ size: 14 })}</span>
                    {vt.label}
                    <Show when={selected}>
                      <span style={{ margin: "0 0 0 auto" }}><CheckIcon size={14} /></span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </Portal>
    </>
  );
}
