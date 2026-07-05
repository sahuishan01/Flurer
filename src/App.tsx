import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { ExplorerView } from "./components/ExplorerView";
import { GraphView } from "./components/GraphView";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { DEFAULT_SETTINGS, type BackgroundSettings, type Settings, type Theme } from "./lib/settings";
import type { Wallpaper } from "./lib/unsplash";
import type { MainView } from "./lib/view";
import "./App.css";

const DEFAULT_PATH = "C:\\";
const SETTINGS_SAVE_DEBOUNCE_MS = 300;

function App() {
  const [currentPath, setCurrentPath] = createSignal(DEFAULT_PATH);
  const [pathInput, setPathInput] = createSignal(DEFAULT_PATH);
  const [mainView, setMainView] = createSignal<MainView>("explorer");
  const [showSettings, setShowSettings] = createSignal(false);
  const [wallpaper, setWallpaper] = createSignal<Wallpaper | null>(null);
  const [wallpaperError, setWallpaperError] = createSignal("");
  const [rotationUrl, setRotationUrl] = createSignal<string | null>(null);

  const [settings, setSettings] = createStore<Settings>(DEFAULT_SETTINGS);

  onMount(async () => {
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
    } catch (err) {
      console.error("Failed to load settings", err);
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

  async function getWallpaper(query: string) {
    setWallpaperError("");
    try {
      const result = await invoke<Wallpaper>("get_wallpaper", { query });
      setWallpaper(result);
    } catch (err) {
      setWallpaperError(String(err));
    }
  }

  function navigateTo(path: string) {
    setCurrentPath(path);
    setPathInput(path);
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
      if (url) style["background-image"] = `url(${url})`;
    }
    return style;
  }

  return (
    <main class="container">
      <Show when={settings.background.backgroundType !== "none"}>
        <div class="wallpaper-bg" style={backgroundStyle()} />
      </Show>

      <Show
        when={showSettings()}
        fallback={
          <div class="explorer-view">
            <Sidebar
              currentPath={currentPath()}
              onNavigate={navigateTo}
              activeView={mainView()}
              onSelectView={setMainView}
            />
            <Show when={mainView() === "explorer"} fallback={<GraphView />}>
              <ExplorerView
                path={currentPath()}
                pathInput={pathInput()}
                onPathInputChange={setPathInput}
                onNavigate={navigateTo}
                onOpenSettings={() => setShowSettings(true)}
              />
            </Show>
          </div>
        }
      >
        <SettingsPanel
          onClose={() => setShowSettings(false)}
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
    </main>
  );
}

export default App;
