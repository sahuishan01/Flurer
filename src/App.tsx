import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { ExplorerView } from "./components/ExplorerView";
import { GraphView } from "./components/GraphView";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";
import { DEFAULT_SETTINGS, type BackgroundSettings, type Settings, type Theme } from "./lib/settings";
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
  const [rotationUrl, setRotationUrl] = createSignal<string | null>(null);
  const [windowSize, setWindowSize] = createSignal(getDisplaySize());

  const [settings, setSettings] = createStore<Settings>(DEFAULT_SETTINGS);

  onMount(async () => {
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
    } catch (err) {
      console.error("Failed to load settings", err);
    }
  });

  onMount(() => {
    let resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    function handleResize() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => setWindowSize(getDisplaySize()), 400);
    }
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimeout);
    });
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
        const { width, height } = windowSize();
        style["background-image"] = `url(${sizedUnsplashUrl(url, width, height)})`;
      }
    }
    return style;
  }

  return (
    <main class="container">
      <Show when={settings.background.backgroundType !== "none"}>
        <div class="wallpaper-bg" style={backgroundStyle()} />
      </Show>

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

        <Show
          when={mainView() === "settings"}
          fallback={
            <div class="explorer-view">
              <Sidebar
                currentPath={currentPath()}
                onNavigate={navigateTo}
                activeView={mainView()}
                onSelectView={selectView}
              />
              <Show when={mainView() === "explorer"} fallback={<GraphView />}>
                <ExplorerView
                  path={currentPath()}
                  pathInput={pathInput()}
                  onPathInputChange={setPathInput}
                  onNavigate={navigateTo}
                  searchQuery={searchQuery()}
                  searchRecursive={searchRecursive()}
                />
              </Show>
            </div>
          }
        >
          <SettingsPanel
            onClose={closeSettings}
            searchQuery={searchQuery()}
            background={settings.background}
            onBackgroundChange={updateBackground}
            theme={settings.theme}
            onThemeChange={updateTheme}
            uiTintOpacity={settings.uiTintOpacity}
            onUiTintOpacityChange={updateUiTintOpacity}
            wallpaper={wallpaper()}
            wallpaperError={wallpaperError()}
            onFetchWallpaper={getWallpaper}
          />
        </Show>
      </div>
    </main>
  );
}

export default App;
