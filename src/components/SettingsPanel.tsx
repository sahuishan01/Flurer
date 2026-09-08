import { createSignal, For, Show } from "solid-js";
import { CustomizationSettings } from "./CustomizationSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { UpdatesView } from "./UpdatesView";
import { SearchIndexSettings } from "./SearchIndexSettings";
import { CloseIcon, SearchIcon } from "./icons";
import type { BackgroundSettings, Theme } from "../lib/settings";
import type { InAppShortcutAction } from "../lib/shortcuts";
import type { Wallpaper } from "../lib/unsplash";
import { registeredPlugins } from "../lib/plugins";
import { PluginMarketplace } from "./PluginMarketplace";
import { PluginAppearanceSettings } from "./PluginAppearanceSettings";

type SettingsCategory = "customization" | "shortcuts" | "plugins" | "search-index" | "updates" | string;

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
  liveFolderSizeUpdates: boolean;
  onLiveFolderSizeUpdatesChange: (enabled: boolean) => void;
  maxHistoryItems: number;
  onMaxHistoryItemsChange: (limit: number) => void;
  globalShortcut: string;
  onGlobalShortcutChange: (shortcut: string) => void;
  inAppShortcuts: Partial<Record<InAppShortcutAction, string>>;
  onInAppShortcutChange: (action: InAppShortcutAction, combo: string) => void;
  onResetInAppShortcut: (action: InAppShortcutAction) => void;
  launchAtStartup: boolean;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  hasUnsplashApiKey: boolean;
  onSaveUnsplashApiKey: (key: string) => void;
  apiKeyError: string;
  wallpaper: Wallpaper | null;
  wallpaperError: string;
  onFetchWallpaper: (query: string) => void;
  onNextCategoryWallpaper: () => void;
  onPrevCategoryWallpaper: () => void;
  canGoPrevCategoryWallpaper: boolean;
  disabledPlugins: string[];
  onDisabledPluginsChange: (disabled: string[]) => void;
  pluginSettings: Record<string, any>;
  onPluginSettingsChange: (pluginId: string, patch: any) => void;
  searchIndexRoots: string[];
  onSearchIndexRootsChange: (roots: string[]) => void;
  recentPaths: string[];
  favouritePaths: string[];
  "data-bg-lightness"?: string;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const [category, setCategory] = createSignal<SettingsCategory>("customization");
  const [localSearch, setLocalSearch] = createSignal("");

  const categories = () => {
    const list = [
      {
        id: "customization",
        label: "Appearance & Theme",
        description: "Wallpapers, colors, translucency, fonts",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
          </svg>
        ),
      },
      {
        id: "shortcuts",
        label: "Keyboard Shortcuts",
        description: "Keybindings for actions, navigation, tabs",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.001" />
            <path d="M10 8h.001" />
            <path d="M14 8h.001" />
            <path d="M18 8h.001" />
            <path d="M6 12h.001" />
            <path d="M10 12h.001" />
            <path d="M14 12h.001" />
            <path d="M18 12h.001" />
            <path d="M7 16h10" />
          </svg>
        ),
      },
      {
        id: "plugins",
        label: "Plugins & Extensions",
        description: "Manage installed plugins and marketplace",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4" />
            <path d="m16.2 7.8 2.9-2.9" />
            <path d="M18 12h4" />
            <path d="m16.2 16.2 2.9 2.9" />
            <path d="M12 18v4" />
            <path d="m4.9 19.1 2.9-2.9" />
            <path d="M2 12h4" />
            <path d="m4.9 4.9 2.9 2.9" />
          </svg>
        ),
      },
      {
        id: "search-index",
        label: "Search Index",
        description: "Indexed folders and search performance",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        ),
      },
      {
        id: "updates",
        label: "Updates & About",
        description: "Software version, changelog, updater",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        ),
      },
    ];

    for (const p of registeredPlugins()) {
      if (p.settingsPanel) {
        list.push({
          id: `plugin-${p.id}`,
          label: p.name,
          description: `Settings for ${p.name}`,
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          ),
        });
      }
    }
    return list;
  };

  const activeCategory = () => categories().find((c) => c.id === category()) ?? categories()[0];

  return (
    <div class="settings-page" data-bg-lightness={props["data-bg-lightness"]}>
      <div class="settings-panel-header">
        <div class="settings-header-title-row">
          <h2>Settings</h2>
          <span class="settings-active-section-tag">{activeCategory().label}</span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", "align-items": "center" }}>
          <button
            type="button"
            class="option-btn"
            title="Export Settings JSON for debugging or backup"
            onClick={async () => {
              try {
                const settingsJson = await invoke("get_settings");
                const blob = new Blob([JSON.stringify(settingsJson, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "flurer-settings.json";
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                console.error("Failed to export settings", err);
              }
            }}
          >
            Export Settings JSON
          </button>
          <button type="button" class="icon-btn" aria-label="Close settings" onClick={props.onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>

      <div class="settings-panel-body">
        <nav class="settings-nav">
          <div class="settings-nav-list">
            <For each={categories()}>
              {(entry) => (
                <button
                  type="button"
                  class="settings-nav-item"
                  classList={{ active: category() === entry.id }}
                  onClick={() => setCategory(entry.id)}
                >
                  <span class="settings-nav-icon">{entry.icon}</span>
                  <div class="settings-nav-text">
                    <span class="settings-nav-title">{entry.label}</span>
                    <span class="settings-nav-desc">{entry.description}</span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </nav>

        <div class="settings-content">
          <div class="settings-content-header">
            <h3>{activeCategory().label}</h3>
            <p class="settings-content-subtitle">{activeCategory().description}</p>
          </div>

          <Show when={category() === "customization"}>
            <CustomizationSettings
              searchQuery={props.searchQuery || localSearch()}
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
              liveFolderSizeUpdates={props.liveFolderSizeUpdates}
              onLiveFolderSizeUpdatesChange={props.onLiveFolderSizeUpdatesChange}
              maxHistoryItems={props.maxHistoryItems}
              onMaxHistoryItemsChange={props.onMaxHistoryItemsChange}
              launchAtStartup={props.launchAtStartup}
              onLaunchAtStartupChange={props.onLaunchAtStartupChange}
              hasUnsplashApiKey={props.hasUnsplashApiKey}
              onSaveUnsplashApiKey={props.onSaveUnsplashApiKey}
              apiKeyError={props.apiKeyError}
              wallpaper={props.wallpaper}
              wallpaperError={props.wallpaperError}
              onFetchWallpaper={props.onFetchWallpaper}
              onNextCategoryWallpaper={props.onNextCategoryWallpaper}
              onPrevCategoryWallpaper={props.onPrevCategoryWallpaper}
              canGoPrevCategoryWallpaper={props.canGoPrevCategoryWallpaper}
            />
          </Show>

          <Show when={category() === "shortcuts"}>
            <ShortcutsSettings
              globalShortcut={props.globalShortcut}
              onGlobalShortcutChange={props.onGlobalShortcutChange}
              inAppShortcuts={props.inAppShortcuts}
              onInAppShortcutChange={props.onInAppShortcutChange}
              onResetInAppShortcut={props.onResetInAppShortcut}
            />
          </Show>

          <Show when={category() === "plugins"}>
            <PluginMarketplace
              disabledPlugins={props.disabledPlugins}
              onDisabledPluginsChange={props.onDisabledPluginsChange}
              searchQuery={props.searchQuery}
            />
            <PluginAppearanceSettings
              pluginSettings={props.pluginSettings}
              onPluginSettingsChange={props.onPluginSettingsChange}
              defaultOpacity={props.uiTintOpacity}
              defaultBlurPx={props.uiBlurPx}
            />
          </Show>

          <Show when={category().startsWith("plugin-") ? category() : undefined}>
            {(pluginCategory) => {
              const id = pluginCategory().substring(7); // "plugin-".length is 7
              const p = registeredPlugins().find((x) => x.id === id);
              if (!p || !p.settingsPanel) return null;
              return p.settingsPanel({
                dataBgLightness: props["data-bg-lightness"] || "light",
                pluginSettings: props.pluginSettings[id] || {},
                onPluginSettingsChange: (patch: any) => props.onPluginSettingsChange(id, patch),
              });
            }}
          </Show>

          <Show when={category() === "search-index"}>
            <SearchIndexSettings
              roots={props.searchIndexRoots}
              onRootsChange={props.onSearchIndexRootsChange}
              recentPaths={props.recentPaths}
              favouritePaths={props.favouritePaths}
            />
          </Show>

          <Show when={category() === "updates"}>
            <UpdatesView />
          </Show>
        </div>
      </div>
    </div>
  );
}
