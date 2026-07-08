import { createSignal, For, Show } from "solid-js";
import { CustomizationSettings } from "./CustomizationSettings";
import { CloseIcon } from "./icons";
import type { BackgroundSettings, Theme } from "../lib/settings";
import type { Wallpaper } from "../lib/unsplash";

type SettingsCategory = "customization";

const CATEGORIES: { id: SettingsCategory; label: string }[] = [{ id: "customization", label: "Customization" }];

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
  persistGraphState: boolean;
  onPersistGraphStateChange: (enabled: boolean) => void;
  wallpaper: Wallpaper | null;
  wallpaperError: string;
  onFetchWallpaper: (query: string) => void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const [category, setCategory] = createSignal<SettingsCategory>("customization");

  return (
    <div class="settings-page">
      <div class="settings-panel-header">
        <h2>Settings</h2>
        <button type="button" class="icon-btn" aria-label="Close settings" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>

      <div class="settings-panel-body">
        <nav class="settings-nav">
          <For each={CATEGORIES}>
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
              persistGraphState={props.persistGraphState}
              onPersistGraphStateChange={props.onPersistGraphStateChange}
              wallpaper={props.wallpaper}
              wallpaperError={props.wallpaperError}
              onFetchWallpaper={props.onFetchWallpaper}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
