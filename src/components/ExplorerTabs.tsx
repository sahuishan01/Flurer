import { For, Show, createSignal } from "solid-js";
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

export function ExplorerTabs(props: ExplorerTabsProps) {
  const [dragFrom, setDragFrom] = createSignal(-1);

  const dropReorder = (from: number, to: number) => {
    setDragFrom(-1);
    if (Number.isNaN(from) || from === to) return;
    props.onReorder(from, to);
  };

  return (
    <div
      class="explorer-tabs"
      role="tablist"
      onDragOver={(e) => {
        // Drop past the last tab (on the strip or the + button) appends it.
        if (dragFrom() >= 0) {
          e.preventDefault();
          e.dataTransfer!.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        if (dragFrom() < 0) return;
        e.preventDefault();
        dropReorder(Number(e.dataTransfer?.getData("text/plain")), props.tabs.length - 1);
      }}
      onDragEnd={() => setDragFrom(-1)}
    >
      <For each={props.tabs}>
        {(tab, i) => (
          <div
            class="explorer-tab"
            classList={{ active: tab.id === props.activeTabId, dragging: dragFrom() === i() }}
            role="tab"
            aria-selected={tab.id === props.activeTabId}
            title={tab.path}
            draggable
            onClick={() => props.onSwitch(tab.id)}
            onDragStart={(e) => {
              setDragFrom(i());
              e.dataTransfer!.effectAllowed = "move";
              e.dataTransfer!.setData("text/plain", String(i()));
            }}
            onDragOver={(e) => {
              if (dragFrom() < 0) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer!.dropEffect = "move";
            }}
            onDrop={(e) => {
              if (dragFrom() < 0) return;
              e.preventDefault();
              e.stopPropagation();
              dropReorder(Number(e.dataTransfer?.getData("text/plain")), i());
            }}
            onMouseDown={(e) => {
              // Middle-click closes, same as every browser's tab strip.
              if (e.button === 1) {
                e.preventDefault();
                props.onClose(tab.id);
              }
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
