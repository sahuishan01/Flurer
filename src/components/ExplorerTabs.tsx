import { For, Show } from "solid-js";
import { CloseIcon } from "./icons";
import { baseName } from "../lib/fs";

export type ExplorerTab = { id: string; path: string };

type ExplorerTabsProps = {
  tabs: ExplorerTab[];
  activeTabId: string;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
};

export function ExplorerTabs(props: ExplorerTabsProps) {
  return (
    <div class="explorer-tabs" role="tablist">
      <For each={props.tabs}>
        {(tab) => (
          <div
            class="explorer-tab"
            classList={{ active: tab.id === props.activeTabId }}
            role="tab"
            aria-selected={tab.id === props.activeTabId}
            title={tab.path}
            onClick={() => props.onSwitch(tab.id)}
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
