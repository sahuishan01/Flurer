# Per-plugin surface translucency — design

## 1. Problem

`flurer-plugin-git`'s `flurer-update.md` (in `~/projects/flurer-plugin-git`) asked for
plugins to render with their own glass/translucency (independent, typically
higher opacity than Flurer's own shell — dense tabular/diff UIs need more
contrast than the 0.35 default). Its proposed Core mechanism was a single
CSS custom property (`--plugin-surface-opacity`) written to
`document.documentElement`. That doesn't generalize: multiple plugins are
mounted simultaneously in the same document, so the last plugin to write
that global var would clobber every other plugin's value. This design
replaces that mechanism with one that gives each plugin an independently
addressable opacity/blur, and adds the Core plumbing needed for any plugin
(not just the git plugin) to use it.

Two related pieces of the original doc are intentionally **not** covered
here:
- Native Windows Mica/Acrylic vibrancy (`backgroundType: "none"`) — a
  window-level concern, not per-plugin; tracked as a separate follow-up.
- The actual `flurer-plugin-git`/`flurer-plugin-graph` source changes
  (reading the new props, rgba-izing their own styles) — those plugins
  live in their own repos now (see the `plugins/git`/`plugins/graph`
  purge), so their side of this is out of scope for the Flurer repo.

## 2. Mechanism: container-scoped CSS custom properties

Each registered plugin with a `mainPanel`/`fullPanel` already gets its own
`.view-pane` wrapper `<div>`, one per plugin, in `App.tsx`'s
`<For each={registeredPlugins()}>` loop. Setting `--plugin-surface-opacity`
and `--plugin-surface-blur` as **inline styles on that specific div**
(rather than on `document.documentElement`) scopes them to that plugin's
own DOM subtree — inline custom properties cascade down, not sideways, so
two plugins using the same variable *name* never see each other's value.
No registry, no cross-plugin bookkeeping required.

```
Explorer's own .view-pane   → no --plugin-surface-* set → inherits base --surface-opacity
git plugin's .view-pane     → --plugin-surface-opacity: 0.75 (its own pluginSettings)
graph plugin's .view-pane   → --plugin-surface-opacity: 0.5  (its own pluginSettings, or base)
```

## 3. Data model

No new settings shape needed — `settings.pluginSettings: Record<string, any>`
(`src/lib/settings.ts`) is already keyed per `plugin.id` and already flows
through `updatePluginSettings`/`onPluginSettingsChange`
(`App.tsx:367-369`, already passed into plugin props at `App.tsx:1028-1029`).

Convention (documented in `plugin-spec.md`, not enforced by types beyond
this doc): `pluginSettings[id].surfaceOpacity?: number` (0–1),
`pluginSettings[id].surfaceBlur?: number` (px). Both optional; absent means
"inherit Flurer's base opacity/blur." One field, two possible writers (see
§5), so there's never dual state to reconcile for the same plugin.

## 4. Core changes

### `src/lib/plugins.ts`
- `mainPanel`/`fullPanel` prop types gain `baseSurfaceOpacity: number` and
  `baseSurfaceBlur: number` — the raw current shell values (`uiTintOpacity`,
  `uiBlurPx`), for plugins that want to do their own derived math (e.g. "my
  minimum readable opacity is `max(0.4, base)`") rather than only using the
  CSS var fallback.
- `PluginInfo` gains optional `hasCustomAppearanceSettings?: boolean`. When
  true, Core's generic Settings-page opacity/blur slider (§5) is not
  rendered for that plugin — the plugin's own `settingsPanel` owns the
  control instead. Absent/false means Core renders the generic control.

### `src/App.tsx` (~1015–1030, the `<For each={registeredPlugins()}>` block)
- Compute per-plugin effective values:
  ```ts
  const effOpacity = () => settings.pluginSettings?.[plugin.id]?.surfaceOpacity ?? settings.uiTintOpacity;
  const effBlur = () => settings.pluginSettings?.[plugin.id]?.surfaceBlur ?? settings.uiBlurPx;
  ```
- Set them as inline custom properties on that plugin's `.view-pane` div
  alongside the existing `display` style.
- Add `baseSurfaceOpacity: settings.uiTintOpacity, baseSurfaceBlur: settings.uiBlurPx`
  to the existing per-plugin `props` object.

### `src/App.css` (`.view-pane`, ~468)
- Add a translucent fallback so a plugin that paints no background of its
  own still reads as part of the shell instead of a transparent hole:
  ```css
  .view-pane {
      ...
      background-color: rgba(var(--panel-rgb), var(--plugin-surface-opacity, var(--surface-opacity)));
      backdrop-filter: blur(var(--plugin-surface-blur, var(--surface-blur, 0)));
      -webkit-backdrop-filter: blur(var(--plugin-surface-blur, var(--surface-blur, 0)));
  }
  ```
  Non-plugin `.view-pane` usages (Explorer, Trash) never set the
  `--plugin-surface-*` vars, so they transparently fall through to the
  existing global `--surface-opacity`/`--surface-blur` — unchanged
  behavior for them. A plugin that paints its own opaque-enough root
  simply occludes this fallback; it's not a conflict.

### Settings page — generic per-plugin appearance control
- Wherever the plugin list is already rendered under `mainView() === "settings"`:
  for each registered plugin where `!plugin.hasCustomAppearanceSettings`,
  render an opacity slider (0.1–1.0) and blur slider (0–32px) pair, mirroring
  the existing global `uiTintOpacity`/`uiBlurPx` controls, writing via the
  existing `updatePluginSettings(plugin.id, { surfaceOpacity, surfaceBlur })`.
  Include a "Reset to default" action that clears both keys (falls back to
  base again, matching the `??` fallback everywhere else in this design).

## 5. `plugin-spec.md`

A new root-level doc (matching the existing convention of `AGENTS.md`,
`build.md`, `DESIGN.md`, `HANDOFF.md` living at repo root) documenting the
full `PluginInfo` contract for third-party plugin authors — not just this
translucency feature, but everything a plugin needs to integrate with
Flurer to its full potential (`mainPanel`/`fullPanel`/`sidebar`/
`viewRailButton`/`settingsPanel`, `pluginSettings` conventions including
`surfaceOpacity`/`surfaceBlur` and `hasCustomAppearanceSettings`,
`plugin.json` manifest shape, the IIFE build/externals convention plugins
must follow per `flurer-plugin-git`'s own `AGENTS.md`, and how
`install_plugin_from_github`/`update_plugin` expect a release to be
shaped). No existing file with this scope was found in the repo (checked
root `*.md` and `docs/`) — `AGENTS.md`'s plugin section is a forward-looking
TODO list for Flurer's own plugin *infrastructure*, not an authoring guide
for plugin *authors*, so this is a new file, not a rename/edit of an
existing one.

## 6. Testing

This dev environment is Linux; opacity/blur rendering can't be visually
verified here. Verification is: `bun run build` succeeds, TypeScript types
check, and a manual read-through confirming the CSS var scoping is
per-element (not global) as designed. Actual visual confirmation (does a
0.75 git-plugin panel look right against a 0.35 shell) needs the Windows
build, same constraint as the drag-out fix earlier in this session.
