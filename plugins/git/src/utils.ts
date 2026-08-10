import type { RecentRepo } from "./types";
import { createSignal, createRoot } from "solid-js";

const RECENT_REPOS_KEY = "flurer-git-recent-repos";
const MAX_RECENT_REPOS = 20;

let _isLight: boolean | null = null;
let _bgColor: string | null = null;
const [_surfaceOpacity, _setSurfaceOpacity] = createRoot(() =>
  createSignal(0.04)
);
const [_buttonTintOpacity, _setButtonTintOpacity] = createRoot(() =>
  createSignal(0.12)
);

/** Override the surface tint opacity (0–1). Passed via plugin settings. */
export function setSurfaceOpacity(opacity: number) {
  _setSurfaceOpacity(Math.max(0, Math.min(1, opacity)));
}

/** Get current surface tint opacity. */
export function getSurfaceOpacity(): number {
  return _surfaceOpacity();
}

/** Override the button tint opacity (0–1). Passed via plugin settings. */
export function setButtonTintOpacity(opacity: number) {
  _setButtonTintOpacity(Math.max(0, Math.min(1, opacity)));
}

/** Get current button tint opacity. */
export function getButtonTintOpacity(): number {
  return _buttonTintOpacity();
}

/** Detect whether Flurer's background is light or dark, and cache its hex. */
export function isLightBg(): boolean {
  if (_isLight !== null) return _isLight;
  try {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    // Try --bg-color first (hex)
    const bg = cs.getPropertyValue("--bg-color").trim();
    if (bg && bg !== "transparent") {
      const match = bg.match(/^#([0-9a-f]{6})$/i);
      if (match) {
        _bgColor = bg;
        const r = parseInt(match[1].slice(0, 2), 16);
        const g = parseInt(match[1].slice(2, 4), 16);
        const b = parseInt(match[1].slice(4, 6), 16);
        _isLight = 0.299 * r + 0.587 * g + 0.114 * b > 128;
        return _isLight;
      }
    }
    // Fallback: read --glass-tint-rgb or --panel-rgb (e.g. "32, 32, 32")
    const tintRgb = cs.getPropertyValue("--glass-tint-rgb").trim()
      || cs.getPropertyValue("--panel-rgb").trim();
    if (tintRgb) {
      const parts = tintRgb.split(",").map((s) => parseInt(s.trim(), 10));
      if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        _bgColor = `#${parts.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
        _isLight = 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2] > 128;
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
  const o = opacity ?? _surfaceOpacity();
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

/** Parse a CSS color string (#hex or rgb()) into [r, g, b]. */
function parseColor(color: string): [number, number, number] | null {
  const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const h = hexMatch[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgbMatch = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }
  return null;
}

/** Blend a color toward the background at the given opacity, creating a tinted button surface. */
export function buttonBg(accentColor: string, opacity?: number): string {
  const o = opacity ?? _buttonTintOpacity();
  isLightBg();
  const bgHex = _bgColor || (isLightBg() ? "#f5f5f5" : "#1a1a2e");
  const bg = parseColor(bgHex) || (isLightBg() ? [245, 245, 245] : [26, 26, 46]);
  const fg = parseColor(accentColor) || [0, 120, 212];
  return `rgb(${blendChannel(bg[0], fg[0], o)},${blendChannel(bg[1], fg[1], o)},${blendChannel(bg[2], fg[2], o)})`;
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

const BRANCH_SELECT_KEY = "flurer-git-branch-selection";
const ACTIVE_VIEW_KEY = "flurer-git-active-view";

/** Load the saved active view for a given repo path. */
export function getSavedActiveView(path: string): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_VIEW_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map?.[path] ?? null;
  } catch {
    return null;
  }
}

/** Persist the active view for a given repo path. */
export function saveActiveView(path: string, view: string): void {
  try {
    const raw = localStorage.getItem(ACTIVE_VIEW_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[path] = view;
    localStorage.setItem(ACTIVE_VIEW_KEY, JSON.stringify(map));
  } catch {}
}

/** Load the saved branch filter selection for a given repo path. */
export function getSavedBranchSelection(path: string): string[] | null {
  try {
    const raw = localStorage.getItem(BRANCH_SELECT_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const sel = map?.[path];
    if (Array.isArray(sel)) return sel;
    return null;
  } catch {
    return null;
  }
}

/** Persist the branch filter selection for a given repo path. */
export function saveBranchSelection(path: string, branches: string[]): void {
  try {
    const raw = localStorage.getItem(BRANCH_SELECT_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[path] = branches;
    localStorage.setItem(BRANCH_SELECT_KEY, JSON.stringify(map));
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
