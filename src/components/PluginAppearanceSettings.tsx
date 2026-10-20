import { For, Show } from "solid-js";
import { pluginsWithAppearanceOverride } from "../lib/plugins";
import { SettingGroup, SettingRow, SettingsSection } from "./settings-ui";

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
  const plugins = () => pluginsWithAppearanceOverride();

  return (
    <Show when={plugins().length > 0}>
      <SettingsSection
        id="plugins.appearance"
        title="Plugin appearance"
        description="Override how translucent each plugin's panel looks."
      >
        <p class="settings-hint">
          Left at "Default", a plugin matches Flurer's own Panel Tint/Blur (Appearance &amp; Theme).
        </p>
        <SettingGroup>
          <For each={plugins()}>
            {(plugin) => {
              const current = () => props.pluginSettings[plugin.id] ?? {};
              const opacity = () => current().surfaceOpacity ?? props.defaultOpacity;
              const blurPx = () => current().surfaceBlur ?? props.defaultBlurPx;
              const hasOverride = () => current().surfaceOpacity !== undefined || current().surfaceBlur !== undefined;

              return (
                <SettingRow
                  id={`plugins.appearance.${plugin.id}`}
                  label={plugin.name}
                  description="Panel tint and blur for this plugin's own surface."
                  fullWidth
                >
                  <div class="setting-control-inline">
                    <span class="setting-label-standalone">Tint</span>
                    <div class="setting-control-slider">
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.001"
                        value={opacity()}
                        onInput={(e) => props.onPluginSettingsChange(plugin.id, { surfaceOpacity: e.currentTarget.valueAsNumber })}
                      />
                      <span class="setting-value">{(opacity() * 100).toFixed(0)}%</span>
                    </div>
                    <span class="setting-label-standalone">Blur</span>
                    <div class="setting-control-slider">
                      <input
                        type="range"
                        min="0"
                        max="32"
                        step="1"
                        value={blurPx()}
                        onInput={(e) => props.onPluginSettingsChange(plugin.id, { surfaceBlur: e.currentTarget.valueAsNumber })}
                      />
                      <span class="setting-value">{blurPx().toFixed(0)}px</span>
                    </div>
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
                </SettingRow>
              );
            }}
          </For>
        </SettingGroup>
      </SettingsSection>
    </Show>
  );
}
