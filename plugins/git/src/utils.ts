import type { RecentRepo } from "./types";
import { createSignal, createRoot } from "solid-js";

const RECENT_REPOS_KEY = "flurer-git-recent-repos";
const MAX_RECENT_REPOS = 20;

let _isLight: boolean | null = null;
let _bgColor: string | null = null;
const [_surfaceOpacity, _setSurfaceOpacity] = createRoot(() =>
  createSignal(0.04)
);

/** Override the surface tint opacity (0–1). Passed via plugin settings. */
export function setSurfaceOpacity(opacity: number) {
  _setSurfaceOpacity(Math.max(0, Math.min(1, opacity)));
}

/** Get current surface tint opacity. */
export function getSurfaceOpacity(): number {
  return _surfaceOpacity();
}

/** Detect whether Flurer's background is light or dark, and cache its hex. */
export function isLightBg(): boolean {
  if (_isLight !== null) return _isLight;
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-color").trim();
    if (bg) {
      const match = bg.match(/^#([0-9a-f]{6})$/i);
      if (match) {
        _bgColor = bg;
        const r = parseInt(match[1].slice(0, 2), 16);
        const g = parseInt(match[1].slice(2, 4), 16);
        const b = parseInt(match[1].slice(4, 6), 16);
        // Perceived luminance (sRGB coefficients)
        _isLight = 0.299 * r + 0.587 * g + 0.114 * b > 128;
        return _isLight;
      }
    }
  } catch {}
  // Fallback: assume dark (Flurer default)
  _isLight = false;
  return false;
}

function blendChannel(base: number, tint: number, opacity: number): number {
  return Math.round(base + (tint - base) * opacity);
}

/** Get a solid surface background blended against the detected bg color.
 *  For dark backgrounds, tints lighter. For light backgrounds, tints darker. */
export function surfaceBg(opacity?: number): string {
  const o = opacity ?? _surfaceOpacity;
  isLightBg(); // ensure _bgColor is cached
  const hex = _bgColor || (isLightBg() ? "#f5f5f5" : "#1a1a2e");
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isLightBg()) {
    // Tint toward black (darker surface)
    return `rgb(${blendChannel(r, 0, o)},${blendChannel(g, 0, o)},${blendChannel(b, 0, o)})`;
  } else {
    // Tint toward white (lighter surface)
    return `rgb(${blendChannel(r, 255, o)},${blendChannel(g, 255, o)},${blendChannel(b, 255, o)})`;
  }
}

export function getRecentRepos(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(RECENT_REPOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveRecentRepo(path: string, branch?: string): void {
  const repos = getRecentRepos().filter((r) => r.path !== path);
  const name = basename(path);
  repos.unshift({ path, name, lastOpened: Date.now(), branch });
  if (repos.length > MAX_RECENT_REPOS) repos.length = MAX_RECENT_REPOS;
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
}

export function removeRecentRepo(path: string): void {
  const repos = getRecentRepos().filter((r) => r.path !== path);
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos));
}

const OPEN_TABS_KEY = "flurer-git-open-tabs";
const ACTIVE_TAB_KEY = "flurer-git-active-tab";

export function getSavedOpenTabs(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_TABS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveOpenTabs(paths: string[]): void {
  try {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(paths));
  } catch {}
}

export function getSavedActiveTab(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY);
  } catch {
    return null;
  }
}

export function saveActiveTab(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(ACTIVE_TAB_KEY, path);
    } else {
      localStorage.removeItem(ACTIVE_TAB_KEY);
    }
  } catch {}
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts * 1000;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function statusToLabel(status: string): string {
  switch (status) {
    case "M": return "Modified";
    case "A": return "Added";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    case "??": return "Untracked";
    case "!": return "Ignored";
    default: return status;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "M": return "#f59e0b";
    case "A": return "#4ade80";
    case "D": return "#f87171";
    case "R": return "#c084fc";
    case "C": return "#60a5fa";
    case "??": return "#f87171";
    default: return "var(--text-muted, #888)";
  }
}
