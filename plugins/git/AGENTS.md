# flurer-plugin-git

A **Git Operations** plugin for [Flurer](https://github.com/sahuishan01/Flurer), the Tauri + SolidJS Windows file manager. Provides full git panel with changes, graph, branches, history, diff, stash, and worktrees views — all executed directly via `git` CLI.

---

## 1. Project Structure

```
flurer-plugin-git/
├── .github/workflows/release.yml   # CI: builds & releases .zip on tag push
├── src/
│   ├── index.tsx                    # Plugin entry → GitPanel (tab manager)
│   ├── context.tsx                  # GitProvider — state + git command wrappers
│   ├── git.ts                       # Git CLI invocations via Tauri shell plugin
│   ├── utils.ts                     # localStorage recent repos, formatting utils
│   ├── styles.ts                    # Inline style tokens (S object)
│   ├── types.ts                     # TypeScript interfaces
│   ├── env.d.ts                     # Ambient declarations for Tauri globals
│   └── components/
│       ├── DashboardView.tsx        # Recent repos + open-by-path input
│       ├── RepoView.tsx             # Repo toolbar + sub-view tabs
│       ├── ChangesView.tsx          # Stage/unstage files
│       ├── GraphView.tsx            # Git commit graph
│       ├── BranchesView.tsx         # Branch list + checkout/merge/delete
│       ├── HistoryView.tsx          # Commit log with search
│       ├── DiffView.tsx             # File diff viewer
│       ├── StashView.tsx            # Stash create/pop/drop
│       ├── WorktreesView.tsx        # Worktree add/remove
│       └── shared/index.tsx         # Icons, Button, TabBar, Toast, Card, etc.
├── dist/index.js                    # Built IIFE bundle (gitignored)
├── plugin.json                      # Plugin manifest (required by Flurer)
├── package.json
├── vite.config.ts                   # IIFE build, externals for shared deps
└── tsconfig.json
```

---

## 2. Build

```bash
bun install
bun run build
# Output: dist/index.js (IIFE bundle, ~61 KB)
```

### How the build works

The Vite config builds the plugin as an **IIFE** (Immediately Invoked Function Expression) — not as a module. This is critical because Flurer loads plugin code via `new Function(code)` and executes it in the webview's global scope.

External dependencies (`solid-js`, `@tauri-apps/api/core`, etc.) are **not bundled** — they are provided by Flurer at runtime as globals (`window.Solid`, `window.TauriCore`, etc.). The Vite config maps them:

| Package | Global |
|---------|--------|
| `solid-js` | `window.Solid` |
| `solid-js/web` | `window.SolidWeb` |
| `solid-js/store` | `window.SolidStore` |
| `@tauri-apps/api/core` | `window.TauriCore` |
| `@tauri-apps/api/event` | `window.TauriEvent` |
| `@tauri-apps/plugin-shell` | `window.TauriShell` |

---

## 3. Release Process

Triggered by pushing a `v*` tag. The CI workflow:

1. Checks out the repo
2. Installs deps with `bun install`
3. Runs `bun run build` → produces `dist/index.js`
4. Bundles `dist/index.js`, `plugin.json`, and `package.json` into a `.zip` archive
5. Creates a GitHub Release with the `.zip` attached

### To publish a new release

```bash
# Update version in package.json and plugin.json, then:
git tag -a v0.1.2 -m "flurer-plugin-git v0.1.2"
git push origin v0.1.2
```

The CI creates the release. No manual steps needed.

### .zip contents

```
flurer-plugin-git.zip
├── index.js       # Built IIFE bundle
├── plugin.json    # Plugin manifest
└── package.json   # Version metadata
```

The `.zip` is the installation artifact — Flurer's plugin marketplace downloads it from the release assets.

---

## 4. Integration with Flurer

### Plugin Manifest (`plugin.json`)

Required fields for Flurer's plugin system:

```json
{
  "id": "git",
  "name": "Git Operations",
  "description": "Full-featured git panel...",
  "version": "0.1.1",
  "author": "Algosculptor",
  "entry": "index.js",
  "repo": "sahuishan01/flurer-plugin-git"
}
```

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier. Matches the subdirectory name in Flurer's plugins dir. |
| `entry` | Entry point file (relative to plugin directory). Always `index.js`. |
| `repo` | GitHub repo slug for update checks. Optional but **required for auto-updates**. |

### Runtime Discovery

Flurer's Rust backend (`src-tauri/src/plugins/mod.rs`) discovers plugins from `~/.config/flurer/plugins/<id>/`. On startup `loadInstalledPlugins()` is called:

1. `list_installed_plugins` — reads every `plugin.json` under the plugins dir
2. `load_plugin_code` — reads `index.js` and returns it as a string
3. Frontend runs `new Function(code)()` which calls `window.registerPlugin(manifest)`
4. Flurer's plugin registry adds the manifest to its reactive list

### What `registerPlugin` expects

```typescript
window.registerPlugin({
  id: string,          // Must match plugin.json id
  name: string,
  description: string,
  version: string,
  author: string,
  viewRailButton: (props: { active: boolean; onClick: () => void }) => JSX.Element,
  fullPanel: (props: FullPanelProps) => JSX.Element,
  mainPanel?: (props: FullPanelProps) => JSX.Element,
  sidebar?: (props: SidebarProps) => JSX.Element,
  settingsPanel?: (props: SettingsPanelProps) => JSX.Element,
});
```

The `FullPanelProps` includes: `currentPath`, `navigateTo`, `searchQuery`, `focusPath`, `active`, `dataBgLightness`, `settingsLoaded`, `pluginSettings`, `onPluginSettingsChange`.

### Source in Flurer repo

The plugin source is mirrored at `plugins/git/` in the Flurer repository. Both the Flurer CI (`build.yml`, `release.yml`) and the plugin's own CI build from the same source. When changes are made, they must be synced to both repos.

---

## 5. Architecture

### Tab Manager (`index.tsx`)

`GitPanel` manages a list of open repo tabs. Each tab has its own `GitProvider` scope with isolated state:

```
GitPanel (tab manager)
├── DashboardView          # Shown when no tabs are open
├── Tab bar                # Repo names with close (✕) and add (+) buttons
└── RepoTabs
    ├── GitProvider        # Signal state for repo 1
    │   └── RepoView       # Toolbar + sub-view tabs
    └── GitProvider        # Signal state for repo 2
        └── RepoView
```

### State Flow (`context.tsx`)

`GitProvider` holds all reactive signals: `status`, `branches`, `commits`, `graph`, `stashes`, `worktrees`, `loading`, `error`, `toast`, `activeView`. The `openRepo(path)` function:

1. Sets `repoPath` signal
2. Resets all data signals (graph, stashes, etc.)
3. Calls `refresh()` which invokes `gitRepoStatus`, `gitLog`, and `gitBranches` in parallel
4. Calls `saveRecentRepo()` to persist to localStorage

### Git CLI invocations (`git.ts`)

All git operations use the Tauri Shell Plugin (`window.TauriShell.execute`) to run `git` commands via `sh -c`. This avoids needing custom Rust commands for every git subcommand. The plugin also has a fallback to `window.TauriCore.invoke` for environments without the shell plugin.

---

## 6. Development Workflow

### Local testing

The plugin is developed alongside Flurer for a full test cycle:

```bash
# 1. Build the plugin
cd plugins/git
bun install && bun run build

# 2. Build & run Flurer (which includes the plugin at plugins/git/dist/index.js)
cd ../..
bun install && bun run tauri dev
```

The plugin can also be tested in isolation by loading its `.zip` into an installed Flurer:

```bash
# 1. Build plugin
cd plugins/git
bun run build

# 2. Zip it
mkdir -p _plugin && cp dist/index.js plugin.json _plugin/ && cd _plugin && zip -r ../flurer-plugin-git.zip .

# 3. Install in Flurer via Settings → Plugins → Install from ZIP
```

### Syncing source between repos

The plugin source lives in two places:

- **Flurer repo** at `plugins/git/` — tracked for monorepo-style CI builds
- **Plugin repo** at `github.com/sahuishan01/flurer-plugin-git` — for independent releases

To sync changes **from** Flurer to the plugin repo:

```bash
cd /tmp
git clone git@github.com:sahuishan01/flurer-plugin-git.git
cd flurer-plugin-git
git archive --format=tar HEAD:plugins/git | tar xf - -C /tmp/flurer-pg-src
# Or manually copy plugins/git/* over
```

To sync changes **to** Flurer from the plugin repo:

```bash
cd ~/projects/Flurer
# Replace plugins/git/ with the standalone repo's source
```

---

## 7. Version Convention

- **package.json** and **plugin.json** versions are kept in sync and match release tags
- The `version` field in `registerPlugin` (inside `src/index.tsx`) is cosmetic — update it alongside the manifest
- Patch bumps for bugfixes, minor bumps for new features (consistent with SemVer)
- The Flurer app version is independent — plugin releases don't require a Flurer release
