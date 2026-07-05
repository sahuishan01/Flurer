# Flurer — handoff

Tauri (Rust) + SolidJS desktop app. Target product: a lightweight, fast **Windows file manager** — not the wallpaper app the code might suggest at a glance. See [.claude/skills/flurer-conventions/SKILL.md](.claude/skills/flurer-conventions/SKILL.md) for the conventions this codebase follows and why (Rust does the work, Solid does thin rendering, everything optimized to stay small/fast).

## What's implemented

- **Explorer view** ([ExplorerView.tsx](src/components/ExplorerView.tsx), [FileList.tsx](src/components/FileList.tsx)): directory browsing, sortable columns, copy/move/delete/rename/create-folder via [fs/ops.rs](src-tauri/src/fs/ops.rs), clipboard (copy/cut), right-click [ContextMenu.tsx](src/components/ContextMenu.tsx), quick-access sidebar (Desktop/Documents/etc).
- **Storage graph view** ([GraphView.tsx](src/components/GraphView.tsx)): a real node-link diagram on an SVG canvas — pan by dragging, zoom with scroll, click any node to expand it. Root nodes are physical disks (via WMI, [disks/mod.rs](src-tauri/src/disks/mod.rs)), expanding into volumes, expanding into a lazily-loaded folder tree (`list_subfolders` in [fs/mod.rs](src-tauri/src/fs/mod.rs)). Layout/tree-model logic lives in [lib/graphTree.ts](src/lib/graphTree.ts), separate from rendering.
- **Settings panel** ([SettingsPanel.tsx](src/components/SettingsPanel.tsx), [CustomizationSettings.tsx](src/components/CustomizationSettings.tsx)): background (none/gradient/solid/Unsplash), Unsplash auto-rotate with a configurable frequency (1 min–1 month, see [lib/unsplash.ts](src/lib/unsplash.ts)), theme (light/dark), panel tint opacity — all persisted through `Settings`/`AppState` ([state/mod.rs](src-tauri/src/state/mod.rs), [helpers/settings.rs](src-tauri/src/helpers/settings.rs)) with atomic (temp+rename) writes.
- Sidebar (left nav) is shared app-shell chrome, lifted out of ExplorerView so it persists across Explorer and Graph views; Settings remains its own full-page view without the sidebar.

## Known gaps / things worth re-verifying on a real Windows machine

- **WMI disk topology** (`get_disk_topology`) can only be exercised in the actual Tauri window — the browser dev-preview has no Tauri bridge, so this has only been verified via `cargo test`/`cargo check` plus manual runs on the user's machine. Already fixed three real runtime failures found that way: `RPC_E_CHANGED_MODE` (COM apartment mismatch — now runs on a dedicated thread), a WMI provider returning an integer instead of a numeric string for disk size, and `WBEM_E_NOT_FOUND` from hand-escaped `ASSOCIATORS OF` queries (replaced with a plain-SELECT join in Rust). Worth another close look if disk/volume data ever looks wrong or incomplete.
- No frontend test suite yet. Rust has `cargo test` coverage for `fs/mod.rs` and `fs/ops.rs` (15 tests) but nothing for `disks/mod.rs` (hard to unit test without a live WMI provider) or the Solid components.
- `get_wallpaper`/Unsplash code is a real feature (background images), not leftover — only the original `greet` demo command has been removed already.

## Conventions

Read [.claude/skills/flurer-conventions/SKILL.md](.claude/skills/flurer-conventions/SKILL.md) before adding features. Short version: new Tauri commands return `Result<T, String>`, get registered in `lib.rs`, get a scoped capability if they touch the fs plugin; new persisted state goes on the existing `Settings` struct (mirrored in Rust and TS by hand, no codegen); Solid list rendering uses `<For>` and `createMemo`, never `.map()` in JSX.
