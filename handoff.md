# Flurer v0.4.0 — Handoff

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
  App.tsx               # Root: settings, routing, history
  App.css               # ~35KB — all styles, tokens, responsive
  lib/
    settings.ts         # Settings type, defaults, presets
    fs.ts               # File type, format utilities
    graphTree.ts        # Disk → tree → layout algorithm
    unsplash.ts         # Wallpaper fetching/caching
  components/
    Sidebar.tsx         # Drives, recents, favourites, quick-access
    FileList.tsx        # Table + context menu + clipboard
    GraphView.tsx       # SVG canvas, nodes/edges, pan/zoom/drag
    CommandBar.tsx      # Top bar: nav, search, progress indicator
    ProgressIndicator.tsx # Operation progress panel with cancel
    SettingsPanel.tsx / CustomizationSettings.tsx  # Settings UI
    ViewRail.tsx        # Icon strip: explorer / graph / settings

src-tauri/src/          # Rust backend
  fs/ops.rs             # Copy/move/delete (async via spawn_blocking)
  fs/sizecache/         # Background folder-size computation
  progress.rs           # Task registry, cancellation flags, event emission
  helpers/settings.rs   # Persist/load settings JSON
  state/mod.rs          # App state, Settings struct
  disks/mod.rs          # WMI disk topology queries
  lib.rs                # Tauri command registry
```

## Key Design Decisions

**Visual:** "Grounded Warmth" — warm matte surfaces over any wallpaper, amber accent. Glass effect only on floating elements.

**Progressive:** Copy/move/delete run on blocking threads via `tokio::spawn_blocking` so Tauri's event loop stays responsive. Progress events emitted per 64KB chunk.

**Cancellation:** Operations register via `register_task()` returning an `Arc<AtomicBool>`. `cancel_operation(task_id)` flips the flag. Copy loops check every chunk.

**Settings:** Full Settings struct mirrored in Rust and TypeScript. `#[serde(rename_all = "camelCase")]` maps between frontend camelCase and Rust snake_case. Persisted as JSON on disk.

## New in 0.4.0

- Grounded Warmth redesign: matte surfaces, neutral cool-gray panels
- Type system with CSS custom property tokens
- Responsive breakpoints: 900/600/480/375px with column hiding
- Hover tooltip at mouse position with configurable delay
- Real-time byte-level progress for copy/move
- Cancel button for in-progress operations
- Keyboard-focusable file rows
- prefers-reduced-motion support
- Sidebar hidden in settings view
- Progress panel fixed outside stacking context
- Settings properly persisted across restarts

## CI/CD

GitHub Actions in `.github/workflows/release.yml`:
- On tag push (`v*`), builds the Tauri app, creates a GitHub Release, and uploads the MSI + NSIS installers.

## Publishing

```bash
git tag v0.4.0
git push origin v0.4.0    # triggers CI build + release
```
