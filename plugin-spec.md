# Flurer plugin spec

This is the contract a plugin needs to follow to install into Flurer and
use its full extension surface — manifest shape, build/runtime
requirements, the `PluginInfo` API, and the settings conventions Core
provides (including per-plugin appearance). It's written for third-party
plugin authors; `AGENTS.md`'s "Plugin" section is a forward-looking TODO
list for Flurer's own plugin *infrastructure* and isn't a substitute for
this.

Flurer doesn't vendor plugin source anymore — `flurer-plugin-git` and
`flurer-plugin-graph` are the reference implementations, each in their own
repo, installed at runtime the same way any third-party plugin would be.

## 1. Distribution

A plugin is installed from a **GitHub release**, not from source:

- `install_plugin_from_github(repoUrl)` fetches the repo's **latest**
  release, requires exactly one `.zip` asset attached to it (any other
  format, or no zip at all, fails the install), downloads and extracts it.
- The zip's contents are extracted directly into the plugin's install
  directory — whatever paths are inside the zip become the plugin's
  on-disk layout, so keep it flat: `plugin.json` and the built bundle
  (typically `index.js`) at the zip root, not nested in a subfolder.
- `update_plugin(repoUrl)` re-runs the same flow against the latest
  release and hot-swaps the running plugin (unregister old, load new).
- `check_plugin_updates` compares each installed plugin's `plugin.json`
  version against the latest release tag to show an "Update available"
  badge in the marketplace — no separate registry involved.

`flurer-plugin-git`'s own `.github/workflows/release.yml` (build zip on
tag push) is the reference CI setup for this.

## 2. `plugin.json` manifest

Required at the root of the release zip:

```json
{
  "id": "git",
  "name": "Git Operations",
  "description": "Short, single-line description shown in the marketplace.",
  "version": "0.15.0",
  "author": "Your name/org",
  "entry": "index.js",
  "repo": "yourname/your-plugin-repo"
}
```

| Field | Notes |
|---|---|
| `id` | Stable, unique, lowercase. Used as the settings key (`pluginSettings[id]`), the `mainView` route, and the plugin's `.view-pane` identity — don't rename it across versions. |
| `entry` | Relative path (from the zip root) to the built bundle `load_plugin_code` will serve. |
| `repo` | `owner/repo` — required for `update_plugin`/`check_plugin_updates` to find the release to compare against. |

`version` here is what's compared for updates — bump it every release, same
as `flurer-plugin-git`'s own `scripts/sync-version.cjs` keeps `package.json`
and `plugin.json` in lockstep.

## 3. Build target: IIFE, not a module

Flurer loads a plugin by fetching its `entry` file's source and running it
via `new Function(code)` in the webview's global scope — there is no
module loader, import map, or bundler involved at load time. Your build
must produce a single **IIFE** bundle, with framework/runtime dependencies
**externalized** to globals Flurer already exposes on `window` rather than
bundled in:

| Package | Global |
|---|---|
| `solid-js` | `window.Solid` |
| `solid-js/web` | `window.SolidWeb` |
| `solid-js/store` | `window.SolidStore` |
| `@tauri-apps/api/core` | `window.TauriCore` |
| `@tauri-apps/api/event` | `window.TauriEvent` |
| `@tauri-apps/plugin-shell` | `window.TauriShell` |

Bundling your own copy of `solid-js` instead of using `window.Solid`
breaks reactivity across the Flurer/plugin boundary (two separate Solid
runtimes, two separate reactive graphs) — always externalize, never vendor
these.

At the end of your bundle's execution, call the global `registerPlugin`
with your `PluginInfo` object (`window.registerPlugin(plugin)` — this is
how `new Function(code)` hands control back to Flurer).

## 4. The `PluginInfo` contract

```ts
interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;

  // Skip Core's generic appearance slider (§6) because this plugin's own
  // settingsPanel already exposes surfaceOpacity/surfaceBlur controls.
  hasCustomAppearanceSettings?: boolean;

  // Icon button in Flurer's view-rail; onClick should switch mainView to this plugin's id.
  viewRailButton?: (props: { active: boolean; onClick: () => void }) => JSX.Element;

  // Optional sidebar contribution (only relevant if you don't use fullPanel).
  sidebar?: (props: { currentPath: string; onSelectPath: (path: string) => void }) => JSX.Element;

  // Rendered alongside Flurer's own sidebar. Use this OR fullPanel, not both.
  mainPanel?: (props: MainPanelProps) => JSX.Element;

  // Rendered instead of Flurer's sidebar+content (full width) — for plugins
  // that are their own self-contained app (git, graph). Takes priority over
  // mainPanel if both are set.
  fullPanel?: (props: MainPanelProps) => JSX.Element;

  // A tab in Flurer's own Settings page, under your plugin's name.
  settingsPanel?: (props: {
    dataBgLightness: string;
    pluginSettings: any;
    onPluginSettingsChange: (patch: any) => void;
  }) => JSX.Element;
}
```

`MainPanelProps` (shared by `mainPanel`/`fullPanel`):

```ts
{
  currentPath: string;
  navigateTo: (path: string) => void;
  searchQuery: string;
  focusPath: any;
  active: boolean;            // true only while your view is the current mainView
  dataBgLightness: string;    // "light" | "dark" — for choosing readable text/icon color
  settingsLoaded: boolean;    // false during initial settings load — avoid rendering before this
  baseSurfaceOpacity: number; // Flurer's own current shell opacity (settings.uiTintOpacity)
  baseSurfaceBlur: number;    // Flurer's own current shell blur, px (settings.uiBlurPx)
  pluginSettings: any;        // settings.pluginSettings[your id], persisted, {} until first write
  onPluginSettingsChange: (patch: any) => void; // shallow-merges patch into pluginSettings[your id]
}
```

`pluginSettings` is a free-form bag scoped entirely to your plugin's `id` —
Core never reads or validates its contents except for the two reserved
keys in §6. Use it for anything you want to persist (open tabs, last repo
path, per-plugin UI prefs) via `onPluginSettingsChange`.

## 5. Getting your plugin's own translucency right

Flurer mounts your `mainPanel`/`fullPanel` inside its own `.view-pane`
wrapper `<div>`, one per registered plugin. That wrapper already carries a
translucent fallback background/blur (see §6) scoped to *your* plugin
instance only — other plugins' opacity never leaks into yours and vice
versa. Two ways to build on that, and don't mix them:

- **Do nothing.** Your panel's own DOM inherits the wrapper's background —
  fine for panels that don't need higher contrast than Flurer's shell
  default.
- **Paint your own root** with a higher/independent opacity for
  dense UI (diff trees, data tables, graphs commonly need more contrast
  than the 0.35 shell default). Read `pluginSettings.surfaceOpacity`/
  `.surfaceBlur` if set, otherwise fall back to `baseSurfaceOpacity`/
  `baseSurfaceBlur` — same reserved keys Core's own generic slider writes
  (§6), so your panel responds correctly whether the user set the value
  through your UI or Core's:

  ```ts
  const opacity = () => Math.max(0.4, pluginSettings.surfaceOpacity ?? baseSurfaceOpacity);
  const bg = () => `rgba(var(--panel-rgb), ${opacity()})`;
  ```

  Use the existing theme tokens (`--panel-rgb`, `--panel-tint-rgb`,
  `--border-color`, `--text-primary`, `--accent`, `--surface-blur`) rather
  than hardcoded colors — they already resolve correctly in both Flurer's
  light and dark themes, and stay in sync if the user changes theme.

If you paint your own root, set `hasCustomAppearanceSettings: true` only
once your `settingsPanel` actually gives the user a way to adjust
`surfaceOpacity`/`surfaceBlur` themselves — otherwise leave it unset so
Core's generic slider (§6) still works for your users.

## 6. Reserved `pluginSettings` keys

Two keys under `pluginSettings[your id]` are reserved by Core for the
per-plugin appearance system (see
`docs/superpowers/specs/2026-08-19-per-plugin-translucency-design.md`):

- `surfaceOpacity?: number` (0–1)
- `surfaceBlur?: number` (px)

Both optional; absent means "inherit Flurer's base opacity/blur." Core
applies whatever value is set as `--plugin-surface-opacity`/
`--plugin-surface-blur` inline on your `.view-pane` wrapper (scoped to
your instance, see §5), and — unless you set `hasCustomAppearanceSettings`
— renders a slider pair for these two keys in Settings → Plugins so users
get a working control even if you never build your own.

## 7. Disabling / uninstalling

`disabledPlugins` (a plain array of ids in Flurer's own settings) is
checked before a plugin is loaded at startup (`loadInstalledPlugins`) — a
disabled plugin's code never runs, so don't rely on any setup/cleanup
lifecycle hook firing around a disable toggle; there isn't one.
`uninstallPlugin(id)` removes the on-disk install and unregisters it from
the running app.
