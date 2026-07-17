import type { SortDirection, SortKey } from "./fs";
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
  unsplashCategory: string | null;
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
  recentPaths: string[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  fontFamily: string;
  fontSizePx: number;
  sidebarTooltipDelayMs: number;
  showProgressWhenIdle: boolean;
  pluginSettings: Record<string, any>;
  disabledPlugins: string[];
};

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
    unsplashCategory: null,
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
  recentPaths: [],
  sortKey: "name",
  sortDirection: "ascending",
  fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif",
  fontSizePx: 16,
  sidebarTooltipDelayMs: 500,
  showProgressWhenIdle: false,
  pluginSettings: {},
  disabledPlugins: [],
};

export const FONT_FAMILY_PRESETS: { label: string; value: string }[] = [
  { label: "Inter", value: "Inter, Avenir, Helvetica, Arial, sans-serif" },
  { label: "System UI", value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" },
  { label: "Georgia", value: "Georgia, Cambria, 'Times New Roman', Times, serif" },
  { label: "Consolas", value: "Consolas, Monaco, 'Courier New', monospace" },
];

export const MIN_FONT_SIZE_PX = 12;
export const MAX_FONT_SIZE_PX = 22;

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
