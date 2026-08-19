import { For, Show } from "solid-js";
import { registeredPlugins } from "../lib/plugins";

type PluginAppearanceSettingsProps = {
  pluginSettings: Record<string, any>;
  onPluginSettingsChange: (pluginId: string, patch: any) => void;
  defaultOpacity: number;
  defaultBlurPx: number;
};

// Generic opacity/blur control for any registered plugin's own .view-pane
// (see App.tsx's --plugin-surface-opacity/--plugin-surface-blur wiring and
// docs/superpowers/specs/2026-08-19-per-plugin-translucency-design.md).
// Skipped for plugins that set hasCustomAppearanceSettings — those already
// expose their own control in their settingsPanel, and having two UIs
// write the same pluginSettings[id].surfaceOpacity/.surfaceBlur fields
// would just be confusing, not additive.
export function PluginAppearanceSettings(props: PluginAppearanceSettingsProps) {
  const plugins = () => registeredPlugins().filter((p) => (p.mainPanel || p.fullPanel) && !p.hasCustomAppearanceSettings);

  return (
    <Show when={plugins().length > 0}>
      <div class="plugin-appearance-section">
        <h3>Plugin appearance</h3>
        <p class="settings-section-hint">
          Override how translucent each plugin's panel looks. Left at "Default", a plugin
          matches Flurer's own Panel Tint/Blur (Customization tab).
        </p>
        <For each={plugins()}>
          {(plugin) => {
            const current = () => props.pluginSettings[plugin.id] ?? {};
            const opacity = () => current().surfaceOpacity ?? props.defaultOpacity;
            const blurPx = () => current().surfaceBlur ?? props.defaultBlurPx;
            const hasOverride = () => current().surfaceOpacity !== undefined || current().surfaceBlur !== undefined;

            return (
              <div class="plugin-appearance-card">
                <div class="plugin-appearance-card-header">
                  <span>{plugin.name}</span>
                  <Show when={hasOverride()}>
                    <button
                      type="button"
                      class="link-btn"
                      onClick={() => props.onPluginSettingsChange(plugin.id, { surfaceOpacity: undefined, surfaceBlur: undefined })}
                    >
                      Reset to default
                    </button>
                  </Show>
                </div>

                <label class="opacity-control">
                  Panel Tint: {(opacity() * 100).toFixed(1)}%
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.001"
                    value={opacity()}
                    onInput={(e) => props.onPluginSettingsChange(plugin.id, { surfaceOpacity: e.currentTarget.valueAsNumber })}
                  />
                </label>

                <label class="opacity-control">
                  Panel Blur: {blurPx().toFixed(0)}px
                  <input
                    type="range"
                    min="0"
                    max="32"
                    step="1"
                    value={blurPx()}
                    onInput={(e) => props.onPluginSettingsChange(plugin.id, { surfaceBlur: e.currentTarget.valueAsNumber })}
                  />
                </label>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
