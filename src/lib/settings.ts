import type { SortDirection, SortKey } from "./fs";
import { DEFAULT_IN_APP_SHORTCUTS, type InAppShortcutAction } from "./shortcuts";
import { DEFAULT_UNSPLASH_FREQUENCY_MS } from "./unsplash";

export type Theme = "light" | "dark";
export type BackgroundType = "none" | "gradient" | "solid" | "unsplash";
export type UnsplashMode = "fixed" | "autoRotateCategory" | "autoRotateList";
export type LastMainView = "explorer" | "graph";

export type BackgroundSettings = {
  backgroundType: BackgroundType;
  opacity: number;
  gradientColor1: string;
  gradientColor2: string;
  gradientDirection: string;
  solidColor: string;
  unsplashMode: UnsplashMode;
  unsplashCategories: string[];
  unsplashFixedList: string[];
  unsplashChangeFrequencyMs: number;
};

export type GraphNodePosition = { nodeId: string; x: number; y: number };

export type GraphState = {
  expandedNodeIds: string[];
  panX: number;
  panY: number;
  zoom: number;
  nodePositions: GraphNodePosition[];
};

export type Settings = {
  wallpaper: string | null;
  background: BackgroundSettings;
  theme: Theme;
  uiTintOpacity: number;
  uiBlurPx: number;
  lastMainView: LastMainView;
  persistGraphState: boolean;
  graphState: GraphState | null;
  favouritePaths: string[];
  // Path -> hex color, for the color-tag dot shown next to a file or folder
  // in the file list and sidebar. Absence of a key means "no tag" — cleared
  // via the store's nested-path setter with `undefined`, which is why the
  // value type includes it (see setFolderColor in App.tsx).
  folderColors: Record<string, string | undefined>;
  recentPaths: string[];
  maxHistoryItems: number;
  sortKey: SortKey;
  sortDirection: SortDirection;
  fontFamily: string;
  fontSizePx: number;
  sidebarTooltipDelayMs: number;
  showProgressWhenIdle: boolean;
  liveFolderSizeUpdates: boolean;
  pluginSettings: Record<string, any>;
  disabledPlugins: string[];
  // OS-wide hotkey that brings Flurer to front/focus from anywhere, even
  // when it isn't focused or is minimized. Empty string means disabled.
  globalShortcut: string;
  // Launches Flurer minimized to the tray on login, so the shortcut above
  // is live from boot instead of only after the app's been opened once.
  launchAtStartup: boolean;
  windowWidth: number;
  windowHeight: number;
  // In-app shortcuts (Delete/Rename/Copy/Cut/Paste/Select all in the file
  // list) — distinct from globalShortcut above, which is the OS-wide
  // show-Flurer hotkey. Partial<> because a settings file saved before this
  // existed has no key here at all; FileList falls back to
  // DEFAULT_IN_APP_SHORTCUTS per-action rather than requiring every action
  // to have an explicit entry.
  inAppShortcuts: Partial<Record<InAppShortcutAction, string>>;
};

export const DEFAULT_GLOBAL_SHORTCUT = "Ctrl+Alt+E";
export const DEFAULT_WINDOW_WIDTH = 800;
export const DEFAULT_WINDOW_HEIGHT = 600;

export const DEFAULT_SETTINGS: Settings = {
  wallpaper: null,
  background: {
    backgroundType: "none",
    opacity: 0.35,
    gradientColor1: "#667eea",
    gradientColor2: "#764ba2",
    gradientDirection: "to bottom right",
    solidColor: "#1f2937",
    unsplashMode: "fixed",
    unsplashCategories: [],
    unsplashFixedList: [],
    unsplashChangeFrequencyMs: DEFAULT_UNSPLASH_FREQUENCY_MS,
  },
  theme: "light",
  uiTintOpacity: 0.35,
  uiBlurPx: 12,
  lastMainView: "explorer",
  persistGraphState: true,
  graphState: null,
  favouritePaths: [],
  folderColors: {},
  recentPaths: [],
  maxHistoryItems: 15,
  sortKey: "name",
  sortDirection: "ascending",
  fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif",
  fontSizePx: 16,
  sidebarTooltipDelayMs: 500,
  showProgressWhenIdle: false,
  liveFolderSizeUpdates: true,
  pluginSettings: {},
  disabledPlugins: [],
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  launchAtStartup: false,
  windowWidth: DEFAULT_WINDOW_WIDTH,
  windowHeight: DEFAULT_WINDOW_HEIGHT,
  inAppShortcuts: { ...DEFAULT_IN_APP_SHORTCUTS },
};

export const FONT_FAMILY_PRESETS: { label: string; value: string }[] = [
  { label: "Inter", value: "Inter, Avenir, Helvetica, Arial, sans-serif" },
  { label: "System UI", value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" },
  { label: "Georgia", value: "Georgia, Cambria, 'Times New Roman', Times, serif" },
  { label: "Consolas", value: "Consolas, Monaco, 'Courier New', monospace" },
];

export const FOLDER_COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: "Red", hex: "#e5484d" },
  { label: "Orange", hex: "#f5a524" },
  { label: "Green", hex: "#45a163" },
  { label: "Blue", hex: "#3b82f6" },
  { label: "Purple", hex: "#8b5cf6" },
];

export const MIN_FONT_SIZE_PX = 12;
export const MAX_FONT_SIZE_PX = 22;

export const MIN_HISTORY_ITEMS = 1;
export const MAX_HISTORY_ITEMS = 100;

export const GRADIENT_DIRECTIONS = [
  "to top",
  "to top right",
  "to right",
  "to bottom right",
  "to bottom",
  "to bottom left",
  "to left",
  "to top left",
];

export const GRADIENT_PRESETS: { color1: string; color2: string; direction: string }[] = [
  { color1: "#667eea", color2: "#764ba2", direction: "to bottom right" },
  { color1: "#f093fb", color2: "#f5576c", direction: "to bottom right" },
  { color1: "#4facfe", color2: "#00f2fe", direction: "to bottom right" },
  { color1: "#43e97b", color2: "#38f9d7", direction: "to bottom right" },
  { color1: "#fa709a", color2: "#fee140", direction: "to bottom right" },
  { color1: "#30cfd0", color2: "#330867", direction: "to bottom right" },
];

export const SOLID_COLOR_PRESETS = [
  "#1f2937",
  "#ffffff",
  "#0f0f0f",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#64748b",
];
