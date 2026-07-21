import { createSignal, For, Show } from "solid-js";
import { CustomizationSettings } from "./CustomizationSettings";
import { UpdatesView } from "./UpdatesView";
import { CloseIcon } from "./icons";
import type { BackgroundSettings, Theme } from "../lib/settings";
import type { Wallpaper } from "../lib/unsplash";
import { registeredPlugins } from "../lib/plugins";
import { PluginMarketplace } from "./PluginMarketplace";

type SettingsCategory = "customization" | "plugins" | string;

type SettingsPanelProps = {
  onClose: () => void;
  searchQuery: string;
  background: BackgroundSettings;
  onBackgroundChange: (patch: Partial<BackgroundSettings>) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  uiTintOpacity: number;
  onUiTintOpacityChange: (opacity: number) => void;
  uiBlurPx: number;
  onUiBlurPxChange: (blurPx: number) => void;
  fontFamily: string;
  onFontFamilyChange: (fontFamily: string) => void;
  fontSizePx: number;
  onFontSizePxChange: (fontSizePx: number) => void;
  sidebarTooltipDelayMs: number;
  onSidebarTooltipDelayMsChange: (delayMs: number) => void;
  showProgressWhenIdle: boolean;
  onShowProgressWhenIdleChange: (show: boolean) => void;
  hasUnsplashApiKey: boolean;
  onSaveUnsplashApiKey: (key: string) => void;
  apiKeyError: string;
  wallpaper: Wallpaper | null;
  wallpaperError: string;
  onFetchWallpaper: (query: string) => void;
  disabledPlugins: string[];
  onDisabledPluginsChange: (disabled: string[]) => void;
  pluginSettings: Record<string, any>;
  onPluginSettingsChange: (pluginId: string, patch: any) => void;
  "data-bg-lightness"?: string;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const [category, setCategory] = createSignal<SettingsCategory>("customization");

  const categories = () => {
      const list = [
        { id: "customization", label: "Customization" },
        { id: "plugins", label: "Plugins" },
        { id: "updates", label: "Updates" },
      ];
    for (const p of registeredPlugins()) {
      if (p.settingsPanel) {
        list.push({ id: `plugin-${p.id}`, label: p.name });
      }
    }
    return list;
  };

  return (
    <div class="settings-page" data-bg-lightness={props["data-bg-lightness"]}>
      <div class="settings-panel-header">
        <h2>Settings</h2>
        <button type="button" class="icon-btn" aria-label="Close settings" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>

      <div class="settings-panel-body">
        <nav class="settings-nav">
          <For each={categories()}>
            {(entry) => (
              <button
                type="button"
                classList={{ active: category() === entry.id }}
                onClick={() => setCategory(entry.id)}
              >
                {entry.label}
              </button>
            )}
          </For>
        </nav>

        <div class="settings-content">
          <Show when={category() === "customization"}>
            <CustomizationSettings
              searchQuery={props.searchQuery}
              background={props.background}
              onBackgroundChange={props.onBackgroundChange}
              theme={props.theme}
              onThemeChange={props.onThemeChange}
              uiTintOpacity={props.uiTintOpacity}
              onUiTintOpacityChange={props.onUiTintOpacityChange}
              uiBlurPx={props.uiBlurPx}
              onUiBlurPxChange={props.onUiBlurPxChange}
              fontFamily={props.fontFamily}
              onFontFamilyChange={props.onFontFamilyChange}
              fontSizePx={props.fontSizePx}
              onFontSizePxChange={props.onFontSizePxChange}
              sidebarTooltipDelayMs={props.sidebarTooltipDelayMs}
              onSidebarTooltipDelayMsChange={props.onSidebarTooltipDelayMsChange}
              showProgressWhenIdle={props.showProgressWhenIdle}
              onShowProgressWhenIdleChange={props.onShowProgressWhenIdleChange}
              hasUnsplashApiKey={props.hasUnsplashApiKey}
              onSaveUnsplashApiKey={props.onSaveUnsplashApiKey}
              apiKeyError={props.apiKeyError}
              wallpaper={props.wallpaper}
              wallpaperError={props.wallpaperError}
              onFetchWallpaper={props.onFetchWallpaper}
            />
          </Show>
          <Show when={category() === "plugins"}>
            <PluginMarketplace
              disabledPlugins={props.disabledPlugins}
              onDisabledPluginsChange={props.onDisabledPluginsChange}
              searchQuery={props.searchQuery}
            />
          </Show>
          <Show when={category().startsWith("plugin-")}>
            {() => {
              const id = category().substring(7); // "plugin-".length is 7
              const p = registeredPlugins().find((x) => x.id === id);
              if (!p || !p.settingsPanel) return null;
              return p.settingsPanel({
                dataBgLightness: props["data-bg-lightness"] || "light",
                pluginSettings: props.pluginSettings[id] || {},
                onPluginSettingsChange: (patch: any) => props.onPluginSettingsChange(id, patch)
              });
            }}
          </Show>
          <Show when={category() === "updates"}>
            <UpdatesView />
          </Show>
        </div>
      </div>
    </div>
  );
}
