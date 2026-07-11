import { FolderIcon, GearIcon, GraphIcon } from "./icons";
import type { MainView } from "../lib/view";

type ViewRailProps = {
  activeView: MainView;
  onSelectView: (view: MainView) => void;
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
      <button
        type="button"
        class="view-rail-item"
        classList={{ active: props.activeView === "graph" }}
        title="Storage graph"
        aria-label="Storage graph"
        onClick={() => props.onSelectView("graph")}
      >
        <GraphIcon size={19} />
      </button>

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
