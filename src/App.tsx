import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { CommandBar } from "./components/CommandBar";
import { ExplorerPathBar } from "./components/ExplorerPathBar";
import { ExplorerView } from "./components/ExplorerView";
import { GraphView } from "./components/GraphView";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { ViewRail } from "./components/ViewRail";
import { DEFAULT_SETTINGS, type BackgroundSettings, type GraphState, type Settings, type Theme } from "./lib/settings";
import type { SortKey } from "./lib/fs";
import { getDisplaySize, type CachedWallpaper, type Wallpaper } from "./lib/unsplash";
import type { GraphFocusRequest, MainView } from "./lib/view";
import "./App.css";

const DEFAULT_PATH = "C:\\";
const SETTINGS_SAVE_DEBOUNCE_MS = 300;
const RECENTS_LIMIT = 15;

type HistoryEntry = { view: MainView; path: string };

function App() {
  const [currentPath, setCurrentPath] = createSignal(DEFAULT_PATH);
  const [pathInput, setPathInput] = createSignal(DEFAULT_PATH);
  const [mainView, setMainView] = createSignal<MainView>("explorer");
  const [history, setHistory] = createSignal<HistoryEntry[]>([{ view: "explorer", path: DEFAULT_PATH }]);
  const [historyIndex, setHistoryIndex] = createSignal(0);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchRecursive, setSearchRecursive] = createSignal(false);
  const [wallpaper, setWallpaper] = createSignal<Wallpaper | null>(null);
  const [wallpaperError, setWallpaperError] = createSignal("");
  // Whether an Unsplash API key is configured — never the key itself. It's
  // stored via the OS credential store (see src-tauri/src/configs/mod.rs),
  // deliberately outside of Settings, so it's never round-tripped back to
  // the renderer in plain text.
  const [hasUnsplashApiKey, setHasUnsplashApiKey] = createSignal(false);
  const [apiKeyError, setApiKeyError] = createSignal("");
  // The current rotation-list image, already downloaded and re-encoded as a
  // data: URL — never a hotlinked Unsplash URL (see fetchRotationImage).
  const [rotationImage, setRotationImage] = createSignal<string | null>(null);
  const [rotationError, setRotationError] = createSignal("");
  // Last session's wallpaper, read straight off disk (no network) so startup
  // never has to wait on Unsplash — the real fetch below still runs, and
  // silently replaces this once it resolves.
  const [cachedWallpaper, setCachedWallpaper] = createSignal<CachedWallpaper | null>(null);
  const [wallpaperCacheChecked, setWallpaperCacheChecked] = createSignal(false);
  const cachedWallpaperImage = () => cachedWallpaper()?.dataUrl ?? null;
  // A plain value, not a signal — screen resolution doesn't change when the
  // window is resized, so there's nothing to react to (see getDisplaySize).
  const windowSize = getDisplaySize();

  const [wallpaperRGB, setWallpaperRGB] = createSignal<{r: number; g: number; b: number} | null>(null);

  function parseHexColor(hex: string): {r: number; g: number; b: number} {
    let cleanHex = hex.trim().replace("#", "");
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split("").map(c => c + c).join("");
    }
    if (cleanHex.length !== 6) {
      return { r: 128, g: 128, b: 128 };
    }
    const num = parseInt(cleanHex, 16);
    if (isNaN(num)) {
      return { r: 128, g: 128, b: 128 };
    }
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function getAverageColor(imageUrl: string): Promise<{r: number; g: number; b: number} | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imageUrl;
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, 1, 1);
          const data = ctx.getImageData(0, 0, 1, 1).data;
          resolve({ r: data[0], g: data[1], b: data[2] });
        } catch (e) {
          console.error("Canvas average color extraction failed", e);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
    });
  }

  function getPanelLightness(
    tintRGB: {r: number; g: number; b: number},
    opacity: number
  ): "light" | "dark" {
    const fallbackWall = settings.theme === "dark" ? { r: 32, g: 32, b: 32 } : { r: 255, g: 255, b: 255 };
    const wall = wallpaperRGB() ?? fallbackWall;
    
    // Blend colors
    const r = tintRGB.r * opacity + wall.r * (1 - opacity);
    const g = tintRGB.g * opacity + wall.g * (1 - opacity);
    const b = tintRGB.b * opacity + wall.b * (1 - opacity);
    
    // Relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "light" : "dark";
  }

  const shellLightness = createMemo(() => {
    const isDark = settings.theme === "dark";
    const tintRGB = isDark ? { r: 32, g: 32, b: 32 } : { r: 243, g: 243, b: 243 };
    const opacity = settings.uiTintOpacity;
    return getPanelLightness(tintRGB, opacity);
  });

  const sidebarLightness = createMemo(() => {
    const isDark = settings.theme === "dark";
    const tintRGB = isDark ? { r: 32, g: 32, b: 32 } : { r: 243, g: 243, b: 243 };
    const opacity = settings.uiTintOpacity;
    return getPanelLightness(tintRGB, opacity);
  });

  const fileListLightness = createMemo(() => {
    const isDark = settings.theme === "dark";
    const tintRGB = isDark ? { r: 32, g: 32, b: 32 } : { r: 255, g: 255, b: 255 };
    const opacity = settings.uiTintOpacity;
    return getPanelLightness(tintRGB, opacity);
  });

  createEffect(() => {
    const bg = settings.background;
    const bgType = bg.backgroundType;
    const solidColor = bg.solidColor;
    const grad1 = bg.gradientColor1;
    const grad2 = bg.gradientColor2;
    const liveUrl = bg.unsplashMode === "autoRotateList" ? rotationImage() : wallpaper()?.localDataUrl;
    const dataUrl = liveUrl ?? cachedWallpaperImage();

    if (bgType === "solid") {
      setWallpaperRGB(parseHexColor(solidColor));
    } else if (bgType === "gradient") {
      const c1 = parseHexColor(grad1);
      const c2 = parseHexColor(grad2);
      setWallpaperRGB({
        r: Math.round((c1.r + c2.r) / 2),
        g: Math.round((c1.g + c2.g) / 2),
        b: Math.round((c1.b + c2.b) / 2)
      });
    } else if (bgType === "unsplash" && dataUrl) {
      getAverageColor(dataUrl).then((color) => {
        if (color) setWallpaperRGB(color);
      });
    } else {
      setWallpaperRGB(null);
    }
  });

  const [settings, setSettings] = createStore<Settings>(DEFAULT_SETTINGS);
  // GraphView is always mounted (see the view-stack below) and needs to know
  // once settings have actually finished loading before it can trust
  // settings.graphState — otherwise it can't tell "nothing saved yet" apart
  // from "hasn't arrived from disk yet", since both look like `null`.
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);

  onMount(async () => {
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
      if (loaded.lastMainView === "graph") {
        setMainView("graph");
        setHistory([{ view: "graph", path: currentPath() }]);
      }
    } catch (err) {
      console.error("Failed to load settings", err);
    } finally {
      setSettingsLoaded(true);
    }
  });

  onMount(async () => {
    try {
      setHasUnsplashApiKey(await invoke<boolean>("has_unsplash_api_key"));
    } catch (err) {
      console.error("Failed to check Unsplash API key status", err);
    }
  });

  onMount(async () => {
    try {
      setCachedWallpaper(await invoke<CachedWallpaper | null>("get_cached_wallpaper_image"));
    } catch (err) {
      console.error("Failed to read cached wallpaper", err);
    } finally {
      setWallpaperCacheChecked(true);
    }
  });

  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  function persistSettings() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      invoke("set_settings", { settings: unwrap(settings) }).catch((err) =>
        console.error("Failed to save settings", err),
      );
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  }

  function updateBackground(patch: Partial<BackgroundSettings>) {
    setSettings("background", patch);
    persistSettings();
  }

  function updateTheme(theme: Theme) {
    setSettings("theme", theme);
    persistSettings();
  }

  function updateUiTintOpacity(opacity: number) {
    setSettings("uiTintOpacity", opacity);
    persistSettings();
  }

  function updateUiBlurPx(blurPx: number) {
    setSettings("uiBlurPx", blurPx);
    persistSettings();
  }

  function updateFontFamily(fontFamily: string) {
    setSettings("fontFamily", fontFamily);
    persistSettings();
  }

  function updateFontSizePx(fontSizePx: number) {
    setSettings("fontSizePx", fontSizePx);
    persistSettings();
  }

  function updateSidebarTooltipDelayMs(delayMs: number) {
    setSettings("sidebarTooltipDelayMs", delayMs);
    persistSettings();
  }

  function updatePersistGraphState(enabled: boolean) {
    setSettings("persistGraphState", enabled);
    persistSettings();
  }

  function updateShowProgressWhenIdle(show: boolean) {
    setSettings("showProgressWhenIdle", show);
    persistSettings();
  }

  function updateGraphState(state: GraphState) {
    setSettings("graphState", state);
    persistSettings();
  }

  function toggleFavourite(path: string) {
    const isFavourite = settings.favouritePaths.includes(path);
    setSettings(
      "favouritePaths",
      isFavourite ? settings.favouritePaths.filter((p) => p !== path) : [...settings.favouritePaths, path],
    );
    persistSettings();
  }

  // Most-recent-first, deduped (revisiting a path just moves it back to the
  // front rather than adding a second entry), capped so the list can't grow
  // forever.
  function recordRecent(path: string) {
    const next = [path, ...settings.recentPaths.filter((p) => p !== path)].slice(0, RECENTS_LIMIT);
    setSettings("recentPaths", next);
    persistSettings();
  }

  function removeRecent(path: string) {
    setSettings(
      "recentPaths",
      settings.recentPaths.filter((p) => p !== path),
    );
    persistSettings();
  }

  // Clicking the same column again flips direction; clicking a different one
  // switches to it starting ascending — same behavior ExplorerView used to
  // handle locally, just persisted now so it survives a restart.
  function updateSort(key: SortKey) {
    if (key === settings.sortKey) {
      setSettings("sortDirection", settings.sortDirection === "ascending" ? "descending" : "ascending");
    } else {
      setSettings("sortKey", key);
      setSettings("sortDirection", "ascending");
    }
    persistSettings();
  }

  async function saveUnsplashApiKey(key: string) {
    setApiKeyError("");
    try {
      await invoke("set_unsplash_api_key", { key });
      setHasUnsplashApiKey(key.trim().length > 0);
    } catch (err) {
      setApiKeyError(String(err));
    }
  }

  async function getWallpaper(query: string) {
    setWallpaperError("");
    try {
      const result = await invoke<Wallpaper>("get_wallpaper", {
        query,
        width: windowSize.width,
        height: windowSize.height,
      });
      setWallpaper(result);
    } catch (err) {
      setWallpaperError(String(err));
    }
  }

  // Downloads and caches (server-side) the image at `url`, returning a
  // data: URL — used for the fixed rotation list, where the image URL is
  // already known and doesn't need an Unsplash API lookup first.
  async function fetchRotationImage(url: string) {
    setRotationError("");
    try {
      const dataUrl = await invoke<string>("fetch_wallpaper_image", {
        url,
        width: windowSize.width,
        height: windowSize.height,
      });
      setRotationImage(dataUrl);
    } catch (err) {
      setRotationError(String(err));
    }
  }

  let suppressHistoryPush = false;

  function pushHistory(entry: HistoryEntry) {
    if (suppressHistoryPush) return;
    const h = history();
    const current = h[historyIndex()];
    if (current && current.view === entry.view && current.path === entry.path) return;
    const truncated = h.slice(0, historyIndex() + 1);
    const next = [...truncated, entry];
    setHistory(next);
    setHistoryIndex(next.length - 1);
  }

  function applyHistoryEntry(entry: HistoryEntry, index: number) {
    suppressHistoryPush = true;
    setHistoryIndex(index);
    setMainView(entry.view);
    setCurrentPath(entry.path);
    setPathInput(entry.path);
    suppressHistoryPush = false;
  }

  function goBack() {
    const index = historyIndex();
    if (index <= 0) return;
    applyHistoryEntry(history()[index - 1], index - 1);
  }

  function goForward() {
    const h = history();
    const index = historyIndex();
    if (index >= h.length - 1) return;
    applyHistoryEntry(h[index + 1], index + 1);
  }

  function navigateTo(path: string) {
    setCurrentPath(path);
    setPathInput(path);
    setMainView("explorer");
    pushHistory({ view: "explorer", path });
    recordRecent(path);
  }

  function selectView(view: MainView) {
    setMainView(view);
    pushHistory({ view, path: currentPath() });
  }

  const [graphFocusRequest, setGraphFocusRequest] = createSignal<GraphFocusRequest | null>(null);

  // Picking a place from the sidebar (a drive, a recent/favourite folder, or
  // a quick-access shortcut) normally jumps to Explorer — but while already
  // looking at the storage graph, jumping away from it is more disruptive
  // than useful, so this asks GraphView to expand and center on that path's
  // node there instead.
  function selectSidebarPath(path: string) {
    if (mainView() === "graph") {
      setGraphFocusRequest((prev) => ({ path, token: (prev?.token ?? 0) + 1 }));
      return;
    }
    navigateTo(path);
  }

  function closeSettings() {
    if (historyIndex() > 0) {
      goBack();
    } else {
      selectView("explorer");
    }
  }

  createEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  });

  createEffect(() => {
    document.documentElement.style.setProperty("--surface-opacity", String(settings.uiTintOpacity));
  });

  createEffect(() => {
    document.documentElement.style.setProperty("--surface-blur", `${settings.uiBlurPx}px`);
  });

  createEffect(() => {
    document.documentElement.style.setProperty("--font-family", settings.fontFamily);
  });

  createEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${settings.fontSizePx}px`);
  });

  createEffect(() => {
    document.documentElement.style.setProperty("--sidebar-tooltip-delay", `${settings.sidebarTooltipDelayMs}ms`);
  });

  // Settings has no "settings" view value of its own — only remember whether
  // the user was last looking at the explorer or the graph, so relaunching
  // the app doesn't strand them on the settings page.
  createEffect(() => {
    const view = mainView();
    if (view === "settings") return;
    if (settings.lastMainView !== view) {
      setSettings("lastMainView", view);
      persistSettings();
    }
  });

  // Reads the shared "wallpaper last updated" timestamp (written by whichever
  // instance actually downloads an image) so a scheduled refresh only
  // happens once it's genuinely due, rather than every window/process
  // fetching independently on its own timer — this is what keeps multiple
  // open instances showing the same background.
  async function getWallpaperUpdatedAt(): Promise<number | null> {
    try {
      return await invoke<number | null>("get_wallpaper_updated_at");
    } catch (err) {
      console.error("Failed to read wallpaper metadata", err);
      return null;
    }
  }

  // Whether the on-disk cache's recorded source (a category, or a fixed-list
  // URL) is one `expectedKeys` would consider correct for the current mode.
  // A cache with no recorded key (nothing ever cached, or a file predating
  // this field) counts as "unknown", not a match.
  function cachedWallpaperMatches(expectedKeys: string[]): boolean {
    const key = cachedWallpaper()?.sourceKey;
    return !!key && expectedKeys.includes(key);
  }

  // Drives both auto-rotate modes: on `forceImmediate` (the user just
  // changed the relevant setting) it fetches right away; otherwise it checks
  // the shared timestamp and either fetches now (if due) or schedules a
  // check for exactly when it becomes due — self-correcting if another
  // instance updates it in the meantime. Also fetches immediately, skipping
  // the staleness check, whenever nothing already fetched this session is
  // showing AND the on-disk cache doesn't match `expectedKeys` — covers both
  // "nothing cached at all" and "the cache is a photo left over from a mode
  // the user switched away from since it was written", either of which the
  // shared timestamp alone can't distinguish from a genuine fresh match and
  // would otherwise leave stuck (or showing the wrong photo) for the rest of
  // the refresh interval.
  function scheduleWallpaperRefresh(
    frequencyMs: number,
    forceImmediate: boolean,
    expectedKeys: string[],
    fetchOne: () => Promise<void>,
  ) {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function tick(force: boolean) {
      if (cancelled) return;
      const hasLiveImage = !!wallpaper() || !!rotationImage();
      const needsFetch = force || (!hasLiveImage && !cachedWallpaperMatches(expectedKeys));
      const updatedAt = needsFetch ? null : await getWallpaperUpdatedAt();
      if (cancelled) return;
      const elapsed = updatedAt !== null ? Date.now() - updatedAt : Infinity;
      if (needsFetch || elapsed >= frequencyMs) {
        await fetchOne();
        if (cancelled) return;
        timeoutId = setTimeout(() => tick(false), frequencyMs);
      } else {
        timeoutId = setTimeout(() => tick(false), frequencyMs - elapsed);
      }
    }

    tick(forceImmediate);
    onCleanup(() => {
      cancelled = true;
      clearTimeout(timeoutId);
    });
  }

  // What actually determines which photo should be showing — not opacity,
  // blur, or the refresh frequency, none of which should yank in a new
  // photo when adjusted. Compared against the previous run so this effect
  // (which re-runs on ANY settings.background change) can tell "the
  // category/list/mode actually changed" apart from "an unrelated field
  // changed" — without it, dragging the opacity slider (which fires many
  // rapid updates) forced a brand-new random photo on every single tick.
  let previousWallpaperIdentity: string | null = null;

  createEffect(() => {
    const bg = settings.background;
    if (bg.backgroundType !== "unsplash") return;
    if (!wallpaperCacheChecked()) return;

    const identity = JSON.stringify([bg.unsplashMode, bg.unsplashCategory, bg.unsplashFixedList]);
    const isExplicitChange = previousWallpaperIdentity !== null && previousWallpaperIdentity !== identity;
    previousWallpaperIdentity = identity;

    if (bg.unsplashMode === "fixed") {
      // "Fixed" has no refresh schedule (see the Settings UI) — only fetch
      // when there's truly nothing to show yet; otherwise it stays put until
      // the user clicks "Get new wallpaper".
      if (!wallpaper() && !cachedWallpaperImage()) {
        getWallpaper(bg.unsplashCategory || "nature");
      }
      return;
    }

    if (bg.unsplashMode === "autoRotateCategory") {
      const category = bg.unsplashCategory || "nature";
      scheduleWallpaperRefresh(bg.unsplashChangeFrequencyMs, isExplicitChange, [category], () => getWallpaper(category));
      return;
    }

    if (bg.unsplashMode === "autoRotateList") {
      const list = bg.unsplashFixedList;
      if (list.length === 0) {
        setRotationImage(null);
        return;
      }
      let index = 0;
      scheduleWallpaperRefresh(bg.unsplashChangeFrequencyMs, isExplicitChange, list, () => {
        const url = list[index % list.length];
        index += 1;
        return fetchRotationImage(url);
      });
    }
  });

  function backgroundStyle() {
    const bg = settings.background;
    if (bg.backgroundType === "none") return {};

    const style: Record<string, string | number> = { opacity: bg.opacity };
    if (bg.backgroundType === "gradient") {
      style["background-image"] = `linear-gradient(${bg.gradientDirection}, ${bg.gradientColor1}, ${bg.gradientColor2})`;
    } else if (bg.backgroundType === "solid") {
      style["background-color"] = bg.solidColor;
    } else if (bg.backgroundType === "unsplash") {
      const liveUrl = bg.unsplashMode === "autoRotateList" ? rotationImage() : wallpaper()?.localDataUrl;
      const dataUrl = liveUrl ?? cachedWallpaperImage();
      if (dataUrl) {
        style["background-image"] = `url(${dataUrl})`;
      }
    }
    return style;
  }

  // Startup shows last session's cached wallpaper immediately (a local disk
  // read, no network) rather than blocking on a fresh Unsplash fetch — the
  // fetch below still runs and swaps the image in once it resolves. This
  // only gates the very first paint: once anything (cached or fresh) is on
  // screen, later refreshes never re-block the UI.
  function wallpaperPending(): boolean {
    const bg = settings.background;
    if (bg.backgroundType !== "unsplash") return false;
    if (!wallpaperCacheChecked()) return true;
    if (cachedWallpaperImage()) return false;
    if (bg.unsplashMode === "autoRotateList") {
      return bg.unsplashFixedList.length > 0 && !rotationImage() && !rotationError();
    }
    return !wallpaper() && !wallpaperError();
  }

  function appReady(): boolean {
    return settingsLoaded();
  }

  return (
    <main class="container">
      <Show when={settings.background.backgroundType !== "none"}>
        <div class="wallpaper-bg" style={backgroundStyle()} />
      </Show>

      <Show
        when={appReady()}
        fallback={
          <div class="app-loading">
            <span class="app-loading-spinner" />
          </div>
        }
      >
      <div class="app-shell" data-bg-lightness={shellLightness()}>
        <CommandBar
          data-bg-lightness={shellLightness()}
          canGoBack={historyIndex() > 0}
          canGoForward={historyIndex() < history().length - 1}
          onBack={goBack}
          onForward={goForward}
          searchQuery={searchQuery()}
          onSearchQueryChange={setSearchQuery}
          searchRecursive={searchRecursive()}
          onSearchRecursiveChange={setSearchRecursive}
          showProgressWhenIdle={settings.showProgressWhenIdle}
          viewControls={
            <Show when={mainView() === "explorer"}>
              <ExplorerPathBar
                path={currentPath()}
                pathInput={pathInput()}
                onPathInputChange={setPathInput}
                onNavigate={navigateTo}
                favouritePaths={settings.favouritePaths}
                onToggleFavourite={toggleFavourite}
              />
            </Show>
          }
        />

        <div class="explorer-view">
          <ViewRail activeView={mainView()} onSelectView={selectView} />
          <Show when={mainView() !== "settings"}>
            <Sidebar
              data-bg-lightness={sidebarLightness()}
              currentPath={currentPath()}
              onSelectPath={selectSidebarPath}
              activeView={mainView()}
              favouritePaths={settings.favouritePaths}
              onToggleFavourite={toggleFavourite}
              recentPaths={settings.recentPaths}
              onRemoveRecent={removeRecent}
            />
          </Show>
          {/* All three views stay mounted and are just hidden/shown, rather
              than torn down and rebuilt on every toggle — otherwise switching
              away and back would silently reset the graph's expanded folders,
              pan, and zoom, and settings would take over the whole window
              instead of living in this same content area next to the
              sidebar. */}
          <div class="view-stack">
            <div class="view-pane" style={{ display: mainView() === "explorer" ? "flex" : "none" }}>
              <ExplorerView
                data-bg-lightness={fileListLightness()}
                path={currentPath()}
                onNavigate={navigateTo}
                searchQuery={searchQuery()}
                searchRecursive={searchRecursive()}
                favouritePaths={settings.favouritePaths}
                onToggleFavourite={toggleFavourite}
                sortKey={settings.sortKey}
                sortDirection={settings.sortDirection}
                onSortChange={updateSort}
              />
            </div>
            <div class="view-pane" style={{ display: mainView() === "graph" ? "flex" : "none" }}>
              <GraphView
                data-bg-lightness={fileListLightness()}
                searchQuery={searchQuery()}
                onOpenInExplorer={navigateTo}
                settingsLoaded={settingsLoaded()}
                persistState={settings.persistGraphState}
                initialState={settings.graphState}
                onStateChange={updateGraphState}
                active={mainView() === "graph"}
                focusPath={graphFocusRequest()}
              />
            </div>
            <div class="view-pane" style={{ display: mainView() === "settings" ? "flex" : "none" }}>
              <SettingsPanel
                data-bg-lightness={fileListLightness()}
                onClose={closeSettings}
                searchQuery={searchQuery()}
                background={settings.background}
                onBackgroundChange={updateBackground}
                theme={settings.theme}
                onThemeChange={updateTheme}
                uiTintOpacity={settings.uiTintOpacity}
                onUiTintOpacityChange={updateUiTintOpacity}
                uiBlurPx={settings.uiBlurPx}
                onUiBlurPxChange={updateUiBlurPx}
                fontFamily={settings.fontFamily}
                onFontFamilyChange={updateFontFamily}
                fontSizePx={settings.fontSizePx}
                onFontSizePxChange={updateFontSizePx}
                sidebarTooltipDelayMs={settings.sidebarTooltipDelayMs}
                onSidebarTooltipDelayMsChange={updateSidebarTooltipDelayMs}
                persistGraphState={settings.persistGraphState}
                onPersistGraphStateChange={updatePersistGraphState}
                showProgressWhenIdle={settings.showProgressWhenIdle}
                onShowProgressWhenIdleChange={updateShowProgressWhenIdle}
                hasUnsplashApiKey={hasUnsplashApiKey()}
                onSaveUnsplashApiKey={saveUnsplashApiKey}
                apiKeyError={apiKeyError()}
                wallpaper={wallpaper()}
                wallpaperError={wallpaperError()}
                onFetchWallpaper={getWallpaper}
              />
            </div>
          </div>
        </div>
      </div>
      </Show>
    </main>
  );
}

export default App;
