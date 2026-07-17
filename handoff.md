# Flurer v0.4.18 — Handoff

## Overview

Flurer is a lightweight Windows file manager built with Tauri v2 + SolidJS. The storage graph view (SVG-based disk topology visualizer) is the differentiator.

## Build & Run

```bash
# Development
npm install
npm run tauri dev     # starts Vite + Tauri dev server

# Production build
npm run tauri build   # outputs MSI + NSIS installer
```

Output: `src-tauri/target/release/bundle/` (msi + nsis exe)

## Architecture

```
src/                    # SolidJS frontend
  App.tsx               # Root: settings, routing, history, wallpaper avg colors
  App.css               # ~41KB — all styles, tokens, responsive breakpoints, transitions
  theme.css             # Light/dark themes, glass parameters, control material variables
  lib/
    settings.ts         # Settings type, defaults, presets
    fs.ts               # File type, format utilities
    graphTree.ts        # Disk → tree → layout algorithm
    unsplash.ts         # Wallpaper fetching/caching
  components/
    Sidebar.tsx         # Drives, recents, favourites, quick-access
    FileList.tsx        # Table + context menu + clipboard, size revalidation
    GraphView.tsx       # SVG canvas, nodes/edges, pan/zoom/drag
    CommandBar.tsx      # Top bar: nav, search, progress indicator
    ProgressIndicator.tsx # Operation progress panel with cancel
    SettingsPanel.tsx / CustomizationSettings.tsx  # Settings UI
    ViewRail.tsx        # Icon strip: explorer / graph / settings

src-tauri/src/          # Rust backend
  fs/ops.rs             # Copy/move/delete (async via spawn_blocking)
  sizecache/mod.rs      # Background folder-size computation & recursive child caching
  progress.rs           # Task registry, cancellation flags, event emission
  helpers/settings.rs   # Persist/load settings JSON
  state/mod.rs          # App state, Settings struct
  disks/mod.rs          # WMI disk topology queries
  lib.rs                # Tauri command registry
```

## Key Design Decisions

**Visual & Contrast:** 
- "Grounded Warmth" — warm matte surfaces over any wallpaper, amber accent.
- **Dynamic Background-Aware Font Contrast**: Frontend measures background wallpaper lightness on startup and updates via offscreen canvas averages. A `data-bg-lightness` attribute overrides font colors downstream when using dark/light wallpapers.
- **Glassmorphic Fluent Command Bar**: Redesigned `.command-bar` uses glass material with chiseled reflections. Icon buttons are flat by default and elevate into glass capsules on hover/active.

**Translucency & Opacity:**
- Controls (like search fields and path bars) use `--control-opacity`, which computes as a fraction of the user's `--surface-opacity` (tint slider). This ensures they remain transparent and adapt properly.

**High Contrast Select Options:**
- Native browser dropdown selectors are styled with solid background colors (`--option-bg` and `--option-color` in light/dark modes) to prevent rendering unreadable white-on-gray items in modern web engines.

**Recursive Cache Priming:**
- The Rust size cache worker caches calculated sizes for all traversed subdirectories during recursive folder-size walks, preventing recalculations when navigating inside directories.

**Navigation Stability:**
- The frontend tracks request parameters during directory loads. Stale or out-of-order responses are discarded, preventing click freezes or incorrect drive listings during rapid navigation.

## Version Changelog

### v0.4.18
- Refactored sidebar drive cards to make the entire container clickable as a single button, extending target surface area to include storage bars and text labels.
- Integrated explicit resets for `.sidebar-drive` button inheritance.

### v0.4.17
- Fixed click freeze and directory load race condition by discarding stale list responses.
- Cleared directory entries instantly on path changes to prevent old "Calculating" states from lingering.

### v0.4.16
- Refactored Rust sizecache backend to populate the cache with subdirectory size metrics in a single lock during recursive walks.

### v0.4.15
- Replaced hardcoded gray control backgrounds with proportional `--control-opacity` scaling.
- Fixed select option text visibility in dark/light modes using solid background overrides.

### v0.4.14
- Redesigned the top command bar with chiseled Fluent border reflections, glass capsule buttons, and focus-expanding search pill transitions.

### v0.4.13
- Converted command bar and path inputs to glass material.
- Added legacy RGB fallback variables in `theme.css` to fix legacy transparent panels.

### v0.4.12
- Elevated command bar layering to `z-index: 100` to prevent drop-down panels from sliding behind content cards.

### v0.4.11
- Fixed startup transparent crash by initializing settings store prior to referencing.

### v0.4.10
- Wired background wallpaper averaging and canvas lightness detection to set dynamic lightness attributes.

## CI/CD

GitHub Actions in `.github/workflows/release.yml`:
- On tag push (`v*`), builds the Tauri app, creates a GitHub Release, and uploads the MSI + NSIS installers.

## Publishing

```bash
git tag v0.4.18
git push origin v0.4.18    # triggers CI build + release
```
