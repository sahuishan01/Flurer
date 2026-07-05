import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { FileList } from "./components/FileList";
import { WallpaperSettings, type Wallpaper } from "./components/WallpaperSettings";
import "./App.css";

const DEFAULT_PATH = "C:\\";

function App() {
  const [currentPath, setCurrentPath] = createSignal(DEFAULT_PATH);
  const [pathInput, setPathInput] = createSignal(DEFAULT_PATH);
  const [showSettings, setShowSettings] = createSignal(false);
  const [wallpaper, setWallpaper] = createSignal<Wallpaper | null>(null);
  const [wallpaperError, setWallpaperError] = createSignal("");
  const [wallpaperOpacity, setWallpaperOpacity] = createSignal(0.35);

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

  return (
    <main class="container">
      <div
        class="wallpaper-bg"
        style={{
          "background-image": wallpaper() ? `url(${wallpaper()!.urls.full})` : undefined,
          opacity: wallpaperOpacity(),
        }}
      />

      <div class="toolbar">
        <form
          class="path-form"
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(pathInput());
          }}
        >
          <input
            class="path-input"
            value={pathInput()}
            onInput={(e) => setPathInput(e.currentTarget.value)}
          />
          <button type="submit">Go</button>
        </form>
        <button onClick={() => setShowSettings((v) => !v)}>Settings</button>
      </div>

      {showSettings() && (
        <WallpaperSettings
          wallpaper={wallpaper}
          error={wallpaperError}
          opacity={wallpaperOpacity}
          onFetch={getWallpaper}
          onOpacityChange={setWallpaperOpacity}
        />
      )}

      <FileList path={currentPath()} onNavigate={navigateTo} />
    </main>
  );
}

export default App;
