import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { ExplorerView } from "./components/ExplorerView";
import { GraphView } from "./components/GraphView";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";
import { DEFAULT_SETTINGS, type BackgroundSettings, type GraphState, type Settings, type Theme } from "./lib/settings";
import type { SortKey } from "./lib/fs";
import { getDisplaySize, type Wallpaper } from "./lib/unsplash";
import type { MainView } from "./lib/view";
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
  const [cachedWallpaperImage, setCachedWallpaperImage] = createSignal<string | null>(null);
  const [wallpaperCacheChecked, setWallpaperCacheChecked] = createSignal(false);
  // A plain value, not a signal — screen resolution doesn't change when the
  // window is resized, so there's nothing to react to (see getDisplaySize).
  const windowSize = getDisplaySize();

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
      setCachedWallpaperImage(await invoke<string | null>("get_cached_wallpaper_image"));
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

  function updatePersistGraphState(enabled: boolean) {
    setSettings("persistGraphState", enabled);
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

  // Drives both auto-rotate modes: on `forceImmediate` (the user just
  // changed the relevant setting) it fetches right away; otherwise it checks
  // the shared timestamp and either fetches now (if due) or schedules a
  // check for exactly when it becomes due — self-correcting if another
  // instance updates it in the meantime.
  function scheduleWallpaperRefresh(frequencyMs: number, forceImmediate: boolean, fetchOne: () => Promise<void>) {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function tick(force: boolean) {
      if (cancelled) return;
      const updatedAt = force ? null : await getWallpaperUpdatedAt();
      if (cancelled) return;
      const elapsed = updatedAt ? Date.now() - updatedAt : Infinity;
      if (force || elapsed >= frequencyMs) {
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

  // Only the very first pass (once the disk cache has been checked) should
  // respect the "is it due yet" gate — every later pass is only reached
  // because the user explicitly changed a background setting, which should
  // always take effect immediately.
  let initialWallpaperCheckDone = false;

  createEffect(() => {
    const bg = settings.background;
    if (bg.backgroundType !== "unsplash") return;
    if (!wallpaperCacheChecked()) return;

    const isExplicitChange = initialWallpaperCheckDone;
    initialWallpaperCheckDone = true;

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
      scheduleWallpaperRefresh(bg.unsplashChangeFrequencyMs, isExplicitChange, () => getWallpaper(category));
      return;
    }

    if (bg.unsplashMode === "autoRotateList") {
      const list = bg.unsplashFixedList;
      if (list.length === 0) {
        setRotationImage(null);
        return;
      }
      let index = 0;
      scheduleWallpaperRefresh(bg.unsplashChangeFrequencyMs, isExplicitChange, () => {
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
    return settingsLoaded() && !wallpaperPending();
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
      <div class="app-shell">
        <TopBar
          canGoBack={historyIndex() > 0}
          canGoForward={historyIndex() < history().length - 1}
          onBack={goBack}
          onForward={goForward}
          searchQuery={searchQuery()}
          onSearchQueryChange={setSearchQuery}
          searchRecursive={searchRecursive()}
          onSearchRecursiveChange={setSearchRecursive}
        />

        <div class="explorer-view">
          <Sidebar
            currentPath={currentPath()}
            onNavigate={navigateTo}
            activeView={mainView()}
            onSelectView={selectView}
            favouritePaths={settings.favouritePaths}
            onToggleFavourite={toggleFavourite}
            recentPaths={settings.recentPaths}
            onRemoveRecent={removeRecent}
          />
          {/* All three views stay mounted and are just hidden/shown, rather
              than torn down and rebuilt on every toggle — otherwise switching
              away and back would silently reset the graph's expanded folders,
              pan, and zoom, and settings would take over the whole window
              instead of living in this same content area next to the
              sidebar. */}
          <div class="view-stack">
            <div class="view-pane" style={{ display: mainView() === "explorer" ? "flex" : "none" }}>
              <ExplorerView
                path={currentPath()}
                pathInput={pathInput()}
                onPathInputChange={setPathInput}
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
                searchQuery={searchQuery()}
                onOpenInExplorer={navigateTo}
                settingsLoaded={settingsLoaded()}
                persistState={settings.persistGraphState}
                initialState={settings.graphState}
                onStateChange={updateGraphState}
                active={mainView() === "graph"}
              />
            </div>
            <div class="view-pane" style={{ display: mainView() === "settings" ? "flex" : "none" }}>
              <SettingsPanel
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
                persistGraphState={settings.persistGraphState}
                onPersistGraphStateChange={updatePersistGraphState}
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
