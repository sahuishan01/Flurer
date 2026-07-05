import { DEFAULT_UNSPLASH_FREQUENCY_MS } from "./unsplash";

export type Theme = "light" | "dark";
export type BackgroundType = "none" | "gradient" | "solid" | "unsplash";
export type UnsplashMode = "fixed" | "autoRotateCategory" | "autoRotateList";

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

export type Settings = {
  wallpaper: string | null;
  background: BackgroundSettings;
  theme: Theme;
  uiTintOpacity: number;
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
};

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
