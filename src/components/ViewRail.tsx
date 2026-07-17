import { FolderIcon, GearIcon } from "./icons";
import { registeredPlugins } from "../lib/plugins";
import { For, Show } from "solid-js";

type ViewRailProps = {
  activeView: string;
  onSelectView: (view: string) => void;
};

export function ViewRail(props: ViewRailProps) {
  return (
    <nav class="view-rail">
      <button
        type="button"
        class="view-rail-item"
        classList={{ active: props.activeView === "explorer" }}
        title="Explorer"
        aria-label="Explorer"
        onClick={() => props.onSelectView("explorer")}
      >
        <FolderIcon size={19} />
      </button>

      {/* Dynamically render plugin buttons */}
      <For each={registeredPlugins()}>
        {(plugin) => (
          <Show when={plugin.viewRailButton}>
            {plugin.viewRailButton!({
              active: props.activeView === plugin.id,
              onClick: () => props.onSelectView(plugin.id)
            })}
          </Show>
        )}
      </For>

      <div class="view-rail-spacer" />

      <button
        type="button"
        class="view-rail-item"
        classList={{ active: props.activeView === "settings" }}
        title="Settings"
        aria-label="Settings"
        onClick={() => props.onSelectView("settings")}
      >
        <GearIcon size={19} />
      </button>
    </nav>
  );
}
