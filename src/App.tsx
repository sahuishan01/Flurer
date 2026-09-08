import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CommandBar } from "./components/CommandBar";
import { ExplorerPathBar } from "./components/ExplorerPathBar";
import { ExplorerTabs, type ExplorerTab } from "./components/ExplorerTabs";
import { ExplorerView } from "./components/ExplorerView";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { TrashView } from "./components/TrashView";
import { ViewRail } from "./components/ViewRail";
import {
  DEFAULT_SETTINGS,
  MAX_HISTORY_ITEMS,
  MIN_HISTORY_ITEMS,
  type BackgroundSettings,
  type Settings,
  type Theme,
} from "./lib/settings";
import { cleanDirPath, type GroupByKey, type SortKey } from "./lib/fs";
import { DEFAULT_IN_APP_SHORTCUTS, matchesKeyCombo, type InAppShortcutAction } from "./lib/shortcuts";
import { getDisplaySize, type CachedWallpaper, type Wallpaper } from "./lib/unsplash";
import type { GraphFocusRequest, MainView } from "./lib/view";
import { loadInstalledPlugins, registeredPlugins } from "./lib/plugins";
import "./App.css";

const DEFAULT_PATH = "C:\\";
const SETTINGS_SAVE_DEBOUNCE_MS = 300;

type HistoryEntry = { view: MainView; path: string };

function App() {
  const [currentPath, setCurrentPath] = createSignal(DEFAULT_PATH);
  const [pathInput, setPathInput] = createSignal(DEFAULT_PATH);
  // Which explorer pane global navigation (the top address bar, sidebar
  // clicks on a drive/favourite/recent, the search box) targets. 0 is the
  // primary pane (currentPath, with real back/forward history and tabs);
  // k (k >= 1) is settings.splitPanePaths[k - 1], which has neither — see
  // navigateActivePane and activePanePath below. Owned here rather than
  // inside ExplorerView because the CommandBar's address bar and Sidebar
  // live outside it and need to read/target the same pane ExplorerView
  // considers "active" for keyboard shortcuts and drops.
  const [activePane, setActivePane] = createSignal(0);
  const [mainView, setMainView] = createSignal<MainView>("explorer");
  const [history, setHistory] = createSignal<HistoryEntry[]>([{ view: "explorer", path: DEFAULT_PATH }]);
  const [historyIndex, setHistoryIndex] = createSignal(0);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchRecursive, setSearchRecursive] = createSignal(false);
  const [wallpaper, setWallpaper] = createSignal<Wallpaper | null>(null);
  const [wallpaperError, setWallpaperError] = createSignal("");
  // Browsing history for "auto rotate from category" — lets Prev/Next
  // step through previously-shown photos (no refetch going back) or pull a
  // fresh one going forward, independent of the scheduled auto-rotation
  // timer. Also doubles as "what category is currently on screen", used to
  // decide whether a category-selection edit should disturb the current
  // wallpaper (see the background-driving effect below).
  const [categoryWallpaperHistory, setCategoryWallpaperHistory] = createSignal<
    { category: string; wallpaper: Wallpaper }[]
  >([]);
  const [categoryWallpaperIndex, setCategoryWallpaperIndex] = createSignal(-1);
  const activeRotationCategory = () => {
    const history = categoryWallpaperHistory();
    const index = categoryWallpaperIndex();
    return index >= 0 && index < history.length ? history[index].category : null;
  };
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
  const windowSize = getDisplaySize();

  const [settings, setSettings] = createStore<Settings>(DEFAULT_SETTINGS);
  // GraphView is always mounted (see the view-stack below) and needs to know
  // once settings have actually finished loading before it can trust
  // settings.graphState — otherwise it can't tell "nothing saved yet" apart
  // from "hasn't arrived from disk yet", since both look like `null`.
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);

  const [wallpaperRGB, setWallpaperRGB] = createSignal<{r: number; g: number; b: number} | null>(null);

  function parseHexColor(hex: string | undefined | null): {r: number; g: number; b: number} {
    if (!hex) {
      return { r: 128, g: 128, b: 128 };
    }
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
    opacityVal: number | undefined | null
  ): "light" | "dark" {
    const opacity = (opacityVal !== undefined && opacityVal !== null && !isNaN(opacityVal)) ? opacityVal : 0.35;
    const isDark = settings && settings.theme === "dark";
    const fallbackWall = isDark ? { r: 32, g: 32, b: 32 } : { r: 255, g: 255, b: 255 };
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
    if (!settings) return "light";
    const isDark = settings.theme === "dark";
    const tintRGB = isDark ? { r: 32, g: 32, b: 32 } : { r: 243, g: 243, b: 243 };
    const opacity = settings.uiTintOpacity;
    return getPanelLightness(tintRGB, opacity);
  });

  const sidebarLightness = createMemo(() => {
    if (!settings) return "light";
    const isDark = settings.theme === "dark";
    const tintRGB = isDark ? { r: 32, g: 32, b: 32 } : { r: 243, g: 243, b: 243 };
    const opacity = settings.uiTintOpacity;
    return getPanelLightness(tintRGB, opacity);
  });

  const fileListLightness = createMemo(() => {
    if (!settings) return "light";
    const isDark = settings.theme === "dark";
    const tintRGB = isDark ? { r: 32, g: 32, b: 32 } : { r: 255, g: 255, b: 255 };
    const opacity = settings.uiTintOpacity;
    return getPanelLightness(tintRGB, opacity);
  });

  createEffect(() => {
    if (!settings || !settings.background) return;
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

  onMount(async () => {
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
      
      // Load plugins on startup
      await loadInstalledPlugins(loaded.disabledPlugins || []);

      if (loaded.lastMainView && loaded.lastMainView !== "explorer") {
        setMainView(loaded.lastMainView);
        setHistory([{ view: loaded.lastMainView, path: currentPath() }]);
      }
    } catch (err) {
      console.error("Failed to load settings", err);
    } finally {
      setSettingsLoaded(true);
    }
  });

  // `flurer .` / `flurer <path>` — take_launch_path returns the resolved
  // folder once, then null on every subsequent call (see AppState.launch_path
  // in the Rust side), so this only ever navigates on this window's very
  // first mount, not on remounts or other windows sharing the same process.
  // Secondary invocations when an instance is already running are received
  // via the "open-new-tab" event emitted by tauri-plugin-single-instance.
  onMount(async () => {
    try {
      const path = await invoke<string | null>("take_launch_path");
      if (path) navigateTo(path);
    } catch (err) {
      console.error("Failed to read launch path", err);
    }

    try {
      const unlisten = await listen<string>("open-new-tab", (event) => {
        if (event.payload) {
          openTabWithPath(event.payload);
        }
      });
      onCleanup(() => {
        unlisten();
      });
    } catch (err) {
      console.error("Failed to listen for open-new-tab event", err);
    }
  });

  onMount(async () => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let resizeSaveTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      unlisten = await getCurrentWindow().onResized(({ payload }) => {
        if (!settingsLoaded()) return;
        clearTimeout(resizeSaveTimeout);
        resizeSaveTimeout = setTimeout(async () => {
          const maximized = await getCurrentWindow().isMaximized();
          setSettings("windowMaximized", maximized);
          // While maximized, `payload` is the maximized (screen-filling)
          // size — saving it as windowWidth/Height would make relaunch's
          // restore-size-then-maximize (see lib.rs setup) un-maximize back
          // to a full-screen-sized window instead of the size the user
          // actually chose, so only track size while not maximized.
          if (!maximized) {
            setSettings("windowWidth", payload.width);
            setSettings("windowHeight", payload.height);
          }
          persistSettings();
        }, SETTINGS_SAVE_DEBOUNCE_MS);
      });
      if (disposed) unlisten();
    } catch (err) {
      console.error("Failed to listen for window resize", err);
    }
    onCleanup(() => {
      disposed = true;
      clearTimeout(resizeSaveTimeout);
      unlisten?.();
    });
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

  function updateShowProgressWhenIdle(show: boolean) {
    setSettings("showProgressWhenIdle", show);
    persistSettings();
  }

  function updateLiveFolderSizeUpdates(enabled: boolean) {
    setSettings("liveFolderSizeUpdates", enabled);
    persistSettings();
  }

  function updateMaxHistoryItems(value: number) {
    const requested = Number.isFinite(value) ? value : settings.maxHistoryItems;
    const limit = Math.max(MIN_HISTORY_ITEMS, Math.min(MAX_HISTORY_ITEMS, Math.round(requested)));
    setSettings("maxHistoryItems", limit);
    setSettings("recentPaths", settings.recentPaths.slice(0, limit));
    persistSettings();
  }

  // The actual OS-level (un)registration happens backend-side, inside
  // set_settings itself (it diffs the previous vs. new value) — this just
  // needs to get the new value persisted the same way every other setting
  // is, not make a separate dedicated call.
  function updateGlobalShortcut(shortcut: string) {
    setSettings("globalShortcut", shortcut);
    persistSettings();
  }

  // Same "backend diffs old vs new inside set_settings" shape as the
  // shortcut above — this just gets the new value persisted, the actual
  // Windows registry/startup-folder change happens backend-side.
  function updateLaunchAtStartup(enabled: boolean) {
    setSettings("launchAtStartup", enabled);
    persistSettings();
  }

  function updatePluginSettings(pluginId: string, patch: any) {
    const current = settings.pluginSettings?.[pluginId] ?? {};
    setSettings("pluginSettings", pluginId, { ...current, ...patch });
    persistSettings();
  }

  function updateDisabledPlugins(disabled: string[]) {
    setSettings("disabledPlugins", disabled);
    persistSettings();
  }

  function updateSearchIndexRoots(roots: string[]) {
    setSettings("searchIndexRoots", roots);
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

  // Nested-path form (setSettings("folderColors", path, value)), not a
  // spread-and-delete replacement object — Solid's store setter merges keys
  // present in a replacement object onto the existing one, it doesn't prune
  // keys the replacement leaves out. A {...settings.folderColors} copy with
  // `delete next[path]` therefore never actually removed the entry from the
  // live store: the "Clear color tag" menu item fired, persisted an object
  // missing that key, but the in-memory store (and thus every reactive read
  // of it) kept the old value. Setting the specific key to undefined via
  // the path setter both updates the store correctly and — since
  // JSON.stringify drops undefined-valued properties — persists as "no key"
  // on the Rust side, matching favouritePaths/recentPaths' convention of
  // "absent key means no tag" without needing an explicit delete step.
  function setFolderColor(path: string, color: string | null) {
    setSettings("folderColors", path, color ?? undefined);
    persistSettings();
  }

  function updateInAppShortcut(action: InAppShortcutAction, combo: string) {
    setSettings("inAppShortcuts", action, combo);
    persistSettings();
  }

  function resetInAppShortcut(action: InAppShortcutAction) {
    setSettings("inAppShortcuts", action, DEFAULT_IN_APP_SHORTCUTS[action]);
    persistSettings();
  }

  // Most-recent-first, deduped (revisiting a path just moves it back to the
  // front rather than adding a second entry), capped so the list can't grow
  // forever. When navigating deeper into nested folders, intermediate ancestors
  // are removed so only the latest/deepest subfolder appears in recents.
  function recordRecent(path: string) {
    const limit = Math.max(MIN_HISTORY_ITEMS, Math.min(MAX_HISTORY_ITEMS, settings.maxHistoryItems));
    const normalizedNew = path.replace(/[\\/]+$/, "").toLowerCase();

    function isAncestorOrEqual(parent: string, childNormalized: string): boolean {
      const p = parent.replace(/[\\/]+$/, "").toLowerCase();
      if (!p || p === childNormalized) return true;
      const prefix = p.endsWith(":") ? `${p}\\` : `${p}\\`;
      const prefixAlt = p.endsWith(":") ? `${p}/` : `${p}/`;
      return childNormalized.startsWith(prefix) || childNormalized.startsWith(prefixAlt);
    }

    // Filter out identical paths and any existing recent path that is an ancestor of the new path.
    const filtered = settings.recentPaths.filter((p) => !isAncestorOrEqual(p, normalizedNew));

    const next = [path, ...filtered].slice(0, limit);
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

  function updateGroupFoldersFirst(value: boolean) {
    setSettings("groupFoldersFirst", value);
    persistSettings();
  }

  function updateGroupBy(value: GroupByKey) {
    setSettings("groupBy", value);
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

  // Same underlying call as getWallpaper, but for "auto rotate from
  // category" specifically — also records the fetch in categoryWallpaperHistory
  // (dropping any forward history past the current point, same as a
  // browser tab's back/forward stack after navigating somewhere new) so
  // Prev/Next and the "don't disturb the current photo" check both have
  // something to work from.
  async function fetchCategoryWallpaper(category: string) {
    setWallpaperError("");
    try {
      const result = await invoke<Wallpaper>("get_wallpaper", {
        query: category,
        width: windowSize.width,
        height: windowSize.height,
      });
      setWallpaper(result);
      const truncated = categoryWallpaperHistory().slice(0, categoryWallpaperIndex() + 1);
      setCategoryWallpaperHistory([...truncated, { category, wallpaper: result }]);
      setCategoryWallpaperIndex(truncated.length);
    } catch (err) {
      setWallpaperError(String(err));
    }
  }

  // "I don't like this one" — Next either replays a photo already fetched
  // ahead in history (no network call) or, once at the end of history,
  // fetches a fresh photo for the next category in rotation. Prev always
  // just replays — never fetches — since there's nothing "ahead" to fetch
  // for going backwards.
  function goToNextCategoryWallpaper() {
    const history = categoryWallpaperHistory();
    const index = categoryWallpaperIndex();
    if (index < history.length - 1) {
      const next = index + 1;
      setCategoryWallpaperIndex(next);
      setWallpaper(history[next].wallpaper);
      return;
    }
    const categories = settings.background.unsplashCategories.length
      ? settings.background.unsplashCategories
      : ["nature"];
    const current = activeRotationCategory();
    const currentIdx = current ? categories.indexOf(current) : -1;
    const nextCategory = categories[(currentIdx + 1 + categories.length) % categories.length];
    fetchCategoryWallpaper(nextCategory);
  }

  function goToPrevCategoryWallpaper() {
    const index = categoryWallpaperIndex();
    if (index <= 0) return;
    setCategoryWallpaperIndex(index - 1);
    setWallpaper(categoryWallpaperHistory()[index - 1].wallpaper);
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
    suppressHistoryPush = false;
  }

  // History for secondary panes (arrIndex 0 corresponds to activePane 1, etc.)
  // Each pane stores a list of paths and an active index.
  const [paneHistories, setPaneHistories] = createSignal<{ paths: string[]; index: number }[]>([]);

  function ensurePaneHistory(arrIndex: number, currentPanePath: string) {
    setPaneHistories((prev) => {
      const next = prev.slice();
      while (next.length <= arrIndex) {
        next.push({ paths: [], index: -1 });
      }
      if (next[arrIndex].paths.length === 0) {
        next[arrIndex] = { paths: [currentPanePath], index: 0 };
      }
      return next;
    });
  }

  function pushPaneHistory(arrIndex: number, newPath: string) {
    setPaneHistories((prev) => {
      const next = prev.slice();
      while (next.length <= arrIndex) {
        next.push({ paths: [], index: -1 });
      }
      const entry = next[arrIndex];
      const cur = entry.paths[entry.index];
      if (cur === newPath) return prev;
      const truncated = entry.paths.slice(0, entry.index + 1);
      next[arrIndex] = {
        paths: [...truncated, newPath],
        index: truncated.length,
      };
      return next;
    });
  }

  function navigateExtraPane(arrIndex: number, path: string) {
    const curPath = settings.splitPanePaths[arrIndex] ?? currentPath();
    ensurePaneHistory(arrIndex, curPath);
    pushPaneHistory(arrIndex, path);
    const next = settings.splitPanePaths.slice();
    next[arrIndex] = path;
    setSettings("splitPanePaths", next);
    recordRecent(path);
  }

  function handleSplitPanePathsChange(paths: string[]) {
    setSettings("splitPanePaths", paths);
    setPaneHistories((prev) => prev.slice(0, paths.length));
  }

  function canGoBack(): boolean {
    const pane = activePane();
    if (pane === 0) return historyIndex() > 0;
    const arrIndex = pane - 1;
    const hist = paneHistories()[arrIndex];
    return hist ? hist.index > 0 : false;
  }

  function canGoForward(): boolean {
    const pane = activePane();
    if (pane === 0) return historyIndex() < history().length - 1;
    const arrIndex = pane - 1;
    const hist = paneHistories()[arrIndex];
    return hist ? hist.index < hist.paths.length - 1 : false;
  }

  function goBack() {
    const pane = activePane();
    if (pane === 0) {
      const index = historyIndex();
      if (index <= 0) return;
      applyHistoryEntry(history()[index - 1], index - 1);
      return;
    }
    const arrIndex = pane - 1;
    const curHist = paneHistories()[arrIndex];
    if (!curHist || curHist.index <= 0) return;
    const newIndex = curHist.index - 1;
    const targetPath = curHist.paths[newIndex];
    setPaneHistories((prev) => {
      const next = prev.slice();
      next[arrIndex] = { ...next[arrIndex], index: newIndex };
      return next;
    });
    const nextPaths = settings.splitPanePaths.slice();
    nextPaths[arrIndex] = targetPath;
    setSettings("splitPanePaths", nextPaths);
  }

  function goForward() {
    const pane = activePane();
    if (pane === 0) {
      const h = history();
      const index = historyIndex();
      if (index >= h.length - 1) return;
      applyHistoryEntry(h[index + 1], index + 1);
      return;
    }
    const arrIndex = pane - 1;
    const curHist = paneHistories()[arrIndex];
    if (!curHist || curHist.index >= curHist.paths.length - 1) return;
    const newIndex = curHist.index + 1;
    const targetPath = curHist.paths[newIndex];
    setPaneHistories((prev) => {
      const next = prev.slice();
      next[arrIndex] = { ...next[arrIndex], index: newIndex };
      return next;
    });
    const nextPaths = settings.splitPanePaths.slice();
    nextPaths[arrIndex] = targetPath;
    setSettings("splitPanePaths", nextPaths);
  }

  // Alt+Left/Right and the mouse's side (back/forward) buttons — standard
  // back/forward navigation in every browser and file manager, but nothing
  // wires them up for free here: this app never does real page navigation
  // (currentPath is just app state), so the webview's own browser-history
  // handling for these has nothing to act on and silently does nothing.
  // Keyboard and mouse navigation shortcuts.
  // Alt+Left/Right & mouse side buttons: Back/Forward.
  // Alt+Up: Go to parent folder.
  // Ctrl+T: New tab.
  // Ctrl+W: Close current tab.
  // Ctrl+Tab / Ctrl+Shift+Tab: Cycle tabs.
  // F6: Cycle split panes.
  // Ctrl+L / Alt+D: Open & focus path bar.
  // Ctrl+F / F3: Open & focus search bar.
  onMount(() => {
    function isInputElement(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
    }

    function handleKeyDown(e: KeyboardEvent) {
      // If a modal dialog is open, do not handle background app shortcuts
      if (document.querySelector(".modal-backdrop")) return;

      const activeEl = document.activeElement;
      const typingInInput = isInputElement(activeEl);

      function bound(action: InAppShortcutAction): boolean {
        return matchesKeyCombo(e, settings.inAppShortcuts[action] ?? DEFAULT_IN_APP_SHORTCUTS[action]);
      }

      // --- Navigation & Window shortcuts ---
      if (bound("navBack")) {
        e.preventDefault();
        goBack();
        return;
      } else if (bound("navForward")) {
        e.preventDefault();
        goForward();
        return;
      } else if (bound("navParent")) {
        e.preventDefault();
        const cur = activePanePath();
        const p = parentDir(cur);
        if (p && p !== cur && p !== cur.replace(/[/\\]+$/, "")) {
          navigateActivePane(p);
        }
        return;
      } else if (bound("focusAddressBar") || (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "d")) {
        e.preventDefault();
        const pathBtn = document.querySelector(".explorer-path-bar .icon-btn") as HTMLButtonElement | null;
        pathBtn?.click();
        return;
      } else if (bound("focusSearch") || e.key === "F3") {
        e.preventDefault();
        const searchBtn = document.querySelector(".search-trigger .icon-btn") as HTMLButtonElement | null;
        searchBtn?.click();
        return;
      } else if (bound("newTab")) {
        e.preventDefault();
        openNewTab();
        return;
      } else if (bound("closeTab")) {
        e.preventDefault();
        closeTab(activeTabId());
        return;
      } else if (bound("nextTab")) {
        e.preventDefault();
        const currentTabs = tabs();
        if (currentTabs.length > 1) {
          const idx = currentTabs.findIndex((t) => t.id === activeTabId());
          if (idx >= 0) {
            const nextIdx = (idx + 1) % currentTabs.length;
            switchTab(currentTabs[nextIdx].id);
          }
        }
        return;
      } else if (bound("prevTab")) {
        e.preventDefault();
        const currentTabs = tabs();
        if (currentTabs.length > 1) {
          const idx = currentTabs.findIndex((t) => t.id === activeTabId());
          if (idx >= 0) {
            const nextIdx = (idx - 1 + currentTabs.length) % currentTabs.length;
            switchTab(currentTabs[nextIdx].id);
          }
        }
        return;
      } else if (bound("cyclePane")) {
        e.preventDefault();
        const total = 1 + settings.splitPanePaths.length;
        if (total > 1) {
          setActivePane((prev) => (prev + 1) % total);
        }
        return;
      }

      // Ignore remaining shortcuts if user is typing in an input
      if (typingInInput) return;
    }

    // Mouse button indices: 3 = back (often "Mouse4"/XButton1), 4 = forward
    // ("Mouse5"/XButton2). Handled on mouseup (not mousedown) so it fires
    // on release the way click-driven navigation normally does.
    function handleMouseUp(e: MouseEvent) {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mouseup", handleMouseUp);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mouseup", handleMouseUp);
    });
  });

  function navigateTo(path: string) {
    const cleanPath = cleanDirPath(path);
    setCurrentPath(cleanPath);
    setMainView("explorer");
    pushHistory({ view: "explorer", path: cleanPath });
    recordRecent(cleanPath);
  }

  /** Whichever pane global navigation currently targets — see activePane. */
  function activePanePath(): string {
    const i = activePane();
    return i === 0 ? currentPath() : (settings.splitPanePaths[i - 1] ?? currentPath());
  }

  // pathInput (the top address bar's in-progress typed text) always
  // mirrors whichever pane is active, not just the primary one — so
  // switching which pane has focus updates the address bar to show that
  // pane's folder instead of leaving it stuck on stale text.
  createEffect(() => setPathInput(activePanePath()));

  /**
   * Routes a navigation from outside ExplorerView (top address bar,
   * sidebar drive/favourite/recent click) to whichever pane is active.
   * Pane 0 goes through navigateTo so it keeps participating in
   * back/forward history and tabs; any other pane is just a direct
   * settings update, matching how ExplorerView itself navigates extra
   * panes — they were never given history of their own (see HANDOFF.md).
   */
  function navigateActivePane(path: string) {
    const cleanPath = cleanDirPath(path);
    const i = activePane();
    if (i === 0) {
      navigateTo(cleanPath);
      return;
    }
    navigateExtraPane(i - 1, cleanPath);
  }

  function selectView(view: MainView) {
    setMainView(view);
    pushHistory({ view, path: currentPath() });
  }

  // Explorer tabs: session bookmarks with independent folder paths and sub-pane
  // layouts (splitPanePaths and splitCols), so modifying panes in one tab
  // does not affect any other tab.
  const [tabs, setTabs] = createSignal<ExplorerTab[]>([
    {
      id: crypto.randomUUID(),
      path: DEFAULT_PATH,
      splitPanePaths: settings.splitPanePaths.slice(),
      splitCols: settings.splitCols,
    },
  ]);
  const [activeTabId, setActiveTabId] = createSignal(tabs()[0].id);

  // Keeps the active tab's remembered state (path, split panes, split cols) in sync
  // with normal navigation and pane layout changes.
  createEffect(() => {
    const path = currentPath();
    const splitPanePaths = settings.splitPanePaths.slice();
    const splitCols = settings.splitCols;
    if (mainView() !== "explorer") return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId()
          ? { ...t, path, splitPanePaths, splitCols }
          : t
      )
    );
  });

  function openTabWithPath(path: string) {
    const tab: ExplorerTab = {
      id: crypto.randomUUID(),
      path,
      splitPanePaths: [],
      splitCols: 1,
    };
    // Sync current tab before switching
    const currentTabId = activeTabId();
    setTabs((prev) => [
      ...prev.map((t) =>
        t.id === currentTabId
          ? { ...t, path: currentPath(), splitPanePaths: settings.splitPanePaths.slice(), splitCols: settings.splitCols }
          : t
      ),
      tab,
    ]);
    setActiveTabId(tab.id);
    setActivePane(0);
    setPaneHistories([]);
    setSettings("splitPanePaths", []);
    setSettings("splitCols", 1);
    navigateTo(path);
  }

  function openNewTab() {
    // New tab opens with a fresh single-pane view at the current path
    openTabWithPath(currentPath());
  }

  function switchTab(id: string) {
    if (id === activeTabId()) return;
    const currentTabId = activeTabId();
    const currentTabs = tabs();
    const targetTab = currentTabs.find((t) => t.id === id);
    if (!targetTab) return;

    // Save active tab's current state
    setTabs((prev) =>
      prev.map((t) =>
        t.id === currentTabId
          ? { ...t, path: currentPath(), splitPanePaths: settings.splitPanePaths.slice(), splitCols: settings.splitCols }
          : t
      )
    );

    setActiveTabId(id);
    setActivePane(0);
    setPaneHistories([]);
    setSettings("splitPanePaths", targetTab.splitPanePaths ? targetTab.splitPanePaths.slice() : []);
    setSettings("splitCols", targetTab.splitCols ?? 1);
    navigateTo(targetTab.path);
  }

  function closeTab(id: string) {
    const list = tabs();
    if (list.length <= 1) return;
    const index = list.findIndex((t) => t.id === id);
    if (index < 0) return;
    const next = list.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTabId() === id) {
      const fallback = next[Math.max(0, index - 1)];
      setActiveTabId(fallback.id);
      setActivePane(0);
      setPaneHistories([]);
      setSettings("splitPanePaths", fallback.splitPanePaths ? fallback.splitPanePaths.slice() : []);
      setSettings("splitCols", fallback.splitCols ?? 1);
      navigateTo(fallback.path);
    }
  }

  const [graphFocusRequest, setGraphFocusRequest] = createSignal<GraphFocusRequest | null>(null);

  // Picking a place from the sidebar (a drive, a recent/favourite folder, or
  // a quick-access shortcut) normally jumps to whichever explorer pane is
  // active — but while already looking at the storage graph, jumping away
  // from it is more disruptive than useful, so this asks GraphView to
  // expand and center on that path's node there instead.
  function selectSidebarPath(path: string) {
    if (mainView() === "graph") {
      setGraphFocusRequest((prev) => ({ path, token: (prev?.token ?? 0) + 1 }));
      return;
    }
    setMainView("explorer");
    navigateActivePane(path);
  }

  function closeSettings() {
    if (historyIndex() > 0) {
      goBack();
    } else {
      selectView("explorer");
    }
  }

  const activePlugin = () => registeredPlugins().find((p) => p.id === mainView());
  const showSidebar = () => {
    const view = mainView();
    if (view === "settings") return false;
    const p = activePlugin();
    if (p && p.fullPanel) return false;
    return true;
  };

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
    if (view !== "explorer" && view !== "graph") return;
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

    const identity = JSON.stringify([bg.unsplashMode, bg.unsplashCategories, bg.unsplashFixedList]);
    const isExplicitChange = previousWallpaperIdentity !== null && previousWallpaperIdentity !== identity;
    previousWallpaperIdentity = identity;

    if (bg.unsplashMode === "fixed") {
      // "Fixed" has no refresh schedule (see the Settings UI) — only fetch
      // when there's truly nothing to show yet; otherwise it stays put until
      // the user clicks "Get new wallpaper". Uses the first selected
      // category (if any) purely as a search hint for that one photo — the
      // full category list only matters for auto-rotation below.
      if (!wallpaper() && !cachedWallpaperImage()) {
        getWallpaper(bg.unsplashCategories[0] || "nature");
      }
      return;
    }

    if (bg.unsplashMode === "autoRotateCategory") {
      const categories = bg.unsplashCategories.length ? bg.unsplashCategories : ["nature"];
      const current = activeRotationCategory();
      const currentStillSelected = current !== null && categories.includes(current);
      // Selecting an additional category (or reordering the list) while the
      // category currently on screen stays selected shouldn't yank the
      // wallpaper out from under the user — it only changes what future
      // rotations get to pick from. Only force an immediate swap when the
      // category actually being shown right now was deselected.
      const forceImmediate = isExplicitChange && !currentStillSelected;
      let index = current ? categories.indexOf(current) : -1;
      scheduleWallpaperRefresh(bg.unsplashChangeFrequencyMs, forceImmediate, categories, () => {
        index = (index + 1) % categories.length;
        return fetchCategoryWallpaper(categories[index]);
      });
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
    return settingsLoaded() && !wallpaperPending();
  }

  const MIN_SIDEBAR_WIDTH = 52;
  const MAX_SIDEBAR_WIDTH = 500;

  function handleSidebarResizeStart(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    target.classList.add("dragging");

    const startX = e.clientX;
    const startWidth = settings.sidebarWidth || 220;

    function onPointerMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidth + deltaX)
      );
      setSettings("sidebarWidth", newWidth);
    }

    function onPointerUp(upEvent: PointerEvent) {
      try {
        target.releasePointerCapture(upEvent.pointerId);
      } catch (_) {}
      target.classList.remove("dragging");
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      persistSettings();
    }

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
  }

  function handleSidebarResizeReset() {
    setSettings("sidebarWidth", 220);
    persistSettings();
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
          canGoBack={canGoBack()}
          canGoForward={canGoForward()}
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
                path={activePanePath()}
                pathInput={pathInput()}
                onPathInputChange={setPathInput}
                onNavigate={navigateActivePane}
                favouritePaths={settings.favouritePaths}
                onToggleFavourite={toggleFavourite}
              />
            </Show>
          }
        />

        <Show when={mainView() === "explorer"}>
          <ExplorerTabs tabs={tabs()} activeTabId={activeTabId()} onSwitch={switchTab} onClose={closeTab} onNew={openNewTab} />
        </Show>

        <div class="explorer-view" style={{ "--sidebar-width": `${settings.sidebarWidth || 220}px` }}>
          <ViewRail activeView={mainView()} onSelectView={selectView} />
          <Show when={showSidebar()}>
            <Sidebar
              data-bg-lightness={sidebarLightness()}
              currentPath={activePanePath()}
              onSelectPath={selectSidebarPath}
              onSelectView={selectView}
              activeView={mainView()}
              favouritePaths={settings.favouritePaths}
              onToggleFavourite={toggleFavourite}
              folderColors={settings.folderColors}
              recentPaths={settings.recentPaths}
              onRemoveRecent={removeRecent}
              width={settings.sidebarWidth}
              customContent={activePlugin()?.sidebar?.({
                currentPath: currentPath(),
                onSelectPath: selectSidebarPath
              })}
            />
            <div
              class="sidebar-resizer"
              onPointerDown={handleSidebarResizeStart}
              onDblClick={handleSidebarResizeReset}
              title="Drag to resize drive panel (double-click to reset)"
            />
          </Show>
          {/* Views are mounted and unmounted on toggle so resources
              (signals, listeners, timers) are freed when hidden. */}
          <div class="view-stack">
            <Show when={mainView() === "explorer"}>
              <div class="view-pane">
                <ExplorerView
                  data-bg-lightness={fileListLightness()}
                  path={currentPath()}
                  onNavigate={navigateTo}
                  searchQuery={searchQuery()}
                  searchRecursive={searchRecursive()}
                  favouritePaths={settings.favouritePaths}
                  onToggleFavourite={toggleFavourite}
                  folderColors={settings.folderColors}
                  onSetFolderColor={setFolderColor}
                  inAppShortcuts={settings.inAppShortcuts}
                  sortKey={settings.sortKey}
                  sortDirection={settings.sortDirection}
                  onSortChange={updateSort}
                  groupFoldersFirst={settings.groupFoldersFirst}
                  onGroupFoldersFirstChange={updateGroupFoldersFirst}
                  groupBy={settings.groupBy}
                  onGroupByChange={updateGroupBy}
                  splitCols={settings.splitCols}
                  onSplitColsChange={(cols) => setSettings("splitCols", cols)}
                  splitPanePaths={settings.splitPanePaths}
                  onSplitPanePathsChange={handleSplitPanePathsChange}
                  onNavigateExtraPane={navigateExtraPane}
                  activePane={activePane()}
                  onActivePaneChange={setActivePane}
                />
              </div>
            </Show>
            
            {/* Plugin panels stay mounted (hidden via display:none) so their
                state (open tabs, repo data, graph zoom) survives switching
                to settings and back. */}
            <For each={registeredPlugins()}>
              {(plugin) => (
                <Show when={plugin.mainPanel || plugin.fullPanel}>
                  {(() => {
                    // Per-plugin opacity/blur override, if the user (or the
                    // plugin's own settingsPanel) set one via pluginSettings
                    // — falls back to Flurer's own shell values otherwise.
                    // Set as inline custom properties on THIS plugin's own
                    // wrapper div (not document.documentElement) so each
                    // plugin gets an independently-scoped value under the
                    // same --plugin-surface-* variable names: inline custom
                    // properties cascade down a div's own subtree, not
                    // sideways to sibling .view-panes, so two plugins never
                    // clobber each other's opacity. See
                    // docs/superpowers/specs/2026-08-19-per-plugin-translucency-design.md.
                    const effOpacity = () => settings.pluginSettings?.[plugin.id]?.surfaceOpacity ?? settings.uiTintOpacity;
                    const effBlur = () => settings.pluginSettings?.[plugin.id]?.surfaceBlur ?? settings.uiBlurPx;
                    return (
                      <div
                        class="view-pane plugin-view-pane"
                        style={{
                          display: mainView() === plugin.id ? "flex" : "none",
                          "--plugin-surface-opacity": effOpacity(),
                          "--plugin-surface-blur": `${effBlur()}px`,
                        }}
                      >
                        {(() => {
                          const props = {
                            currentPath: currentPath(),
                            navigateTo: navigateTo,
                            searchQuery: searchQuery(),
                            focusPath: graphFocusRequest(),
                            active: mainView() === plugin.id,
                            dataBgLightness: fileListLightness(),
                            settingsLoaded: settingsLoaded(),
                            baseSurfaceOpacity: settings.uiTintOpacity,
                            baseSurfaceBlur: settings.uiBlurPx,
                            pluginSettings: settings.pluginSettings?.[plugin.id] ?? {},
                            onPluginSettingsChange: (patch: any) => updatePluginSettings(plugin.id, patch)
                          };
                          if (plugin.fullPanel) {
                            return plugin.fullPanel(props);
                          } else if (plugin.mainPanel) {
                            return plugin.mainPanel(props);
                          }
                          return null;
                        })()}
                      </div>
                    );
                  })()}
                </Show>
              )}
            </For>

            <Show when={mainView() === "trash"}>
              <div class="view-pane">
                <TrashView data-bg-lightness={fileListLightness()} />
              </div>
            </Show>

            <Show when={mainView() === "settings"}>
              <div class="view-pane">
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
                   showProgressWhenIdle={settings.showProgressWhenIdle}
                   onShowProgressWhenIdleChange={updateShowProgressWhenIdle}
                   liveFolderSizeUpdates={settings.liveFolderSizeUpdates}
                   onLiveFolderSizeUpdatesChange={updateLiveFolderSizeUpdates}
                   maxHistoryItems={settings.maxHistoryItems}
                   onMaxHistoryItemsChange={updateMaxHistoryItems}
                  globalShortcut={settings.globalShortcut}
                  onGlobalShortcutChange={updateGlobalShortcut}
                  inAppShortcuts={settings.inAppShortcuts}
                  onInAppShortcutChange={updateInAppShortcut}
                  onResetInAppShortcut={resetInAppShortcut}
                  launchAtStartup={settings.launchAtStartup}
                  onLaunchAtStartupChange={updateLaunchAtStartup}
                  hasUnsplashApiKey={hasUnsplashApiKey()}
                  onSaveUnsplashApiKey={saveUnsplashApiKey}
                  apiKeyError={apiKeyError()}
                  wallpaper={wallpaper()}
                  wallpaperError={wallpaperError()}
                  onFetchWallpaper={getWallpaper}
                  onNextCategoryWallpaper={goToNextCategoryWallpaper}
                  onPrevCategoryWallpaper={goToPrevCategoryWallpaper}
                  canGoPrevCategoryWallpaper={categoryWallpaperIndex() > 0}
                  disabledPlugins={settings.disabledPlugins}
                  onDisabledPluginsChange={updateDisabledPlugins}
                  pluginSettings={settings.pluginSettings}
                  onPluginSettingsChange={updatePluginSettings}
                  searchIndexRoots={settings.searchIndexRoots}
                  onSearchIndexRootsChange={updateSearchIndexRoots}
                  recentPaths={settings.recentPaths}
                  favouritePaths={settings.favouritePaths}
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
      </Show>
    </main>
  );
}

export default App;
