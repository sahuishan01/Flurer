---
name: flurer-conventions
description: Conventions for building Flurer, a Tauri (Rust) + SolidJS desktop app being built as a lightweight, fast Windows file manager. Use this whenever adding or modifying a feature in this repo — new Tauri commands, filesystem operations, app state/settings, or SolidJS UI work — since Flurer's whole architecture is optimized around staying small and fast rather than following generic Electron/React-style patterns. Trigger this for requests like "add a command to list/move/delete files", "show file metadata in the UI", "persist a setting", "wire up the frontend to call Rust", or any file-manager feature (browsing directories, file operations, watching for changes), even if the user doesn't mention Tauri or Solid by name.
---

# Flurer conventions

Flurer looks like a wallpaper-fetcher right now (`greet`, `get_wallpaper` in [App.tsx](../../../src/App.tsx)) but that's leftover template code, not the product. The actual goal is a **Windows file manager that is extremely small and efficient** — that's why it's built on Tauri (native OS webview, no bundled Chromium) instead of Electron. Every decision in this codebase should be weighed against that goal: does this keep the binary small, memory low, and the UI fast even with large directories?

That has one concrete architectural consequence: **Rust does the work, Solid does the rendering.** Filesystem traversal, metadata reads, sorting, filtering, and file operations belong in `src-tauri/src/`, called through Tauri commands. The SolidJS frontend should stay a thin, reactive display layer — it should not walk directory trees, parse large JSON blobs it didn't need, or hold more state than the current view needs. If a task can be pushed to Rust, push it there.

## Adding a new feature end-to-end

New features follow a fixed round trip through four files. This is already the shape of the existing `get_wallpaper` example, so treat it as the template even though wallpapers themselves are not the point:

1. **Rust command** — add a `#[tauri::command]` function, typically in `src-tauri/src/network/mod.rs` (I/O and external calls) or a new module under `src-tauri/src/` if it's a distinct domain (e.g. a `fs/` module for file-manager operations). Return `Result<T, String>`, mapping errors with `.map_err(|e| e.to_string())` — see [references/rust-backend.md](references/rust-backend.md) for the full error-handling and state-access convention.
2. **Register it** — add the function to the `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs`.
3. **Grant only the permission it needs** — update `src-tauri/capabilities/default.json`. For file-manager work this usually means adding scoped `fs` plugin permissions (specific allowed directories), not a blanket allow — narrow permissions are both a security property and part of staying lightweight (less surface for Tauri to manage). See [references/rust-backend.md](references/rust-backend.md#permissions--capabilities).
4. **Wire the frontend** — mirror the Rust struct as a TS type, call it with `invoke<T>("command_name", { args })` inside a `try/catch`, and store the result/error in signals. See [references/solidjs-frontend.md](references/solidjs-frontend.md) for how to do this without re-rendering large file lists on every change.

## State and settings

Flurer already has a pattern for anything that needs to persist or be shared across commands — don't invent a new one:

- **`Config`** (`src-tauri/src/configs/mod.rs`) — process-lifetime settings loaded once from the environment (`.env` via `dotenv`), e.g. API keys. Load it once in `run()` and hand it to `AppState`.
- **`AppState`** (`src-tauri/src/state/mod.rs`) — the single `app.manage(...)` struct. Mutable fields go in `Mutex<T>` (see `settings: Mutex<Settings>`); read-only fields like `Config` don't need one.
- **`Settings`** persistence (`src-tauri/src/helpers/settings.rs`) — user-editable, disk-persisted state (e.g. last-opened folder, pane layout, sort order). Written atomically: serialize, write to a `.tmp` sibling, then `fs::rename` over the real path. Reuse `load_settings`/`save_settings` rather than rolling your own file I/O — this avoids half-written settings files if the app is killed mid-write, which matters more for a file manager than most apps since it may be running constantly.

Add new fields to `Settings` rather than creating parallel state files, unless the data is large or high-churn (e.g. a file-list cache), in which case keep it in memory in `AppState` instead of on disk.

## SolidJS frontend

A file manager renders lists that can get long (thousands of entries), so the usual "just re-render everything" habit from small demo apps gets expensive fast. Read [references/solidjs-frontend.md](references/solidjs-frontend.md) before writing list-heavy UI — the short version:

- Use Solid's `<For>` (keyed) for any list of files/folders, never `.map()` in JSX — `.map()` throws away Solid's fine-grained diffing and re-renders every row on any change.
- Keep derived values (filtered/sorted views) in `createMemo`, not recomputed inline on every render.
- Prefer asking Rust for already-filtered/sorted/paginated data over fetching everything and slicing it in JS — Rust can do it faster and without holding the whole tree in the JS heap.
- Split `App.tsx` into components as features grow; don't let one file accumulate every feature's signals (it's fine as-is for the current template size, but new file-manager views should get their own component files under `src/`).

## View separation and readable surfaces

Flurer's window is transparent (`"transparent": true` in `tauri.conf.json`) and the background behind the UI is entirely user-configurable (none/gradient/solid/Unsplash, at variable opacity, in [App.tsx](../../../src/App.tsx)). Two rules follow from that:

- **A view only owns the controls relevant to it.** The address/path bar and its "go" button are an Explorer-only concept — they live in `src/components/ExplorerView.tsx`, not in a shared app-wide toolbar. `SettingsPanel.tsx` has its own header with its own close control. Don't hoist a feature's UI into a common shell just because two views happen to render side by side in `App.tsx` — if a control only makes sense in one view, that view's component owns it, full stop. When adding a new top-level view, ask "does this control belong to this view specifically, or to the app shell?" before deciding where it lives.
- **Any text-bearing surface needs a tinted, blurred backing — never render text directly on the raw background layer.** Because the background can be an arbitrary photo or a user-chosen color, plain text with no backing can lose contrast unpredictably (light text over a light photo region, etc.). Every chrome/content surface (`.toolbar`, `.file-list`, `.settings-panel-header`, `.settings-nav`, `.settings-section`) uses the `--surface-bg` CSS variable (a translucent theme-aware fill) plus `backdrop-filter: blur(12px)` in [App.css](../../../src/App.css). New UI surfaces that hold text should follow the same pattern rather than sitting bare on `.wallpaper-bg`. This is deliberately still translucent, not fully opaque — the user should still be able to see and live-preview the background/theme they picked while looking at that surface (see "State and settings" above for why the underlying background must stay visible during editing).

## When something doesn't fit this pattern

If a feature genuinely doesn't fit the command/state pattern above (e.g. it needs a long-lived background task, a file watcher, or streaming updates rather than request/response), say so explicitly and propose the deviation rather than forcing it through `invoke()` — Tauri supports events (`emit`/`listen`) for that case, which is the right tool for e.g. live directory-change notifications.

## Release & Version Bump Workflow

Any functional update, feature addition, or bug fix pushed to the `main` branch **must** be accompanied by a version bump (e.g., patch increment) in order to trigger a new release build. When performing a version bump or initiating a new release, follow this sequence:

1. **Verify Frontend Build**: Always run a build check to verify that the frontend compiles cleanly:
   ```bash
   bun run build
   ```
   *If the build fails, first fix the build issue. Do not update version numbers or tag until the build compiles successfully.*
2. **Update Version Numbers**: Update/increment the version number **after** a successful build check has run. The version number must be updated synchronously across four files:
   * `package.json` (`"version": "X.Y.Z"`)
   * `src-tauri/Cargo.toml` (`version = "X.Y.Z"`)
   * `src-tauri/Cargo.lock` (`version = "X.Y.Z"` under the `[[package]]` named `flurer`)
   * `src-tauri/tauri.conf.json` (`"version": "X.Y.Z"`)
3. **Commit & Push Branch**:
   * Stage all version change files:
     ```bash
     git add package.json src-tauri/Cargo.lock src-tauri/Cargo.toml src-tauri/tauri.conf.json
     ```
   * Commit with a message like: `bump version to X.Y.Z`.
   * Push the commit to the remote repository:
     ```bash
     git push origin main
     ```
4. **Tag & Push Release**:
   * Tag the commit (e.g., `v0.4.5`):
     ```bash
     git tag vX.Y.Z
     git push origin vX.Y.Z
     ```
5. **Notify & Monitor**:
   * Push an `agent-releases` notification containing the changelog and release link to the user's `ntfy` server immediately after pushing the tag to track the build.
6. **Verify GitHub Action Run**:
   * Monitor the triggered GitHub Action run until completion to ensure it compiles, packages, and releases correctly.
   * Query the GitHub REST API for runs (e.g., using `curl -s https://api.github.com/repos/sahuishan01/Flurer/actions/runs`):
     * Check the status of the run corresponding to the tag (e.g., `status` should transition from `in_progress` to `completed`).
     * Verify that `conclusion` is `success`.
   * Do not mark the version bump/release task as done until the build has run to completion successfully.
