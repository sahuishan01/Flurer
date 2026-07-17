# Flurer v0.4.20 — Standalone Graph Plugin & User-Driven Marketplace

## Overview

The **Storage Graph** plugin has been moved to its own standalone repository at `../flurer-plugin-graph/`. Users install it manually via the Plugin Marketplace using either a **GitHub repo URL** (fetches the latest release's `.zip` asset) or a **ZIP file** picked from disk. The hardcoded `MARKETPLACE_PLUGINS` array has been removed.

---

## Plugin Architecture & Capabilities

Plugins can dynamically extend Flurer in four major ways:
1. **Left Panel Navigation (View Rail)**: Plugins can register a custom button (e.g., SVG icon) on the leftmost `ViewRail` via `viewRailButton`.
2. **Sidebar Customization**: Plugins can completely replace the standard Drives/Recents/Favourites list with custom rendering via `sidebar`.
3. **Content Panel Options**:
   - **Main Panel Only (`mainPanel`)**: Plugins can render inside the main screen alongside the standard (or overridden) sidebar.
   - **Combined Area (`fullPanel`)**: Plugins can take over the combined area of both the sidebar and the main panel (identical to how the Settings panel behaves).
4. **Custom Settings (`settingsPanel`)**: Plugins can inject customized controls into the settings page under their own dedicated navigation tab.

### State & Persistence
- A generic `pluginSettings` map (`Record<string, any>`) in the main settings schema lets plugins read & write their own state.
- Whether a plugin is active/enabled/disabled is saved within `disabledPlugins: string[]`.

---

## Directory Structure

```
src/
  lib/
    plugins.ts          # Core plugin loader & registry (exposes Solid & Tauri APIs globally)
  components/
    PluginMarketplace.tsx # Plugin installer/manager settings view
```

The graph plugin lives at `../flurer-plugin-graph/` (standalone repo). See its `README.md` for build instructions.

---

## Plugin Installation

Users install plugins two ways from the Plugin Marketplace:

1. **GitHub URL** — paste `https://github.com/owner/repo` or `owner/repo`. The Rust backend fetches the latest release via the GitHub API, finds the first `.zip` asset, downloads and extracts it to `~/.config/flurer/plugins/<id>/`.
2. **ZIP file** — pick a `.zip` file from disk. The Rust backend extracts it to `~/.config/flurer/plugins/<id>/`.

The ZIP must contain a `plugin.json` manifest and the plugin entry file (typically `index.js`). Nesting is handled automatically — GitHub's `owner-repo-1.0.0/` wrapping is stripped.

---

## Removed Files (v0.4.20)

| File | Reason |
|------|--------|
| `src/plugins/graph/` | Moved to standalone repo |
| `public/plugins/graph/` | Bundle built in plugin repo now |
| `src/components/GraphView.tsx` | Part of standalone plugin |
| `src/lib/graphTree.ts` | Only used by GraphView |
| `vite.plugin.config.ts` | Only built the graph plugin |

---

## Build Commands

```bash
# Build the main app
bun run build

# Build the graph plugin (in ../flurer-plugin-graph/)
cd ../flurer-plugin-graph && npm run build
```

---

## Summary of Code Changes

### Rust Backend
*   **`src-tauri/Cargo.toml`**: Added `zip = "2"` crate, moved `tempfile` to main deps.
*   **`src-tauri/src/plugins/mod.rs`**: Replaced `install_plugin` (single-file HTTP download) with `install_plugin_from_github` (GitHub API + ZIP extraction) and `install_plugin_from_zip` (local ZIP extraction). Added helpers: `parse_github_url`, `extract_plugin_zip`, `copy_dir`.
*   **`src-tauri/src/lib.rs`**: Registered the two new commands, removed old `install_plugin`.

### Frontend
*   **`src/lib/plugins.ts`**: Removed `MarketplacePlugin` interface, `MARKETPLACE_PLUGINS` array, and old `installPlugin()`. Added `installPluginFromGithub(repoUrl)` and `installPluginFromZip(filePath)`.
*   **`src/components/PluginMarketplace.tsx`**: Rewritten — replaced marketplace catalog cards with "Install from GitHub" text input, "Install from ZIP" file picker, and "Installed Plugins" list with enable/disable/uninstall controls.
*   **`src/App.tsx`**: No changes (graph focus-path logic still works via generic plugin props).
