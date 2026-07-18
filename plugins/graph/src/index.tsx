import { GraphView } from "./GraphView";
import { GraphIcon } from "./icons";

(window as any).registerPlugin({
  id: "graph",
  name: "Storage Graph",
  description: "Visualizes your disk space topology as an interactive SVG graph.",
  version: "0.4.19",
  author: "Algosculptor",
  viewRailButton: (props: any) => {
    return (
      <button
        type="button"
        class="view-rail-item"
        classList={{ active: props.active }}
        title="Storage graph"
        aria-label="Storage graph"
        onClick={props.onClick}
      >
        <GraphIcon size={19} />
      </button>
    );
  },
  mainPanel: (props: any) => {
    return (
      <GraphView
        data-bg-lightness={props.dataBgLightness}
        searchQuery={props.searchQuery}
        onOpenInExplorer={props.navigateTo}
        settingsLoaded={props.settingsLoaded}
        persistState={props.pluginSettings?.persistGraphState ?? true}
        initialState={props.pluginSettings?.graphState}
        onStateChange={(state) => props.onPluginSettingsChange({ graphState: state })}
        active={props.active}
        focusPath={props.focusPath}
      />
    );
  },
  settingsPanel: (props: any) => {
    const persist = () => props.pluginSettings?.persistGraphState ?? true;
    return (
      <div class="settings-section">
        <h3>Storage Graph Settings</h3>
        <div class="settings-row">
          <label class="settings-checkbox-label">
            <input
              type="checkbox"
              checked={persist()}
              onChange={(e) => props.onPluginSettingsChange({ persistGraphState: e.currentTarget.checked })}
            />
            Persist Graph View Zoom, Pan and Node Positions
          </label>
        </div>
      </div>
    );
  },
});
