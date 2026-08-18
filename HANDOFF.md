# Flurer — Handoff

Current version: **0.4.63** (tagged, pushed, CI green).

## What Flurer is

Windows file manager. Tauri v2 (Rust) backend + SolidJS frontend. Goal is small
binary / low memory / fast on large directories — see
`.claude/skills/flurer-conventions/SKILL.md` for the architecture rules
(Rust does the work, Solid only renders; commands go through
`#[tauri::command]`; state lives in `AppState`/`Settings`).

## Dev-box constraint (read this before "fixing" a build failure)

This Linux ARM box **cannot** `cargo check`/`cargo build` the real crate —
system glib is 2.68.4, Tauri needs >= 2.70. This is environmental, not a bug.

Workaround used throughout: isolated scratch crates under
`/tmp/claude-*/.../scratchpad/` with matching deps (no tauri) — extract the
real function body verbatim (Python string slicing out of the actual source
file, not retyped) into the scratch crate and run `cargo test`/`cargo run`
against it. Also run `rustfmt --edition 2021 --emit stdout <file> > /dev/null`
on the real file as a fast syntax check (doesn't catch type errors, catches
typos/braces). GitHub Actions' Windows build is the real compile gate —
`cargo test` does NOT run in CI, so scratch-crate tests only prove the logic
locally, not that it compiles for real.

## Release ritual (follow exactly, every time)

1. Implement the fix.
2. `npx tsc --noEmit -p .` clean.
3. `npm run build` (or `bun run build`) clean.
4. Scratch-crate verification for any touched Rust logic + `rustfmt` parse check.
5. `git add` the specific changed files (not `-A`).
6. Commit with a real description of the fix.
7. Bump version in **four** files, kept in sync:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock` (the `flurer` package block — regex, don't hand-edit lockfile hashes)
   - `src-tauri/tauri.conf.json`
8. Commit "bump version to X.Y.Z".
9. `git push origin main`.
10. `git tag vX.Y.Z && git push origin vX.Y.Z`.
11. `ScheduleWakeup(~600s)` to check CI (Windows build takes ~10 min).
12. On success, ntfy POST to `agent-releases` per `~/.claude/CLAUDE.md` (Bearer
    token + title `Flurer vX.Y.Z Released (<hostname>)`, bulleted body). Only
    ever notify `agent-releases` on a *verified* successful build — never on
    start, never on failure (report failures in chat instead, via check-run
    annotations, since job logs 403 without admin rights):
    ```
    curl .../repos/sahuishan01/Flurer/commits/<sha>/check-runs
    curl .../repos/sahuishan01/Flurer/check-runs/<id>/annotations
    ```

## Recent work (v0.4.61 → v0.4.63)

- **v0.4.61 — folder-size cache stopped surviving drive switches.** Split the
  size cache into `roots` (persisted, user-visited, cap 10k) and `subdirs`
  (memory-only walk byproducts, cap 50k) in `src-tauri/src/sizecache/mod.rs`,
  moved persistence to its own `size_cache_v2.json`, added `flush()` on app
  exit (wired in `src-tauri/src/lib.rs`), fixed folder-watch to watch the
  *parent* dir instead of one watch per row. Frontend (`FileList.tsx`) no
  longer prunes `folderSizes` down to just the currently-listed folder.
  - Self-caught bug: raising the cache caps + evicting one-at-a-time at the
    limit made a 55k-entry test take 31s — fixed by batching eviction down to
    a `max * 9/10` low-water mark (0.20s after).

- **v0.4.62 — one unreadable entry (e.g. under `C:\Program Files`) failed the
  whole directory listing.** `list_directory` now returns `DirListing { entries,
  unreadable }` and skips per-entry failures instead of bailing the whole
  `read_dir` loop (`src-tauri/src/fs/mod.rs`). Added `describe_dir_error()` for
  human-readable io error messages. Frontend shows an inline notice when
  `unreadable > 0` (`FileList.tsx`, `.file-list-notice` in `App.css`, using the
  existing `--text-secondary` token — don't reach for `--text-muted`, it
  doesn't exist in this codebase).
  - I initially misdiagnosed the root cause as `entry.metadata()` failing on a
    broken symlink; wrote a test, it disproved that. What shipped is
    defensive hardening (tolerate any per-entry read failure), not a confirmed
    root-cause fix. If Access Denied reports resurface, ask whether it happened
    viewing the folder directly or after clicking into a child (e.g.
    WindowsApps) — that's the open diagnostic thread.

- **v0.4.63 — Recalculate only worked on the first folder clicked, and most
  didn't show a progress row.** Root cause was two compounding bugs in
  `src-tauri/src/sizecache/mod.rs`:
  1. `pending` was a `HashSet<PathBuf>` — any path already pending (silently
     being walked) made `enqueue_job` a no-op, so an explicit Recalculate on it
     did *nothing visible*. Changed `pending` to
     `HashMap<PathBuf, Option<TrackedJob>>` so a later Recalculate can *adopt*
     an in-flight silent walk (populate the tracking slot) instead of being
     dropped.
  2. The revalidation check treated an unreadable mtime (`0`) as "changed",
     so any folder whose mtime read failed got silently re-walked on *every*
     `get_folder_size` call, forever — filling `pending` and starving real
     clicks. Extracted as `needs_revalidation(current, cached)`, now requires
     `current_mtime > 0` before treating it as stale.
  - Verified via scratch crate replaying: N distinct Recalculates all get
    progress rows and complete; Recalculate on an already-walking folder gets
    adopted (visible, no duplicate walk); duplicate clicks don't strand
    tracking; channel-full backs `pending` out cleanly.

## Answered but not yet asked-about again

- **Does a whole-drive Recalculate cause subfolder re-walks on navigation?**
  No — the recursive walk populates `subdirs` for every nested dir via
  `record_subdir`, so navigating in afterward is a cache hit
  (`lookup_cached()`) that promotes the entry into `roots`. Caveat: the
  `subdirs` tier caps at 50,000 entries with LRU eviction, so on a very large
  drive, folders scanned early in the walk can age out and get recomputed
  once. Also: directory mtime doesn't move when something nested *deeper*
  changes — the file watcher catches that live, but a change made while
  Flurer was closed needs a manual Recalculate to be noticed.

## Known follow-ups (not yet done, not yet asked for)

- `MAX_PENDING_JOBS` is 20 in `sizecache/mod.rs`. Selecting/recalculating more
  than ~20 folders at once silently drops the overflow (backs out cleanly, no
  crash, but no user feedback either). Worth raising the cap or surfacing a
  "N more queued" indicator if bulk recalculation becomes a real workflow.
- `--text-secondary` is defined twice: as a font-size in `App.css:23`
  (`--text-secondary: 0.875em;`) and as a color in `theme.css` (multiple
  `!important` overrides). Currently harmless because the color definition
  wins, but it's a latent naming collision worth renaming one of them out of.

## Working tree at handoff time

`git status` shows uncommitted changes to `src/App.css`,
`src/components/ContextMenu.tsx`, `src/components/PluginMarketplace.tsx` —
these predate this session's work and were not touched or reviewed here.
Check what they are before committing/discarding.
