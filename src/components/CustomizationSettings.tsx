import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { FolderSizeCacheStats } from "../lib/fs";
import { THEMES, type BackgroundSettings, type BackgroundType, type MetricKind, type Theme, type TopBarMetrics } from "../lib/settings";
import {
  FONT_FAMILY_PRESETS,
  GRADIENT_DIRECTIONS,
  GRADIENT_PRESETS,
  MAX_HISTORY_ITEMS,
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

import { FieldGroup, FieldRow } from "./ui/Field";
import { CollapsibleSection } from "./ui/CollapsibleSection";

const THUMBNAIL_SIZE = 160;

const BACKGROUND_TYPE_LABELS: Record<BackgroundType, string> = {
  none: "No Background",
  gradient: "Gradient",
  solid: "Solid Color",
  unsplash: "Unsplash",
};

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
  "Microsoft YaHe",
  "Microsoft Yi Baiti",
  "MingLiU-ExtB",
  "Mongolian Baiti",
  "MS Gothic",
  "MV Boli",
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
                  class="font-dropdown-item"
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
  topBarMetrics: TopBarMetrics;
  onTopBarMetricsChange: (patch: Partial<TopBarMetrics>) => void;
  onToggleTopBarMetricItem: (kind: MetricKind, id: string, enabled: boolean) => void;
  maxHistoryItems: number;
  onMaxHistoryItemsChange: (limit: number) => void;
  restoreLastStateOnReopen?: boolean;
  onRestoreLastStateOnReopenChange?: (enabled: boolean) => void;
  showHiddenFiles?: boolean;
  onShowHiddenFilesChange?: (enabled: boolean) => void;
  launchAtStartup: boolean;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  closeToTray: boolean;
  onCloseToTrayChange: (enabled: boolean) => void;
  launchAsAdmin: boolean;
  onLaunchAsAdminChange: (enabled: boolean) => void;
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
  type MetricDevices = {
    drives: { id: string; label: string; total: number }[];
    networks: { id: string; name: string }[];
    gpus: { id: string; name: string; memTotal: number }[];
  };
  const [metricDevices, setMetricDevices] = createSignal<MetricDevices | null>(null);
  // Device lists (drives/NICs/GPUs) only matter once the user is configuring
  // the metrics bar — fetch lazily when the section becomes relevant rather
  // than paying a DXGI/sysinfo walk on every Settings open.
  createEffect(() => {
    if (!props.topBarMetrics.enabled || metricDevices()) return;
    invoke<MetricDevices>("get_metric_devices")
      .then(setMetricDevices)
      .catch((err) => console.error("get_metric_devices failed", err));
  });

  function metricItemChecked(kind: MetricKind, id: string): boolean {
    return props.topBarMetrics.items.some((item) => item.kind === kind && item.id === id);
  }

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
      {/* ── Background ──────────────────────────────────────────── */}
      <CollapsibleSection
        id="customization.background"
        title="Background"
        description="How the wallpaper is drawn behind the app."
      >
        <FieldGroup>
          <FieldRow
            id="customization.background.type"
            label="Background type"
            description="Nothing, a gradient, a flat colour, or photos from Unsplash."
            fullWidth
          >
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
          </FieldRow>

          <Show when={props.background.backgroundType !== "none"}>
            <FieldRow
              id="customization.background.opacity"
              label="Background opacity"
              description="How much of the wallpaper shows through the interface."
            >
              <div class="setting-control-slider">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={props.background.opacity}
                  onInput={(e) => props.onBackgroundChange({ opacity: e.currentTarget.valueAsNumber })}
                />
                <span class="setting-value">{(props.background.opacity * 100).toFixed(1)}%</span>
              </div>
            </FieldRow>
          </Show>
        </FieldGroup>
      </CollapsibleSection>

      {/* ── Gradient ────────────────────────────────────────────── */}
      <Show when={props.background.backgroundType === "gradient"}>
        <CollapsibleSection
          id="customization.gradient"
          title="Gradient"
          description="A two-colour gradient behind the interface."
        >
          <FieldGroup>
            <FieldRow id="customization.gradient.presets" label="Gradient presets" fullWidth>
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
            </FieldRow>

            <FieldRow
              id="customization.gradient.colors"
              label="Gradient colours"
              description="Start colour, end colour and the direction the gradient runs in."
              fullWidth
            >
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
            </FieldRow>
          </FieldGroup>
        </CollapsibleSection>
      </Show>

      {/* ── Solid colour ───────────────────────────────────────── */}
      <Show when={props.background.backgroundType === "solid"}>
        <CollapsibleSection
          id="customization.solid"
          title="Solid colour"
          description="A single flat colour behind the interface."
        >
          <FieldGroup>
            <FieldRow id="customization.solid.presets" label="Colour presets" fullWidth>
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
            </FieldRow>

            <FieldRow
              id="customization.solid.custom"
              label="Custom colour"
              description="Any hex value or rgb() expression."
              fullWidth
            >
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
            </FieldRow>
          </FieldGroup>
        </CollapsibleSection>
      </Show>

      {/* ── Wallpaper (Unsplash) ───────────────────────────────── */}
      <Show when={props.background.backgroundType === "unsplash"}>
        <CollapsibleSection
          id="customization.wallpaper"
          title="Wallpaper"
          description="Photos from Unsplash, on rotation or fixed."
        >
          <FieldGroup>
            <FieldRow
              id="customization.wallpaper.apiKey"
              label="Unsplash API key"
              description="Required to fetch and search photos."
              fullWidth
            >
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
                  <Show when={props.hasUnsplashApiKey}>
                    <button type="button" class="danger" onClick={() => props.onSaveUnsplashApiKey("")}>
                      Clear
                    </button>
                  </Show>
                </div>
                <Show when={props.apiKeyError}>
                  <p class="settings-error">{props.apiKeyError}</p>
                </Show>
              </div>
            </FieldRow>

            <FieldRow
              id="customization.wallpaper.rotation"
              label="Rotation"
              description="Show one fixed photo, or rotate through them automatically."
              fullWidth
            >
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
            </FieldRow>

            <Show when={props.background.unsplashMode === "fixed"}>
              <FieldRow
                id="customization.wallpaper.fixed"
                label="Get wallpaper"
                description="Fetch a photo from the first rotation category."
                fullWidth
              >
                <div class="fixed-controls">
                  <button type="button" onClick={() => props.onFetchWallpaper(props.background.unsplashCategories[0] || "nature")}>
                    Get Wallpaper
                  </button>
                </div>
              </FieldRow>
            </Show>

            <Show when={props.background.unsplashMode !== "fixed"}>
              <FieldRow
                id="customization.wallpaper.source"
                label="Source"
                description="Rotate through Unsplash categories, or through your own saved list."
                fullWidth
              >
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
              </FieldRow>

              <FieldRow id="customization.wallpaper.frequency" label="Change every">
                <div class="setting-control-select">
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
                </div>
              </FieldRow>

              <Show when={props.background.unsplashMode === "autoRotateCategory"}>
                <FieldRow
                  id="customization.wallpaper.categories"
                  label="Categories"
                  description="Each category contributes photos to the rotation."
                  fullWidth
                >
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
                </FieldRow>

                <FieldRow id="customization.wallpaper.preview" label="Current photo" fullWidth>
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
                </FieldRow>
              </Show>

              <Show when={props.background.unsplashMode === "autoRotateList"}>
                <FieldRow
                  id="customization.wallpaper.search"
                  label="Search Unsplash"
                  description="Find photos and tick the ones to add to the rotation."
                  fullWidth
                >
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

                  <Show when={!props.hasUnsplashApiKey}>
                    <p class="setting-note">Add an Unsplash API key above to search.</p>
                  </Show>
                  <Show when={wallpaperSearchError()}>
                    <p class="settings-error">{wallpaperSearchError()}</p>
                  </Show>

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
                </FieldRow>

                <FieldRow
                  id="customization.wallpaper.saved"
                  label="Saved wallpapers"
                  description="Photos in your fixed rotation list."
                  fullWidth
                >
                  <Show
                    when={props.background.unsplashFixedList.length > 0}
                    fallback={<p class="setting-note">Nothing saved yet — tick a search result to add it.</p>}
                  >
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
                  </Show>
                </FieldRow>
              </Show>
            </Show>

            <Show when={props.wallpaperError}>
              <p class="settings-error">{props.wallpaperError}</p>
            </Show>
            <Show when={props.wallpaper}>
              {(wallpaper) => (
                <p class="wallpaper-credit">
                  Photo by{" "}
                  <a href={`https://unsplash.com/@${wallpaper().user.username}`} target="_blank">
                    {wallpaper().user.name}
                  </a>{" "}
                  on Unsplash
                </p>
              )}
            </Show>
          </FieldGroup>
        </CollapsibleSection>
      </Show>

      {/* ── Theme ───────────────────────────────────────────────── */}
      <CollapsibleSection
        id="customization.theme"
        title="Theme"
        description="Colour scheme and how translucent the panels are."
      >
        <FieldGroup>
          <FieldRow id="customization.theme.theme" label="Theme" fullWidth>
            <div class="option-group">
              <For each={THEMES}>
                {(t) => (
                  <button
                    type="button"
                    classList={{ "option-btn": true, active: props.theme === t.value }}
                    onClick={() => props.onThemeChange(t.value)}
                  >
                    {t.label}
                  </button>
                )}
              </For>
            </div>
          </FieldRow>

          <FieldRow
            id="customization.theme.tint"
            label="Panel tint"
            description="How strongly the panels take on the panel colour."
          >
            <div class="setting-control-slider">
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={props.uiTintOpacity}
                onInput={(e) => props.onUiTintOpacityChange(e.currentTarget.valueAsNumber)}
              />
              <span class="setting-value">{(props.uiTintOpacity * 100).toFixed(1)}%</span>
            </div>
          </FieldRow>

          <FieldRow
            id="customization.theme.blur"
            label="Panel blur"
            description="Softens everything behind the interface."
          >
            <div class="setting-control-slider">
              <input
                type="range"
                min="0"
                max="32"
                step="1"
                value={props.uiBlurPx}
                onInput={(e) => props.onUiBlurPxChange(e.currentTarget.valueAsNumber)}
              />
              <span class="setting-value">{props.uiBlurPx.toFixed(0)}px</span>
            </div>
          </FieldRow>
        </FieldGroup>
      </CollapsibleSection>

      {/* ── Typography ──────────────────────────────────────────── */}
      <CollapsibleSection
        id="customization.typography"
        title="Typography"
        description="Typeface and interface scale."
      >
        <FieldGroup>
          <FieldRow
            id="customization.typography.family"
            label="Font family"
            description="Pick a preset or search the fonts installed on this machine."
            fullWidth
          >
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
          </FieldRow>

          <FieldRow
            id="customization.typography.scale"
            label="UI scale"
            description="Scales every size in the interface, including text."
          >
            <div class="setting-control-slider">
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
              <span class="setting-suffix">x</span>
            </div>
          </FieldRow>
        </FieldGroup>
      </CollapsibleSection>

      {/* ── Behavior ────────────────────────────────────────────── */}
      <CollapsibleSection
        id="customization.behavior"
        title="Behavior"
        description="How the interface reacts while you work."
      >
        <FieldGroup>
          <FieldRow
            id="customization.behavior.tooltipDelay"
            label="Sidebar tooltip delay"
            description="How long to wait before a sidebar tooltip appears."
          >
            <div class="setting-control-slider">
              <input
                type="range"
                min={100}
                max={2000}
                step={100}
                value={props.sidebarTooltipDelayMs}
                onInput={(e) => props.onSidebarTooltipDelayMsChange(e.currentTarget.valueAsNumber)}
              />
              <span class="setting-value">{props.sidebarTooltipDelayMs}ms</span>
            </div>
          </FieldRow>

          <FieldRow
            id="customization.behavior.progress"
            label="Always show progress indicator"
            description="Keeps the progress panel visible even when nothing is running."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Always show progress indicator"
              checked={props.showProgressWhenIdle}
              onChange={(e) => props.onShowProgressWhenIdleChange(e.currentTarget.checked)}
            />
          </FieldRow>

          <FieldRow
            id="customization.behavior.folderSize"
            label="Automatically update folder sizes"
            description="Uses file changes to keep cached folder sizes current. Disable to avoid background size work while files are changing."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Automatically update folder sizes"
              checked={props.liveFolderSizeUpdates}
              onChange={(e) => props.onLiveFolderSizeUpdatesChange(e.currentTarget.checked)}
            />
          </FieldRow>

          <FieldRow
            id="customization.behavior.history"
            label="Maximum recent history items"
            description="How many recently visited folders are kept in the sidebar."
          >
            <div class="setting-control-select">
              <input
                type="number"
                min={MIN_HISTORY_ITEMS}
                max={MAX_HISTORY_ITEMS}
                step="1"
                value={props.maxHistoryItems}
                onChange={(e) => props.onMaxHistoryItemsChange(e.currentTarget.valueAsNumber)}
              />
            </div>
          </FieldRow>

          <FieldRow
            id="customization.behavior.hiddenFiles"
            label="Show hidden files and folders"
            description="Shows items starting with a dot or flagged as hidden in file listings (shortcut: Ctrl+H)."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Show hidden files and folders"
              checked={props.showHiddenFiles ?? false}
              onChange={(e) => props.onShowHiddenFilesChange?.(e.currentTarget.checked)}
            />
          </FieldRow>

          <FieldRow
            id="customization.behavior.restoreState"
            label="Preserve last folder state on reopen"
            description="Restores the folder location you were viewing when Flurer was last closed instead of starting at the default drive."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Preserve last folder state on reopen"
              checked={props.restoreLastStateOnReopen ?? false}
              onChange={(e) => props.onRestoreLastStateOnReopenChange?.(e.currentTarget.checked)}
            />
          </FieldRow>
        </FieldGroup>
      </CollapsibleSection>

      {/* ── Top bar metrics ─────────────────────────────────────── */}
      <CollapsibleSection
        id="customization.metrics"
        title="Top bar metrics"
        description="Live CPU, memory, GPU, drive and network widgets."
      >
        <FieldGroup>
          <FieldRow
            id="customization.metrics.enabled"
            label="Show system metrics in the top bar"
            description="Hover a widget for details; click it to keep the panel open."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Show system metrics in the top bar"
              checked={props.topBarMetrics.enabled}
              onChange={(e) => props.onTopBarMetricsChange({ enabled: e.currentTarget.checked })}
            />
          </FieldRow>

          <Show when={props.topBarMetrics.enabled}>
            <FieldRow id="customization.metrics.interval" label="Refresh interval">
              <div class="setting-control-select">
                <select
                  value={String(props.topBarMetrics.intervalSeconds)}
                  onChange={(e) => props.onTopBarMetricsChange({ intervalSeconds: Number(e.currentTarget.value) })}
                >
                  <For each={[1, 2, 3, 5, 10]}>{(s) => <option value={String(s)}>{s} s</option>}</For>
                </select>
              </div>
            </FieldRow>

            <FieldRow
              id="customization.metrics.devices"
              label="Devices"
              description="Pick which devices get a widget in the top bar."
              fullWidth
            >
              <div class="metrics-device-groups">
                <div class="metrics-device-group">
                  <span class="metrics-device-group-title">Processor &amp; memory</span>
                  <label class="checkbox-control">
                    <input
                      type="checkbox"
                      checked={metricItemChecked("cpu", "cpu")}
                      onChange={(e) => props.onToggleTopBarMetricItem("cpu", "cpu", e.currentTarget.checked)}
                    />
                    CPU usage
                  </label>
                  <label class="checkbox-control">
                    <input
                      type="checkbox"
                      checked={metricItemChecked("memory", "memory")}
                      onChange={(e) => props.onToggleTopBarMetricItem("memory", "memory", e.currentTarget.checked)}
                    />
                    Memory usage
                  </label>
                </div>

                <div class="metrics-device-group">
                  <span class="metrics-device-group-title">GPUs</span>
                  <Show
                    when={(metricDevices()?.gpus.length ?? 0) > 0}
                    fallback={<span class="metrics-device-empty">No dedicated GPUs detected.</span>}
                  >
                    <For each={metricDevices()?.gpus ?? []}>
                      {(gpu) => (
                        <label class="checkbox-control">
                          <input
                            type="checkbox"
                            checked={metricItemChecked("gpu", gpu.id)}
                            onChange={(e) => props.onToggleTopBarMetricItem("gpu", gpu.id, e.currentTarget.checked)}
                          />
                          {gpu.name}
                        </label>
                      )}
                    </For>
                  </Show>
                </div>

                <div class="metrics-device-group">
                  <span class="metrics-device-group-title">Drives</span>
                  <Show
                    when={(metricDevices()?.drives.length ?? 0) > 0}
                    fallback={<span class="metrics-device-empty">No drives detected.</span>}
                  >
                    <For each={metricDevices()?.drives ?? []}>
                      {(drive) => (
                        <label class="checkbox-control">
                          <input
                            type="checkbox"
                            checked={metricItemChecked("drive", drive.id)}
                            onChange={(e) => props.onToggleTopBarMetricItem("drive", drive.id, e.currentTarget.checked)}
                          />
                          {drive.id} — {drive.label || "Local disk"}
                        </label>
                      )}
                    </For>
                  </Show>
                </div>

                <div class="metrics-device-group">
                  <span class="metrics-device-group-title">Network interfaces</span>
                  <Show
                    when={(metricDevices()?.networks.length ?? 0) > 0}
                    fallback={<span class="metrics-device-empty">No network interfaces detected.</span>}
                  >
                    <For each={metricDevices()?.networks ?? []}>
                      {(net) => (
                        <label class="checkbox-control">
                          <input
                            type="checkbox"
                            checked={metricItemChecked("network", net.id)}
                            onChange={(e) => props.onToggleTopBarMetricItem("network", net.id, e.currentTarget.checked)}
                          />
                          {net.name}
                        </label>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </FieldRow>
          </Show>
        </FieldGroup>
      </CollapsibleSection>

      {/* ── Startup & system ────────────────────────────────────── */}
      <CollapsibleSection
        id="customization.startup"
        title="Startup & system"
        description="How Flurer launches and integrates with the OS."
      >
        <FieldGroup>
          <FieldRow
            id="customization.startup.launchAtStartup"
            label="Launch at startup"
            description="Launches Flurer minimized to the system tray on login, so global hotkeys work immediately without manually opening the app."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Launch at startup"
              checked={props.launchAtStartup}
              onChange={(e) => props.onLaunchAtStartupChange(e.currentTarget.checked)}
            />
          </FieldRow>

          <FieldRow
            id="customization.startup.closeToTray"
            label="Close to tray"
            description="When closing the window, minimize to the system notification area/tray instead of quitting Flurer."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Close to tray"
              checked={props.closeToTray}
              onChange={(e) => props.onCloseToTrayChange(e.currentTarget.checked)}
            />
          </FieldRow>

          <FieldRow
            id="customization.startup.launchAsAdmin"
            label="Always run as administrator"
            description="Prompts for UAC and relaunches elevated when enabled, and on every future launch. Turning it off takes effect the next time Flurer is started normally."
          >
            <input
              type="checkbox"
              class="setting-checkbox"
              aria-label="Always run as administrator"
              checked={props.launchAsAdmin}
              onChange={(e) => props.onLaunchAsAdminChange(e.currentTarget.checked)}
            />
          </FieldRow>

          <FieldRow
            id="customization.startup.path"
            label="Environment PATH"
            description="Appends Flurer's installation directory to your user PATH environment variable so you can launch `flurer .` or `flurer <folder>` directly from any terminal."
          >
            <div class="setting-control-inline">
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
                <span class="settings-success">✓ Flurer is in user PATH</span>
              </Show>
            </div>
          </FieldRow>

          <Show when={pathMessage()}>
            <p class="setting-note">{pathMessage()}</p>
          </Show>
        </FieldGroup>
      </CollapsibleSection>

      {/* ── Storage ─────────────────────────────────────────────── */}
      <CollapsibleSection
        id="customization.storage"
        title="Storage"
        description="The folder-size cache and how much it holds."
      >
        <FieldGroup>
          <FieldRow
            id="customization.storage.cache"
            label="Folder size cache"
            description="Sizes recompute automatically as folders are revisited — clearing just frees the memory and disk this has built up, it doesn't affect anything else."
          >
            <div class="setting-control-inline">
              <Show
                when={cacheStats()}
                fallback={<span class="setting-note">{cacheStatsError() || "Loading…"}</span>}
              >
                {(stats) => (
                  <span class="setting-note">
                    {stats().visitedFolders.toLocaleString()} / {stats().visitedFoldersCap.toLocaleString()} folders remembered,{" "}
                    {stats().discoveredSubfolders.toLocaleString()} / {stats().discoveredSubfoldersCap.toLocaleString()}{" "}
                    subfolders cached
                  </span>
                )}
              </Show>
              <button type="button" class="danger" disabled={clearingCache()} onClick={handleClearCache}>
                {clearingCache() ? "Clearing…" : "Clear cache"}
              </button>
            </div>
          </FieldRow>
        </FieldGroup>
      </CollapsibleSection>
    </div>
  );
}
