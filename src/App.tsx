import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { ExplorerView } from "./components/ExplorerView";
import { GraphView } from "./components/GraphView";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";
import { DEFAULT_SETTINGS, type BackgroundSettings, type GraphState, type Settings, type Theme } from "./lib/settings";
import { getDisplaySize, sizedUnsplashUrl, type Wallpaper } from "./lib/unsplash";
import type { MainView } from "./lib/view";
import "./App.css";

const DEFAULT_PATH = "C:\\";
const SETTINGS_SAVE_DEBOUNCE_MS = 300;

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
  const [rotationUrl, setRotationUrl] = createSignal<string | null>(null);
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

  function updatePersistGraphState(enabled: boolean) {
    setSettings("persistGraphState", enabled);
    persistSettings();
  }

  function updateGraphState(state: GraphState) {
    setSettings("graphState", state);
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
      const result = await invoke<Wallpaper>("get_wallpaper", { query });
      setWallpaper(result);
    } catch (err) {
      setWallpaperError(String(err));
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

  createEffect(() => {
    const bg = settings.background;
    if (bg.backgroundType !== "unsplash") return;

    if (bg.unsplashMode === "fixed") {
      if (!wallpaper()) getWallpaper(bg.unsplashCategory || "nature");
      return;
    }

    if (bg.unsplashMode === "autoRotateCategory") {
      const category = bg.unsplashCategory || "nature";
      getWallpaper(category);
      const id = setInterval(() => getWallpaper(category), bg.unsplashChangeFrequencyMs);
      onCleanup(() => clearInterval(id));
      return;
    }

    if (bg.unsplashMode === "autoRotateList") {
      const list = bg.unsplashFixedList;
      if (list.length === 0) {
        setRotationUrl(null);
        return;
      }
      let index = 0;
      setRotationUrl(list[index]);
      const id = setInterval(() => {
        index = (index + 1) % list.length;
        setRotationUrl(list[index]);
      }, bg.unsplashChangeFrequencyMs);
      onCleanup(() => clearInterval(id));
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
      const url = bg.unsplashMode === "autoRotateList" ? rotationUrl() : wallpaper()?.urls.full;
      if (url) {
        style["background-image"] = `url(${sizedUnsplashUrl(url, windowSize.width, windowSize.height)})`;
      }
    }
    return style;
  }

  // A fixed/rotating-category Unsplash background needs a network fetch
  // before there's anything to show — until it resolves (or fails), the app
  // would otherwise flash through with no background at all. autoRotateList
  // just cycles a fixed local list, so there's no fetch to wait on.
  function wallpaperPending(): boolean {
    const bg = settings.background;
    if (bg.backgroundType !== "unsplash" || bg.unsplashMode === "autoRotateList") return false;
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
