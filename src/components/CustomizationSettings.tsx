import { createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { FolderSizeCacheStats } from "../lib/fs";
import type { BackgroundSettings, BackgroundType, Theme } from "../lib/settings";
import {
  FONT_FAMILY_PRESETS,
  GRADIENT_DIRECTIONS,
  GRADIENT_PRESETS,
  MAX_FONT_SIZE_PX,
  MAX_HISTORY_ITEMS,
  MIN_FONT_SIZE_PX,
  MIN_HISTORY_ITEMS,
  MIN_SCALE,
  MAX_SCALE,
  fontSizePxToScale,
  scaleToFontSizePx,
  SOLID_COLOR_PRESETS,
} from "../lib/settings";

import {
  sizedUnsplashUrl,
  UNSPLASH_FREQUENCY_OPTIONS,
  UNSPLASH_ROTATE_CATEGORIES,
  type Wallpaper,
  type WallpaperSearchPage,
  type WallpaperSearchResult,
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
  "api key",
  "api",
  "key",
  "unsplash key",
];

const THEME_KEYWORDS = [
  "theme",
  "light",
  "dark",
  "panel tint",
  "tint",
  "opacity",
  "blur",
  "panel blur",
  "blurriness",
  "font",
  "fonts",
  "font size",
  "font family",
  "typeface",
  "text size",
];

const BEHAVIOR_KEYWORDS = ["graph", "persist", "remember", "storage graph", "layout", "behavior", "session", "history", "recent", "paths", "folder size", "live update", "automatic", "tooltip", "hover", "delay", "progress", "shortcut", "hotkey", "global shortcut", "keybind", "tray", "startup", "launch at startup", "autostart", "login", "minimize", "background", "cache", "clear cache", "size cache", "disk usage"];

function matchesQuery(query: string, keywords: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return keywords.some((keyword) => keyword.toLowerCase().includes(q));
}

const COMMON_SYSTEM_FONTS = [
  "Arial",
  "Arial Black",
  "Bahnschrift",
  "Calibri",
  "Cambria",
  "Candara",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Ebrima",
  "Franklin Gothic Medium",
  "Gabriola",
  "Gadugi",
  "Georgia",
  "Impact",
  "Ink Free",
  "Inter",
  "Javanese Text",
  "Leelawadee UI",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Malgun Gothic",
  "Marlett",
  "Microsoft Himalaya",
  "Microsoft JhengHei",
  "Microsoft New Tai Lue",
  "Microsoft PhagsPa",
  "Microsoft Sans Serif",
  "Microsoft YaHei",
  "Microsoft Yi Baiti",
  "MingLiU-ExtB",
  "Mongolian Baiti",
  "MS Gothic",
  "MV Boli",
  "Myanmar Text",
  "Nirmala UI",
  "Palatino Linotype",
  "Segoe MDL2 Assets",
  "Segoe Print",
  "Segoe Script",
  "Segoe UI",
  "Segoe UI Emoji",
  "Segoe UI Historic",
  "Segoe UI Symbol",
  "SimSun",
  "Sitka",
  "Sylfaen",
  "Symbol",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Webdings",
  "Wingdings",
  "Yu Gothic",
  "-apple-system",
  "system-ui",
  "Roboto",
  "Open Sans",
  "Noto Sans",
  "Fira Code",
  "JetBrains Mono",
];

function FontSearchDropdown(props: { fontFamily: string; onFontFamilyChange: (font: string) => void }) {
  const [fonts, setFonts] = createSignal<string[]>(COMMON_SYSTEM_FONTS);
  const [search, setSearch] = createSignal("");
  const [isOpen, setIsOpen] = createSignal(false);

  onMount(async () => {
    if ("queryLocalFonts" in window && typeof (window as any).queryLocalFonts === "function") {
      try {
        const localFonts = await (window as any).queryLocalFonts();
        const fontFamilies = Array.from(new Set(localFonts.map((f: any) => f.family))).sort() as string[];
        if (fontFamilies.length > 0) {
          setFonts(fontFamilies);
        }
      } catch (e) {
        console.warn("Failed to query local fonts:", e);
      }
    }
  });

  const filteredFonts = () => {
    const q = search().toLowerCase().trim();
    if (!q) return fonts();
    return fonts().filter((f) => f.toLowerCase().includes(q));
  };

  return (
    <div class="font-dropdown-container">
      <input
        type="text"
        class="color-text-input font-search-input"
        placeholder="Search system fonts or enter font family…"
        value={props.fontFamily}
        onFocus={() => setIsOpen(true)}
        onInput={(e) => {
          setSearch(e.currentTarget.value);
          props.onFontFamilyChange(e.currentTarget.value);
          setIsOpen(true);
        }}
      />
      <Show when={isOpen()}>
        <div class="font-dropdown-menu" onMouseDown={(e) => e.preventDefault()}>
          <div class="font-search-header">
            <input
              type="text"
              class="font-menu-filter-input"
              placeholder="Filter font list…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              autofocus
            />
            <button type="button" class="font-dropdown-close" onClick={() => setIsOpen(false)}>×</button>
          </div>
          <div class="font-dropdown-list">
            <For each={filteredFonts().slice(0, 100)}>
              {(font) => (
                <button
                  type="button"
                  classList={{
                    "font-dropdown-item": true,
                    active: props.fontFamily === font || props.fontFamily.startsWith(`"${font}"`) || props.fontFamily.startsWith(`${font},`),
                  }}
                  style={{ "font-family": `'${font}', sans-serif` }}
                  onClick={() => {
                    props.onFontFamilyChange(`'${font}', sans-serif`);
                    setIsOpen(false);
                  }}
                >
                  {font}
                </button>
              )}
            </For>
            <Show when={filteredFonts().length === 0}>
              <div class="font-dropdown-empty">No matching system fonts</div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
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
  restoreLastStateOnReopen?: boolean;
  onRestoreLastStateOnReopenChange?: (enabled: boolean) => void;
  showHiddenFiles?: boolean;
  onShowHiddenFilesChange?: (enabled: boolean) => void;
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
};

export function CustomizationSettings(props: CustomizationSettingsProps) {
  const showBackground = () => matchesQuery(props.searchQuery, BACKGROUND_KEYWORDS);
  const showTheme = () => matchesQuery(props.searchQuery, THEME_KEYWORDS);
  const showBehavior = () => matchesQuery(props.searchQuery, BEHAVIOR_KEYWORDS);

  const [apiKeyInput, setApiKeyInput] = createSignal("");

  const [cacheStats, setCacheStats] = createSignal<FolderSizeCacheStats | null>(null);
  const [cacheStatsError, setCacheStatsError] = createSignal("");
  const [clearingCache, setClearingCache] = createSignal(false);
  const [inPath, setInPath] = createSignal<boolean | null>(null);
  const [addingToPath, setAddingToPath] = createSignal(false);
  const [pathMessage, setPathMessage] = createSignal("");

  async function checkPathStatus() {
    try {
      const res = await invoke<boolean>("is_in_path");
      setInPath(res);
    } catch (e) {
      console.warn("Failed to check PATH status:", e);
    }
  }

  async function handleAddToPath() {
    setAddingToPath(true);
    setPathMessage("");
    try {
      await invoke("add_to_system_path");
      setInPath(true);
      setPathMessage("Flurer added to user PATH successfully!");
    } catch (err) {
      setPathMessage(`Failed: ${String(err)}`);
    } finally {
      setAddingToPath(false);
    }
  }

  async function refreshCacheStats() {
    try {
      setCacheStats(await invoke<FolderSizeCacheStats>("get_folder_size_cache_stats"));
      setCacheStatsError("");
    } catch (err) {
      setCacheStatsError(String(err));
    }
  }

  onMount(() => {
    refreshCacheStats();
    checkPathStatus();
  });

  async function handleClearCache() {
    setClearingCache(true);
    try {
      await invoke("clear_folder_size_cache");
      await refreshCacheStats();
    } catch (err) {
      setCacheStatsError(String(err));
    } finally {
      setClearingCache(false);
    }
  }

  function handleSaveApiKey() {
    props.onSaveUnsplashApiKey(apiKeyInput());
    setApiKeyInput("");
  }

  // Search state for the "From Fixed List" picker. Kept local to this
  // component rather than lifted into App-level settings — it's transient
  // browsing state, not something that needs to persist or survive a
  // restart the way the resulting unsplashFixedList does.
  const [wallpaperQuery, setWallpaperQuery] = createSignal("");
  const [wallpaperSearchPage, setWallpaperSearchPage] = createSignal(1);
  const [wallpaperResults, setWallpaperResults] = createSignal<WallpaperSearchResult[]>([]);
  const [wallpaperTotalPages, setWallpaperTotalPages] = createSignal(0);
  const [wallpaperSearching, setWallpaperSearching] = createSignal(false);
  const [wallpaperSearchError, setWallpaperSearchError] = createSignal("");

  async function runWallpaperSearch(page: number) {
    const query = wallpaperQuery().trim();
    if (!query) return;
    setWallpaperSearching(true);
    setWallpaperSearchError("");
    try {
      const result = await invoke<WallpaperSearchPage>("search_wallpapers", { query, page });
      setWallpaperResults(result.results);
      setWallpaperTotalPages(result.totalPages);
      setWallpaperSearchPage(page);
    } catch (err) {
      setWallpaperSearchError(String(err));
    } finally {
      setWallpaperSearching(false);
    }
  }

  function toggleFixedListUrl(url: string, checked: boolean) {
    const list = props.background.unsplashFixedList;
    const next = checked ? [...list, url] : list.filter((u) => u !== url);
    props.onBackgroundChange({ unsplashFixedList: next });
  }

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
            <div class="api-key-control">
              <label class="api-key-status" classList={{ configured: props.hasUnsplashApiKey }}>
                {props.hasUnsplashApiKey ? "Unsplash API key configured" : "No Unsplash API key set"}
              </label>
              <div class="api-key-input-row">
                <input
                  type="password"
                  class="api-key-input"
                  placeholder={props.hasUnsplashApiKey ? "Enter a new key to replace it" : "Unsplash API key"}
                  value={apiKeyInput()}
                  onInput={(e) => setApiKeyInput(e.currentTarget.value)}
                />
                <button type="button" onClick={handleSaveApiKey} disabled={!apiKeyInput().trim()}>
                  Save
                </button>
                {props.hasUnsplashApiKey && (
                  <button type="button" class="danger" onClick={() => props.onSaveUnsplashApiKey("")}>
                    Clear
                  </button>
                )}
              </div>
              {props.apiKeyError && <p class="settings-error">{props.apiKeyError}</p>}
            </div>

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
                <button type="button" onClick={() => props.onFetchWallpaper(props.background.unsplashCategories[0] || "nature")}>
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
                  <div class="option-group">
                    <For each={UNSPLASH_ROTATE_CATEGORIES}>
                      {(cat) => (
                        <button
                          type="button"
                          classList={{
                            "option-btn": true,
                            active: props.background.unsplashCategories.includes(cat),
                          }}
                          onClick={() => {
                            const list = props.background.unsplashCategories;
                            const next = list.includes(cat) ? list.filter((c) => c !== cat) : [...list, cat];
                            props.onBackgroundChange({ unsplashCategories: next });
                          }}
                        >
                          {cat}
                        </button>
                      )}
                    </For>
                  </div>
                )}

                {props.background.unsplashMode === "autoRotateCategory" && (
                  <div class="fixed-controls">
                    <button
                      type="button"
                      disabled={!props.canGoPrevCategoryWallpaper}
                      onClick={props.onPrevCategoryWallpaper}
                    >
                      ← Previous
                    </button>
                    <button type="button" onClick={props.onNextCategoryWallpaper}>
                      Next →
                    </button>
                    {/* Category rotation fetches a fresh random photo every
                        interval, so anything the user likes here is one tick
                        away from being replaced and gone for good — this is
                        the only way to keep a specific one around. Saving
                        just adds it to unsplashFixedList; it doesn't switch
                        mode, so rotation keeps going undisturbed. */}
                    <button
                      type="button"
                      disabled={!props.wallpaper || props.background.unsplashFixedList.includes(props.wallpaper.urls.regular)}
                      onClick={() => {
                        if (!props.wallpaper) return;
                        toggleFixedListUrl(props.wallpaper.urls.regular, true);
                      }}
                    >
                      {props.wallpaper && props.background.unsplashFixedList.includes(props.wallpaper.urls.regular)
                        ? "Saved to Fixed List"
                        : "Save to Fixed List"}
                    </button>
                  </div>
                )}

                {props.background.unsplashMode === "autoRotateList" && (
                  <div class="fixed-list-builder">
                    <form
                      class="wallpaper-search-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        runWallpaperSearch(1);
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Search Unsplash…"
                        value={wallpaperQuery()}
                        onInput={(e) => setWallpaperQuery(e.currentTarget.value)}
                        disabled={!props.hasUnsplashApiKey}
                      />
                      <button type="submit" disabled={!props.hasUnsplashApiKey || !wallpaperQuery().trim() || wallpaperSearching()}>
                        {wallpaperSearching() ? "Searching…" : "Search"}
                      </button>
                    </form>

                    {!props.hasUnsplashApiKey && <p class="settings-hint">Add an Unsplash API key above to search.</p>}
                    {wallpaperSearchError() && <p class="settings-error">{wallpaperSearchError()}</p>}

                    <Show when={wallpaperResults().length > 0}>
                      <div class="image-grid">
                        <For each={wallpaperResults()}>
                          {(img) => (
                            <label class="image-option">
                              <input
                                type="checkbox"
                                checked={props.background.unsplashFixedList.includes(img.urls.regular)}
                                onChange={(e) => toggleFixedListUrl(img.urls.regular, e.currentTarget.checked)}
                              />
                              <img src={img.urls.thumb} alt={img.description ?? "Unsplash photo"} loading="lazy" />
                              <span>{img.user.name}</span>
                            </label>
                          )}
                        </For>
                      </div>

                      <div class="wallpaper-search-pagination">
                        <button
                          type="button"
                          disabled={wallpaperSearchPage() <= 1 || wallpaperSearching()}
                          onClick={() => runWallpaperSearch(wallpaperSearchPage() - 1)}
                        >
                          Prev
                        </button>
                        <span>
                          Page {wallpaperSearchPage()} of {wallpaperTotalPages()}
                        </span>
                        <button
                          type="button"
                          disabled={wallpaperSearchPage() >= wallpaperTotalPages() || wallpaperSearching()}
                          onClick={() => runWallpaperSearch(wallpaperSearchPage() + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </Show>

                    <Show when={props.background.unsplashFixedList.length > 0}>
                      <div class="fixed-list-saved">
                        <h4>Saved images ({props.background.unsplashFixedList.length})</h4>
                        <div class="image-grid">
                          <For each={props.background.unsplashFixedList}>
                            {(url) => (
                              <div class="image-option saved-image">
                                <button
                                  type="button"
                                  class="image-remove-btn"
                                  title="Remove"
                                  aria-label="Remove"
                                  onClick={() => toggleFixedListUrl(url, false)}
                                >
                                  ×
                                </button>
                                <img src={sizedUnsplashUrl(url, THUMBNAIL_SIZE, THUMBNAIL_SIZE)} alt="Saved wallpaper" loading="lazy" />
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
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

        <div class="font-family-controls">
          <div class="option-group">
            <For each={FONT_FAMILY_PRESETS}>
              {(preset) => (
                <button
                  type="button"
                  classList={{ "option-btn": true, active: props.fontFamily === preset.value }}
                  style={{ "font-family": preset.value }}
                  onClick={() => props.onFontFamilyChange(preset.value)}
                >
                  {preset.label}
                </button>
              )}
            </For>
          </div>

          <FontSearchDropdown
            fontFamily={props.fontFamily}
            onFontFamilyChange={props.onFontFamilyChange}
          />
        </div>

        <label class="opacity-control font-size-control">
          UI Scale:
          <div class="font-size-inputs">
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step="0.01"
              value={fontSizePxToScale(props.fontSizePx)}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value);
                if (!isNaN(val)) {
                  props.onFontSizePxChange(scaleToFontSizePx(val));
                }
              }}
            />
            <input
              type="number"
              class="font-size-number-input"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step="0.01"
              value={fontSizePxToScale(props.fontSizePx).toFixed(2)}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value);
                if (!isNaN(val)) {
                  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, val));
                  props.onFontSizePxChange(scaleToFontSizePx(clamped));
                }
              }}
            />
            <span>x</span>
          </div>
        </label>
      </section>
      )}

      {showBehavior() && (
      <section class="settings-section">
        <h3>Behavior</h3>
        <label class="opacity-control">
          Sidebar tooltip delay: {props.sidebarTooltipDelayMs}ms
          <input
            type="range"
            min={100}
            max={2000}
            step={100}
            value={props.sidebarTooltipDelayMs}
            onInput={(e) => props.onSidebarTooltipDelayMsChange(e.currentTarget.valueAsNumber)}
          />
        </label>
        <label class="checkbox-control">
          <input
            type="checkbox"
            checked={props.showProgressWhenIdle}
            onChange={(e) => props.onShowProgressWhenIdleChange(e.currentTarget.checked)}
          />
          Always show progress indicator
        </label>

        <label class="checkbox-control">
          <input
            type="checkbox"
            checked={props.liveFolderSizeUpdates}
            onChange={(e) => props.onLiveFolderSizeUpdatesChange(e.currentTarget.checked)}
          />
          Automatically update folder sizes
        </label>
        <p class="settings-hint">
          Uses file changes to keep cached folder sizes current. Disable this to avoid background size work while files are changing.
        </p>

        <label class="history-limit-control">
          <span>Maximum recent history items</span>
          <input
            type="number"
            min={MIN_HISTORY_ITEMS}
            max={MAX_HISTORY_ITEMS}
            step="1"
            value={props.maxHistoryItems}
            onChange={(e) => props.onMaxHistoryItemsChange(e.currentTarget.valueAsNumber)}
          />
        </label>
        <p class="settings-hint">Controls how many recently visited folders are kept in the sidebar.</p>

        <div class="cache-stats-control">
          <span>Folder size cache</span>
          <Show
            when={cacheStats()}
            fallback={<span class="settings-hint">{cacheStatsError() || "Loading…"}</span>}
          >
            {(stats) => (
              <span class="settings-hint">
                {stats().visitedFolders.toLocaleString()} / {stats().visitedFoldersCap.toLocaleString()} visited folders
                remembered, {stats().discoveredSubfolders.toLocaleString()} / {stats().discoveredSubfoldersCap.toLocaleString()}{" "}
                discovered subfolders cached this session.
              </span>
            )}
          </Show>
          <button type="button" class="danger" disabled={clearingCache()} onClick={handleClearCache}>
            {clearingCache() ? "Clearing…" : "Clear cache"}
          </button>
        </div>
        <p class="settings-hint">
          Sizes recompute automatically as folders are revisited — clearing just frees the memory/disk this has built up, it
          doesn't affect anything else.
        </p>


        <label class="checkbox-control">
          <input
            type="checkbox"
            checked={props.restoreLastStateOnReopen ?? false}
            onChange={(e) => props.onRestoreLastStateOnReopenChange?.(e.currentTarget.checked)}
          />
          Preserve last folder state on reopen
        </label>
        <p class="settings-hint">
          Restores the folder location you were viewing when Flurer was last closed instead of starting at default drive.
        </p>

        <label class="checkbox-control">
          <input
            type="checkbox"
            checked={props.showHiddenFiles ?? false}
            onChange={(e) => props.onShowHiddenFilesChange?.(e.currentTarget.checked)}
          />
          Show hidden files and folders
        </label>
        <p class="settings-hint">
          Shows items starting with a dot or flagged as hidden in file listings (shortcut: Ctrl+H).
        </p>

        <div class="cache-stats-control">
          <span>Environment PATH</span>
          <Show
            when={inPath() === true}
            fallback={
              <button
                type="button"
                class="option-btn"
                disabled={addingToPath() || inPath() === null}
                onClick={handleAddToPath}
              >
                {addingToPath() ? "Adding..." : "Add Flurer to PATH"}
              </button>
            }
          >
            <span class="settings-hint" style={{ color: "var(--success-color, #4ea8de)", "font-weight": "600" }}>
              ✓ Flurer is in user PATH
            </span>
          </Show>
        </div>
        <Show when={pathMessage()}>
          <p class="settings-hint">{pathMessage()}</p>
        </Show>
        <p class="settings-hint">
          Appends Flurer's installation directory to your user PATH environment variable so you can launch `flurer .` or `flurer &lt;folder&gt;` directly from any terminal.
        </p>

        <label class="checkbox-control">
          <input
            type="checkbox"
            checked={props.launchAtStartup}
            onChange={(e) => props.onLaunchAtStartupChange(e.currentTarget.checked)}
          />
          Launch at startup (minimized to the tray)
        </label>
        <p class="settings-hint">
          Closing the window now minimizes to the tray instead of quitting, so the shortcut above keeps working. Enable
          this too if you want it live from the moment you log in, not just after opening Flurer once.
        </p>
      </section>
      )}
    </div>
  );
}
