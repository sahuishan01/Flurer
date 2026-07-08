import { For } from "solid-js";
import type { BackgroundSettings, BackgroundType, Theme } from "../lib/settings";
import { GRADIENT_DIRECTIONS, GRADIENT_PRESETS, SOLID_COLOR_PRESETS } from "../lib/settings";
import {
  sizedUnsplashUrl,
  UNSPLASH_FIXED_IMAGES,
  UNSPLASH_FREQUENCY_OPTIONS,
  UNSPLASH_ROTATE_CATEGORIES,
  type Wallpaper,
} from "../lib/unsplash";

const THUMBNAIL_SIZE = 160;

const BACKGROUND_TYPE_LABELS: Record<BackgroundType, string> = {
  none: "No Background",
  gradient: "Gradient",
  solid: "Solid Color",
  unsplash: "Unsplash",
};

const BACKGROUND_KEYWORDS = [
  "background",
  "wallpaper",
  "no background",
  "gradient",
  "solid color",
  "unsplash",
  "opacity",
  "photo",
  "image",
  "auto rotate",
  "fixed",
  "category",
];

const THEME_KEYWORDS = ["theme", "light", "dark", "panel tint", "tint", "opacity", "blur", "panel blur", "blurriness"];

const BEHAVIOR_KEYWORDS = ["graph", "persist", "remember", "storage graph", "layout", "behavior", "session"];

function matchesQuery(query: string, keywords: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return keywords.some((keyword) => keyword.toLowerCase().includes(q));
}

type CustomizationSettingsProps = {
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

export function CustomizationSettings(props: CustomizationSettingsProps) {
  const showBackground = () => matchesQuery(props.searchQuery, BACKGROUND_KEYWORDS);
  const showTheme = () => matchesQuery(props.searchQuery, THEME_KEYWORDS);
  const showBehavior = () => matchesQuery(props.searchQuery, BEHAVIOR_KEYWORDS);

  return (
    <div class="customization-settings">
      {!showBackground() && !showTheme() && !showBehavior() && <p class="settings-empty">No matching settings.</p>}

      {showBackground() && (
      <section class="settings-section">
        <h3>Background</h3>
        <div class="option-group">
          <For each={Object.keys(BACKGROUND_TYPE_LABELS) as BackgroundType[]}>
            {(type) => (
              <button
                type="button"
                classList={{ "option-btn": true, active: props.background.backgroundType === type }}
                onClick={() => props.onBackgroundChange({ backgroundType: type })}
              >
                {BACKGROUND_TYPE_LABELS[type]}
              </button>
            )}
          </For>
        </div>

        {props.background.backgroundType !== "none" && (
          <label class="opacity-control">
            Opacity: {(props.background.opacity * 100).toFixed(1)}%
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={props.background.opacity}
              onInput={(e) => props.onBackgroundChange({ opacity: e.currentTarget.valueAsNumber })}
            />
          </label>
        )}

        {props.background.backgroundType === "gradient" && (
          <div class="gradient-settings">
            <div class="swatch-row">
              <For each={GRADIENT_PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="swatch"
                    classList={{
                      active:
                        props.background.gradientColor1 === preset.color1 &&
                        props.background.gradientColor2 === preset.color2 &&
                        props.background.gradientDirection === preset.direction,
                    }}
                    style={{
                      "background-image": `linear-gradient(${preset.direction}, ${preset.color1}, ${preset.color2})`,
                    }}
                    aria-label="Gradient preset"
                    onClick={() =>
                      props.onBackgroundChange({
                        gradientColor1: preset.color1,
                        gradientColor2: preset.color2,
                        gradientDirection: preset.direction,
                      })
                    }
                  />
                )}
              </For>
            </div>

            <div class="gradient-builder">
              <label class="color-field">
                Start
                <input
                  type="color"
                  value={props.background.gradientColor1}
                  onInput={(e) => props.onBackgroundChange({ gradientColor1: e.currentTarget.value })}
                />
              </label>
              <label class="color-field">
                End
                <input
                  type="color"
                  value={props.background.gradientColor2}
                  onInput={(e) => props.onBackgroundChange({ gradientColor2: e.currentTarget.value })}
                />
              </label>
              <label class="color-field">
                Direction
                <select
                  value={props.background.gradientDirection}
                  onChange={(e) => props.onBackgroundChange({ gradientDirection: e.currentTarget.value })}
                >
                  <For each={GRADIENT_DIRECTIONS}>{(dir) => <option value={dir}>{dir}</option>}</For>
                </select>
              </label>
            </div>
          </div>
        )}

        {props.background.backgroundType === "solid" && (
          <div class="solid-settings">
            <div class="swatch-row">
              <For each={SOLID_COLOR_PRESETS}>
                {(color) => (
                  <button
                    type="button"
                    class="swatch"
                    classList={{ active: props.background.solidColor === color }}
                    style={{ "background-color": color }}
                    aria-label="Color preset"
                    onClick={() => props.onBackgroundChange({ solidColor: color })}
                  />
                )}
              </For>
            </div>

            <div class="color-field">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(props.background.solidColor) ? props.background.solidColor : "#1f2937"}
                onInput={(e) => props.onBackgroundChange({ solidColor: e.currentTarget.value })}
              />
              <input
                type="text"
                class="color-text-input"
                placeholder="#hex or rgb(...)"
                value={props.background.solidColor}
                onChange={(e) => props.onBackgroundChange({ solidColor: e.currentTarget.value })}
              />
            </div>
          </div>
        )}

        {props.background.backgroundType === "unsplash" && (
          <div class="unsplash-settings">
            <div class="option-group">
              <button
                type="button"
                classList={{ "option-btn": true, active: props.background.unsplashMode === "fixed" }}
                onClick={() => props.onBackgroundChange({ unsplashMode: "fixed" })}
              >
                Fixed
              </button>
              <button
                type="button"
                classList={{ "option-btn": true, active: props.background.unsplashMode !== "fixed" }}
                onClick={() =>
                  props.onBackgroundChange({
                    unsplashMode: props.background.unsplashFixedList.length
                      ? "autoRotateList"
                      : "autoRotateCategory",
                  })
                }
              >
                Auto Rotate
              </button>
            </div>

            {props.background.unsplashMode === "fixed" && (
              <div class="fixed-controls">
                <button type="button" onClick={() => props.onFetchWallpaper(props.background.unsplashCategory || "nature")}>
                  Get Wallpaper
                </button>
              </div>
            )}

            {props.background.unsplashMode !== "fixed" && (
              <>
                <div class="option-group">
                  <button
                    type="button"
                    classList={{ "option-btn": true, active: props.background.unsplashMode === "autoRotateCategory" }}
                    onClick={() => props.onBackgroundChange({ unsplashMode: "autoRotateCategory" })}
                  >
                    From Category
                  </button>
                  <button
                    type="button"
                    classList={{ "option-btn": true, active: props.background.unsplashMode === "autoRotateList" }}
                    onClick={() => props.onBackgroundChange({ unsplashMode: "autoRotateList" })}
                  >
                    From Fixed List
                  </button>
                </div>

                <label class="frequency-control">
                  Change every
                  <select
                    value={props.background.unsplashChangeFrequencyMs}
                    onChange={(e) =>
                      props.onBackgroundChange({ unsplashChangeFrequencyMs: Number(e.currentTarget.value) })
                    }
                  >
                    <For each={UNSPLASH_FREQUENCY_OPTIONS}>
                      {(option) => <option value={option.ms}>{option.label}</option>}
                    </For>
                  </select>
                </label>

                {props.background.unsplashMode === "autoRotateCategory" && (
                  <select
                    value={props.background.unsplashCategory ?? ""}
                    onChange={(e) => props.onBackgroundChange({ unsplashCategory: e.currentTarget.value })}
                  >
                    <option value="" disabled>
                      Choose a category
                    </option>
                    <For each={UNSPLASH_ROTATE_CATEGORIES}>{(cat) => <option value={cat}>{cat}</option>}</For>
                  </select>
                )}

                {props.background.unsplashMode === "autoRotateList" && (
                  <div class="image-grid">
                    <For each={UNSPLASH_FIXED_IMAGES}>
                      {(img) => (
                        <label class="image-option">
                          <input
                            type="checkbox"
                            checked={props.background.unsplashFixedList.includes(img.url)}
                            onChange={(e) => {
                              const list = props.background.unsplashFixedList;
                              const next = e.currentTarget.checked
                                ? [...list, img.url]
                                : list.filter((u) => u !== img.url);
                              props.onBackgroundChange({ unsplashFixedList: next });
                            }}
                          />
                          <img src={sizedUnsplashUrl(img.url, THUMBNAIL_SIZE, THUMBNAIL_SIZE)} alt={img.label} />
                          <span>{img.label}</span>
                        </label>
                      )}
                    </For>
                  </div>
                )}
              </>
            )}

            {props.wallpaperError && <p class="settings-error">{props.wallpaperError}</p>}
            {props.wallpaper && (
              <p class="wallpaper-credit">
                Photo by{" "}
                <a href={`https://unsplash.com/@${props.wallpaper.user.username}`} target="_blank">
                  {props.wallpaper.user.name}
                </a>{" "}
                on Unsplash
              </p>
            )}
          </div>
        )}
      </section>
      )}

      {showTheme() && (
      <section class="settings-section">
        <h3>Theme</h3>
        <div class="option-group">
          <button
            type="button"
            classList={{ "option-btn": true, active: props.theme === "light" }}
            onClick={() => props.onThemeChange("light")}
          >
            Light
          </button>
          <button
            type="button"
            classList={{ "option-btn": true, active: props.theme === "dark" }}
            onClick={() => props.onThemeChange("dark")}
          >
            Dark
          </button>
        </div>

        <label class="opacity-control">
          Panel Tint: {(props.uiTintOpacity * 100).toFixed(1)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={props.uiTintOpacity}
            onInput={(e) => props.onUiTintOpacityChange(e.currentTarget.valueAsNumber)}
          />
        </label>

        <label class="opacity-control">
          Panel Blur: {props.uiBlurPx.toFixed(0)}px
          <input
            type="range"
            min="0"
            max="32"
            step="1"
            value={props.uiBlurPx}
            onInput={(e) => props.onUiBlurPxChange(e.currentTarget.valueAsNumber)}
          />
        </label>
      </section>
      )}

      {showBehavior() && (
      <section class="settings-section">
        <h3>Behavior</h3>
        <label class="checkbox-control">
          <input
            type="checkbox"
            checked={props.persistGraphState}
            onChange={(e) => props.onPersistGraphStateChange(e.currentTarget.checked)}
          />
          Remember graph layout between sessions
        </label>
      </section>
      )}
    </div>
  );
}
