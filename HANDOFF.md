# Flurer — Handoff: reintroducing the 5 reverted features

**STATUS UPDATE (v0.4.225): the 5-feature reintroduction is long finished;
the most recent work is the Settings redesign (v0.4.225) — see that
section below. The "UX improvements in chunks" project that came before it
is also complete.** See "Post-revert work" below for
everything shipped since v0.4.109. The historical story below is kept
because its lessons (one feature per version, never guess-and-patch, Rust
compiles only in CI) still govern how this repo is worked on.

Historical context (as it stood mid-project, at v0.4.107): features 1, 2,
and 3 of 5 shipped and confirmed. Don't treat any feature as done until
the user confirms it. (v0.4.104 was an unrelated updater fix, not one of
the 5 features — see git log.)

If you're picking this up cold: read this whole file before touching code.
It exists so you don't have to re-read the conversation that produced it.

## The story, honestly

v0.4.97 shipped five features in one commit (live directory watching,
virtualized file list, streamed directory listings, a name-search index,
split view) and the app got stuck on the launch spinner forever — every
launch, on the user's machine. Three attempts to fix it live
(v0.4.98 wrong-diagnosis fix, v0.4.99 plain re-push, v0.4.100 diagnostic
logging + DevTools) all shipped without ever actually being tested by the
user, because each one was reasoned about from the code rather than from
real evidence. **The root cause of that hang was never found.**

At v0.4.101 the whole thing was reverted (via `git revert`, not
force-push — every one of those commits is still in history, nothing was
destroyed) back to a byte-for-byte match of v0.4.96, which is confirmed
working. Verify this claim yourself before trusting anything else here:

```
git diff v0.4.96..v0.4.101 -- . ':(exclude).github/workflows'
```

That must return empty. The only kept difference is a CI fix
(`b7f88e3`) that stops a release commit from triggering two duplicate
builds — it only touches `.github/workflows/*.yml`, never ran on the
machine that hung, and must **not** be reverted or touched while
reintroducing features.

v0.4.102 reintroduced feature 1 (virtualization) alone — confirmed working.
v0.4.103 reintroduced feature 2 (streamed listings) alone — also confirmed
working.

## The rule for the rest of this work

**One feature per version. Bump, commit, push, and tag immediately after
implementing each one — do not wait to be asked, and do not batch two
features into one push.** The user is on a machine that can't run this
GUI (dev box has no Windows/GUI), so a pushed, tagged, CI-built installer
is the only way they can ever verify anything. Not pushing after
implementing is not being cautious, it's just leaving them blocked.

After each push: tell the user what shipped and that you're waiting for
their confirmation before starting the next feature. Do not start the next
feature's implementation until they've confirmed the current one works —
if a hang or crash happens, you want it isolated to one small diff, not
buried in five.

**If something breaks:** do not guess-and-patch again — that's exactly
what produced three wasted releases the first time. Use
`superpowers:systematic-debugging`. Get real evidence (the log file at
`%LOCALAPPDATA%\.flurer\logs`, DevTools console — see the "if it breaks
again" section below) before writing a fix. If 2+ live fix attempts fail,
revert that one feature's commit (same `git revert` pattern used for
v0.4.101) rather than attempting a third.

## Where the original code lives

All five features were originally written in one squashed commit:
**`38c8f08`** — `feat: live watching, virtualized list, streamed
listings, search index, split view`. It's still in history (reverted, not
deleted). Two related commits:

- **`f6310d6`** — fixes a real race in the streamed-listing chunk
  listener (chunks arriving before `listen()` resolves, dropping the
  entire listing forever). Genuinely correct, must be folded into feature
  2 *from the start* this time, not discovered after the fact.
- **`1093683`** — diagnostic-only startup log markers + enabling the
  `devtools` Cargo feature. Not a feature to reintroduce as-is, but its
  *technique* (stage-marker logging around anything new that runs during
  `.setup()`) is exactly what feature 5 needs, deferred-not-removed.

**Do not blind-cherry-pick `38c8f08`.** It touches `FileList.tsx`,
`App.tsx`, `App.css`, `lib/settings.ts`, `state/mod.rs`, and `lib.rs` with
all five features interleaved in the same hunks. Cherry-picking will pull
in code for features you haven't reached yet, un-isolating the very thing
this whole exercise exists to avoid. Instead, for each feature:

```
git show 38c8f08:<path>   # read the old file's full content for reference
```

then hand-apply just that feature's pieces to the *current* file with
Edit, the same way feature 1 was done. Compiling/type-checking after each
feature is what catches you if you missed a piece.

## Feature 1 — virtualized file list (DONE, v0.4.102)

Frontend-only (`FileList.tsx`, `App.css`). No Rust. Cannot affect startup
since `FileList` only mounts after `appReady()` is already true.

Two deliberate deviations from the original `38c8f08` version, both
improvements — keep them if re-deriving from `38c8f08` again for any
reason:

1. The `foldersNeedingSize` memo + its effect were moved to *after* the
   virtualization block (right after `scrollRowIntoView`), not left in
   their original position before `groupedSections`/`indexByPath`. The
   original order forward-referenced `visibleItems()` from a memo defined
   ~300 lines earlier in the file — it happened to work because Solid
   defers a memo's first computation past the synchronous render phase,
   but that's relying on scheduling semantics no one should have to
   reason about. Moving it removes the ambiguity entirely.
2. Zebra striping uses an explicit `.file-row-alt` class derived from each
   row's real index, not `:nth-child(even)` — spacer rows standing in for
   off-screen items would otherwise shift `:nth-child` parity every
   scroll and make the stripes visibly crawl.

## Feature 2 — streamed directory listings (NEXT)

Files: `src-tauri/src/fs/mod.rs` (adds `list_directory_streamed` command,
splits `list_directory` into `read_dir_listing` + `sort_entries` so both
the sync and streamed paths share one read/sort implementation),
`src/components/FileList.tsx` (chunk accumulator, replaces the single
`invoke("list_directory", ...)` call for the plain-listing branch of
`refresh()`), `src-tauri/src/lib.rs` (register the new command).

**Critical: fold in the `f6310d6` fix from the start.** The chunk
listener (`listen("directory-chunk", ...)`) must have its registration
awaited before the first `invoke("list_directory_streamed", ...)` is
ever sent — the backend can emit all of a small folder's chunks within
microseconds of the invoke landing, faster than `listen()`'s promise
resolves. Structure it as: start `listen()` in the component body (not
inside `onMount`), store the promise, `await` that promise at the top of
`startStreamedListing()` before calling `invoke()`. See `1093683`'s
commit message and `f6310d6`'s diff for the exact original shape of this
fix — but write it in from day one this time, don't ship the race and
fix it in a follow-up version like last time.

No `.setup()`-time Rust code — the streamed command only runs when a
`FileList` actually requests a listing, well after the app is already
up. Low risk to startup, same reasoning as feature 1.

Sort chunks **after** sorting the full listing, never in read order —
streaming raw read order would let rows land wrong and then jump once
sorted, which is worse than the synchronous version.

## Feature 3 — live directory watching (DONE, shipping as v0.4.105)

New file: `src-tauri/src/dirwatch.rs` (non-recursive, 250ms-debounced
watch per open folder, keyed by an opaque per-`FileList`-instance id so
split-view panes and multiple windows don't clobber each other's watch —
this file already existed as an uncommitted draft when this session
picked the work back up; it matched the plan below as-is and was wired
in rather than rewritten). Commands `watch_directory`/`unwatch_directory`,
registered in `lib.rs`. Frontend: `FileList.tsx` reuses the existing
`streamId` (`createUniqueId()`, already present for the chunk listener)
as its watch key, a `createEffect` that calls `watch_directory` on every
`props.path` change, and a `listen("directory-changed", ...)` handler
that calls `startStreamedListing(true)` — the silent-refresh path that
was stubbed out (buffer field, `silent` flag) back in feature 2 for
exactly this. Both the watch effect and the change listener are skipped
while `isSearching()`/`isContentSearch()` are true — the watch tracks the
current folder's plain listing, not the current search query, and a
watcher firing mid-search would otherwise stomp search results.
`unwatch_directory` is called from `onCleanup` so a closed pane's watch
doesn't leak.

No `.setup()`-time init — watches are only registered per-request from
the frontend, never during app startup. Low risk to the launch hang.

## Feature 4 — split view (DONE, shipped as v0.4.106, then extended to an
N-pane grid in v0.4.107)

**v0.4.106** shipped a single two-pane split (`splitPath: string | null`),
matching the original `38c8f08` design exactly, including its known
loose-vs-strict-null gotcha (fixed from the start this time). The second
pane's header was just a read-only `<span>` for the path plus an Up
button — deliberately minimal, reasoning that duplicating the window's
full address bar per pane was a much larger change than the split itself.

**The user hit this directly**: unable to change the second pane's path
even though it was the active/selected pane, because there was no way to
*type* a path there at all — only double-click-into-folder and Up
worked. They also asked for up to 4 horizontal x 4 vertical panes, not
just one second pane. **v0.4.107 replaced the two-pane model with an
N-pane grid** in response:

- `splitPath: string | null` → `splitCols: number` (1-4) +
  `splitPanePaths: string[]` (one entry per *extra* open pane, in fill
  order; pane 0 is always the window's own primary path and isn't stored
  in this array) — same shape change in `settings.ts` and
  `state/mod.rs`'s `Settings` struct. `#[serde(default)]` on both new
  Rust fields makes this a safe schema change: a settings.json from
  v0.4.106 with the old `splitViewPath` field just has that field
  ignored and the new ones default to unsplit.
- Rows aren't a separate stored dimension — panes wrap onto a new row
  automatically once `splitCols` fills up, capped at `MAX_ROWS = 4`
  (`MAX_PANES = 16` total including the primary pane). This satisfies
  "up to 4 horizontal x 4 vertical" with one user-facing control
  (a columns stepper, 1-4) instead of two, since row count falls out of
  pane count ÷ columns.
- **Every extra pane now gets a real `ExplorerPathBar`** (the same
  component the primary pane's address bar in `App.tsx`'s `CommandBar`
  uses — breadcrumb popover, editable path input with autocomplete,
  favourite toggle) instead of a static label. This is the actual fix
  for the reported bug: typing/pasting a path into any pane's own address
  bar now navigates that pane.
- Extra panes are rendered with Solid's `<Index>`, not `<For>`: panes are
  addressed by *position* (pane k is `splitPanePaths[k-1]`), and two
  panes can legitimately show the same folder at once, which `For`'s
  keyed-by-value semantics would collide on. `Index` calls its render
  function once per slot and updates an accessor as that slot's path
  changes, which is also what lets each pane's local `pathInput` signal
  (the address bar's in-progress typed text) survive navigation instead
  of being torn down and recreated.
- `addPane()` opens the new pane at the parent of whichever pane is
  currently active (not always the primary), `closePane(i)` splices that
  entry out and re-targets `activePane` if it pointed at the closed pane
  or shifted past it.

Still frontend-only for the pane mechanics; the only Rust touch remains
the settings fields, inert data with no `.setup()`-time behavior. Low
risk to the launch-hang regression this whole effort is about.

**Second round of user feedback on v0.4.107**: the per-pane address bars
worked, but global navigation — the top address bar in `CommandBar`,
sidebar clicks (drives/favourites/recents/quick-access), the search box —
only ever affected the primary pane, even when a different pane was
selected/active. This was because `activePane` lived entirely inside
`ExplorerView`, invisible to `App.tsx`, so nothing outside it could target
whichever pane the user actually had focused. **v0.4.108 lifted
`activePane` up to `App.tsx`**, passed down to `ExplorerView` as a
controlled prop (`activePane`/`onActivePaneChange`) instead of a local
signal:

- `App.tsx` gained `activePanePath()` (resolves to `currentPath()` for
  pane 0, `settings.splitPanePaths[i-1]` otherwise) and
  `navigateActivePane(path)` (routes through `navigateTo` — keeping
  back/forward history and tabs — for pane 0, or a direct
  `splitPanePaths` update otherwise, matching how `ExplorerView` already
  navigates extra panes).
- The top `ExplorerPathBar`, `Sidebar`'s `currentPath` (used only for
  highlighting), and `selectSidebarPath` all now read/target
  `activePanePath()`/`navigateActivePane` instead of always
  `currentPath()`/`navigateTo`.
- `pathInput` (the top address bar's in-progress typed text) is now kept
  in sync via a `createEffect` on `activePanePath()` rather than being
  set manually at each navigation call site — so switching which pane is
  active also updates what the address bar displays, not just what it
  writes to.
- The search box's query is now gated per pane inside `ExplorerView`
  (`props.activePane === <that pane's index> ? props.searchQuery : ""`)
  instead of the primary pane unconditionally receiving it and every
  extra pane unconditionally not — so search follows whichever pane has
  focus.
- Tabs and back/forward history remain **primary-pane-only by design** —
  that's an intentional, pre-existing scope (see the tab-sync comment in
  `App.tsx`), not something this fix changed. Only pane 0 participates in
  either.

## Feature 5 — search index (DONE — shipped after v0.4.108)

(Implemented exactly per the mitigation below: `searchindex::init` is
spawned off the setup thread in `lib.rs`, with log markers around it.)

New module: `src-tauri/src/searchindex/mod.rs` (flat in-memory `Vec` of
indexed entries — deliberately not a database, see the module's own doc
comment on `38c8f08` for the memory/simplicity tradeoff reasoning — with
a recursive watcher per indexed root, persisted to
`search_index_v1.json`). New commands `search_index_status`,
`search_index_query`, `rebuild_search_index`, `clear_search_index`. New
settings field `searchIndexRoots: string[]` /
`search_index_roots: Vec<String>`. New component
`src/components/SearchIndexSettings.tsx`, wired into `SettingsPanel.tsx`
as a new "Search index" category. `FileList.tsx`'s search path uses the
index for recursive name search when the current folder is covered by an
indexed root.

**This is the one piece that ran new code synchronously inside
`.setup()`** — the original had `searchindex::init(&app.handle())` called
directly in `lib.rs`'s setup closure, right after `sizecache::init(...)`.
We never got real evidence about whether this specifically caused the
hang (the diagnostic build that would have told us was never actually
run before the user asked for a revert), but it's the only one of the
five reverted pieces that touches startup at all, which makes it the
prime remaining suspect by elimination.

**Do this differently from the original:** don't call `searchindex::init`
synchronously in `.setup()`. Spawn it off the setup thread instead — e.g.
`std::thread::spawn(move || searchindex::init(&app_handle))`, or via
`tauri::async_runtime::spawn` if it needs to stay on Tokio — so it is
*categorically impossible* for this feature to block app startup,
regardless of what it does internally. `searchindex::init` only reads a
persisted index file and starts a filesystem watcher; nothing it does
needs to complete before the window is usable, so deferring it costs
nothing.

Also worth doing for this one specifically, given it's the only genuine
suspect: keep lightweight log markers around it (`log::info!` before and
after the spawn, and inside `init` at its major steps), in the same style
as `1093683`, so if a hang ever does recur, the very next log file
pinpoints it instantly instead of requiring another round of "can you
send me the log" back-and-forth.

## If it breaks again (read before writing a live fix)

1. Don't reason about it from the code alone — that's what produced three
   dead-end pushes the first time.
2. Ask the user for `%LOCALAPPDATA%\.flurer\logs\<latest>.log` and, if the
   `devtools` Cargo feature is enabled for that build, the DevTools
   console (`Ctrl+Shift+I` or right-click → Inspect).
3. If the version in question doesn't have log markers around the new
   code, add them, ship *that alone* as a diagnostic version, and wait for
   the log before writing a fix.
4. Only write a fix once you can point at the specific line/await that
   didn't return. If you can't, say so plainly rather than shipping a
   guess.
5. Two failed live fix attempts on the same feature → revert that
   feature's commit (not the whole stack) and reconsider the approach,
   per `superpowers:systematic-debugging`'s "3+ fixes failed" rule — don't
   wait for a third attempt to burn another version on a machine the user
   can't debug interactively.

## Rust-not-buildable-locally

Same constraint as the rest of this project: this dev box's `cargo
check`/`cargo build` fails on `glib-sys` (system glib 2.68.4, Tauri needs
>= 2.70) and the app targets Windows anyway. `bunx tsc --noEmit` and
`bun run build` are the only things you can verify locally. **Every Rust
change is unverified until GitHub Actions compiles it** — say so plainly,
don't imply Rust changes were "checked" on the strength of a passing
frontend build.

## Release ritual (every single version bump, no exceptions)

1. Implement one feature.
2. `bunx tsc --noEmit` clean.
3. `bun run build` clean.
4. `git status --short` — confirm only the files you meant to touch
   changed. This caught nothing surprising so far, but it's cheap
   insurance against an accidental leftover edit.
5. `git add -A && git commit` with a real description (see feature 1's
   commit message on `main` for the level of detail expected — what
   shipped, what's deliberately different from the original attempt, and
   an explicit statement that it's low/no risk to the startup hang or why
   it's the one piece that might not be).
6. `git push origin main`.
7. Bump version in **four** files, kept in sync:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock` (only the `flurer` package's own `version =`
     line — sed by exact line number, never hand-edit dependency hashes)
8. `git commit -m "bump version to X.Y.Z"`, `git push origin main`.
9. `git tag vX.Y.Z && git push origin vX.Y.Z`.
10. Monitor the `Build` (main) and `Release` (tag) Actions runs — GitHub's
    unauthenticated API is rate-limited to 60 req/hour, so poll no more
    often than every ~3 minutes (a `Monitor` with `sleep 180` between
    checks has worked fine throughout this session). `git ls-remote
    origin refs/heads/main refs/tags/vX.Y.Z` is a free way to confirm a
    push/tag landed without touching the rate-limited API at all.
11. Tell the user what shipped, that it's on the release page
    (`https://github.com/sahuishan01/Flurer/releases/tag/vX.Y.Z`), and
    that you're waiting for their confirmation before the next feature.
12. **Only send the `agent-releases` ntfy notification once the user has
    confirmed the app actually works**, not on a green CI run alone — CI
    green only proves it compiles, and this whole saga started with a
    release that compiled fine and was unusable. `agent-tasks` (not
    `agent-releases`) is fine for routine "pushed, waiting on you"
    updates if the user's global CLAUDE.md conventions call for it.

## Settings compatibility (verified safe, don't re-litigate)

Settings are stored per-version:
`~/.config/flurer/<version>/settings.json` (see
`src-tauri/src/helpers/settings.rs`). On a version bump, `load_settings`
carries forward the highest *older* version's settings.json it can find.
New fields added by a feature (e.g. `splitViewPath`, `searchIndexRoots`)
are plain optional/defaulted fields on both sides
(`#[serde(default)]` in Rust, matching defaults in
`DEFAULT_SETTINGS` in `lib/settings.ts`) — a settings file from a version
that doesn't know about a field just omits it, and Rust's serde defaults
fill it in. This was already verified working across the v0.4.96 →
v0.4.101 revert and back; no special handling needed when adding fields
for the remaining features.

## Post-revert work (everything after feature 5, all shipped via the same ritual)

Each item below shipped as its own tagged version; details live in the
respective commit messages and release notes.

- **Delete flows**: `delete_items` (Recycle Bin via the `trash` crate) plus
  Shift+Delete permanent delete (`delete_items_forever`, std::fs removal,
  no undo). A configurable in-app shortcut (`deletePermanently`, default
  Shift+Delete) with its own "cannot be undone" confirm dialog.
- **App-delete size refresh**: `sizecache::refresh_after_app_delete` runs
  after BOTH delete commands regardless of the `live_folder_size_updates`
  setting — it drops the deleted item's own cache entries and queues full
  recomputes for every cached ancestor. External changes still respect the
  setting.
- **Top-bar system metrics** (`src-tauri/src/metrics/`, `MetricsBar.tsx`):
  a sampler thread emits one `system-metrics` event per configurable
  interval (1–10 s, default 2 s) — per-core CPU usage/frequency,
  memory/swap, drives (sysinfo), GPU utilization/VRAM (DXGI enumeration +
  D3DKMTQueryStatistics, all vendors, `#[cfg(windows)]` with a no-op stub
  elsewhere — D3DKMT lives under `Windows::Wdk` in windows-rs). Settings
  field `topBarMetrics { enabled, intervalSeconds, items: [{kind,id}] }`,
  diffed into sampler atomics inside `set_settings`. `MetricsBar.tsx`
  renders one sparkline widget per pinned device (40-sample rolling
  history; fixed 0–100 scale except network, which self-scales) — color
  identifies hardware type (CPU blue / memory purple / GPU green / drive
  orange / network pink), a small percentage/rate sits beside it, hovering
  opens a detail panel (per-core bars, RAM/swap, VRAM, drive used/free,
  NIC rates/totals), clicking pins the panel. Configured in Settings →
  "Top bar metrics" with per-device checkboxes fed by `get_metric_devices`.
- **Command bar layout** (three iterations of user feedback): the bar is
  three explicit zones — `.command-bar-left` (back/forward/up, order 1,
  hard-pinned), `.command-bar-center` (path breadcrumb, grows, order 2),
  then metrics (`.command-bar-metrics`, order 3), tools
  (`.command-bar-right`: progress + search, order 4), window controls
  (order 5), with thin `.command-bar-divider` separators. **Narrow-width
  rule**: only `.command-bar-metrics` gets `flex: 1 1 100%` and wraps onto
  a second row (scrollable, top-border separated) — progress, search and
  min/max/close always stay on row one, controls hard-pinned top-right.
  The center zone is `overflow-x: auto` (scrollable, not clipped) when
  the path runs out of room.
- The version-bump/tag/release ritual (below) now also includes the ntfy
  `agent-tasks`/`agent-releases` notifications per AGENTS.md §7, and the
  version bump commit is pushed to main only AFTER the Release workflow
  succeeds (tag-only push triggers Release; see AGENTS.md §7.4).

CI lessons from the metrics work: two Build failures were caught exactly
where this file says they'd be — windows-only APIs (NTSTATUS comparisons
need `.0`; `Disks::refresh` takes a `bool` on Windows but not on Unix
sysinfo targets; serde derives needed by cross-platform command payloads).
Treat any "compiles on my reasoning" claim about windows-cfg code as
unverified until CI is green.

## UI quality pass (2026-10) — six items, shipped as v0.4.232

User request: "how can we create a better ui?" → six suggestions, then
"do it in the correct order". The order chosen was **dependency order,
not list order**: ARIA first (a real bug with a small blast radius),
then the design-token foundation, then the shared kit, then the CSS
split. Each item was a separate commit, pushed, and watched through
Build CI.

1. **File table ARIA** — commit `f5f5740` (Build `39583926561` green).
   `FileList.tsx` was a `<tr role="row">` inside a table with no
   `role="grid"`, and 56 selection references with no `aria-selected`.
   Now: `role="grid"`, `aria-multiselectable`, an accessible name
   derived from `baseName`, `aria-rowcount`; body and group rows carry
   reactive `aria-rowindex` and `aria-selected`; `<th>` uses
   `aria-sort`; sortable headers are keyboard-operable (Enter/Space);
   the icon-grid view became a `role="listbox"`.
   - `role="row"` on `<tr>` was **removed**: HTML-AAM maps `<td>` to
     `gridcell` and `<th>` in `<thead>` to `columnheader` (which is
     what supports `aria-sort`) automatically, so the explicit role
     was redundant.
   - The grid view needs `aria-rowcount` + `aria-rowindex` because it
     is virtualized, and those indices must be **reactive** or they go
     stale when the virtual window scrolls. A function-valued
     attribute is not reactive-ified by Solid — the accessor form
     (`x(T,"aria-rowindex",oe.n=Ue)`) is required, not
     `x(ye,"aria-rowindex",()=>Nn(Se()))`.
2. **Design token foundation** — commit `5f7546a`. Added a `--space-*`
   scale (63 hardcoded px values replaced across 42 declarations),
   named all 6 `transition: all` declarations with explicit property
   lists, and wired `DESIGN.md` to the code with a drift test
   (`tests/design.test.ts`, 8 assertions) that parses the spec's YAML
   frontmatter and the stylesheets' token blocks and asserts they
   agree. The drift test found a genuine unit mismatch in the spec
   (the badge was documented as `10px` while CSS uses `0.625em`).
   - **The spacing tokens are `rem` while the app CSS stays `em`, on
     purpose.** An `em` length inside a custom property resolves
     against the *using* element's font-size, not the declaration
     site, so switching the tokens to `em` would have silently changed
     rendering in 14 rules. The app's own `em` usage is deliberate (it
     scales with the user's font-size setting) and must be preserved.
   - **Negative spacing must be `calc(-1 * var(--space-N))`.**
     `-var(--space-3)` tokenizes as a *function named `-var`*, not a
     negation, and computes to the initial value. This was a real bug
     introduced and then fixed at 3 sites.
3. **Shared UI kit** — commit `47ef903`. `SettingsSection` /
   `SettingRow` / `SettingGroup` were well-built and already reused by
   six components, but they lived under a settings-only name and path,
   which read as "not for you" to the plugin panels the plugin spec
   tells to use them. They now live in `src/components/ui/` as
   `CollapsibleSection`, `FieldRow` and `FieldGroup`, with their CSS
   renamed to match (`.ui-section`, `.ui-field-row` and friends).
   - The collapse state is now created per surface through
     `createCollapsibleState({ storageKey })`, so a surface with no
     provider still folds. The old fallback was a no-op state, which
     meant a section outside the settings provider rendered a
     disclosure button that did nothing.
   - The kit is exposed on `window.FlurerUI`. Plugins are IIFE bundles
     loaded via `new Function` with no module loader, so they cannot
     import from `src/` — the plugin spec's advice to use these
     primitives was not actionable until this.
   - `data-section-id` was dropped from the section card: nothing read
     it, and the sidebar's drag hit-test does
     `closest("[data-section-id]")`, so a shared card carrying that
     attribute could be mistaken for a drag target.
4. **CSS split** — commit `34d9235`. `App.css` was 5,452 lines; it is
   now 20 files under `src/styles/`, one per component region, with
   `App.css` reduced to the `@import` list.
   - **The split is by contiguous region, chosen at component seams,
     and the import order is the original file order.** That is the
     whole point: the cascade in this file is order-sensitive (the
     global `button:not(...)` rule, the per-theme accent blocks, the
     media queries and several later overrides of earlier rules all
     depend on source order), so keeping the regions contiguous and
     importing them in order leaves the cascade untouched. The built
     stylesheet is **byte-for-byte identical** to before the split
     (verified by checksum), which makes this provably a pure refactor
     rather than a restyle.
   - The `@import "./theme.css"` moved into `src/styles/base.css` and
     had to become `@import "../theme.css"` — the relative path
     changed when the file moved.
5. **CI-only fixes** — commits `91fa36d` and (in `34d9235`) the drift
   test's rewrite. Both were the new drift test failing on the
   **Windows** leg only:
   - `new URL("..", import.meta.url).pathname` yields `/D:/a/b` on
     Windows, and `readFileSync` cannot open a path that starts with a
     slash before a drive letter. Fixed with `fileURLToPath` +
     `node:path`'s `join`.
   - Windows checkouts have **CRLF** line endings, and the frontmatter
     parser matches on `"\n"`. Fixed by normalising `\r\n` on read.
   - The Windows runner also caught the drift test still pointing at
     `App.css` after the split; it now reads the stylesheets in
     `App.css`'s import order.

The Windows leg is the only place these three bugs could show up — it
is the one that checks out CRLF and mangles drive-letter paths. **A
green Linux run is not evidence that a test file is portable.**

Two further items landed after v0.4.232, in the same vein:

- **TrashView ARIA** (commit `d775feb`). The recycle bin has a second
  table, and the earlier ARIA work only fixed the main file table —
  two tables with the same shape should not have different semantics.
  It now carries `role="grid"`, `aria-multiselectable`,
  `aria-selected` and `aria-rowindex` like the other one.
- **PropertiesDialog on the shared kit** (commit `d074afd`). The
  properties dialog had its own grid of label/value pairs, the same
  shape the kit's field row already provides. It now uses `FieldRow`
  with a new `readOnly` variant. The read-only form is not the
  editable row with a value dropped in: the value is the flexible
  column so a long path truncates, and the *group* owns the grid
  tracks (the rows are `display:contents`) so every value in the list
  starts at the same x.

That second item also fixed a bug that predated both the kit and the
CSS split — see "A media query that never applied" below.

**Do not re-litigate the spacing scale, the `rem` vs `em` decision, the
`calc(-1 * …)` form, or the CSS split's contiguity rule** — each was
chosen deliberately, and each has a failure mode recorded above.

## Plugin permission gateway (2026-10) — implemented, not yet released

AGENTS.md §4. A plugin used to get the raw `window.TauriCore` and
`window.TauriShell`, and `src-tauri/capabilities/default.json` grants
`shell:allow-execute` (sh, git) to every window — so any installed
plugin could run `sh -c "..."` with no prompt and no record of it.

Now a plugin runs with a scoped window whose `TauriCore.invoke` and
`TauriShell.Command` are routed through a gateway
(`src/lib/pluginGateway.ts`). Each call is attributed to the plugin
that made it and checked against the permissions the user has granted
that plugin (`src/lib/pluginPermissions.ts`). Five permissions:
`fs:read`, `fs:write`, `shell`, `app:settings`, `plugins:manage`. The
`git_*` commands all drive git through the shell, so they need `shell`.

- **Why the scope works.** Plugins are IIFE bundles that resolve
  `window.TauriCore` at CALL time, not at load time — so shadowing
  `window` and `globalThis` for the plugin's code intercepts every
  call, including ones made long after the plugin loaded. A plugin
  that stashes the API and calls it later is still gated; there is a
  test for exactly that.
- **Why the iframe sandbox was not done.** Plugins must share the
  app's Solid runtime (the spec requires `solid-js` to be externalized
  to `window.Solid` so reactivity works across the boundary). An
  iframe cannot reach the parent's `window.Solid`, so every plugin
  would have to be rewritten to a postMessage protocol. It is a
  migration, not an increment.
- **Do not narrow the Tauri capabilities to "fix" this.** The
  capability file is app-wide, and the app's own git integration still
  needs `shell:allow-execute`. The gateway is the per-plugin gate.
- **The tests were mutation-checked.** Six mutations — no permission
  check, a denied call allowed through, the shell gate removed, the
  scope not applied, a grant not remembered, grants shared between
  plugins — each produce a failing test. A test that passes with the
  gate removed would not be testing anything.
- A denied call **rejects** with a `PermissionDeniedError`, so a
  plugin has to catch it. `plugin-spec.md` §6 documents this.

Three things about testing this, each of which cost a debugging cycle:

- **Bun's test runner has no `window` and no `localStorage`.** The
  permission module reads storage at import time, so the test has to
  install a stand-in *before* importing it — a dynamic `await import`
  after the stand-in, not a static import.
- **A query string on an import path loads a second copy of the
  module.** `import "...?test=1"` and `import "..."` are different
  module instances with different signal state, so the test was looking
  at one copy of the permissions while the gateway checked another.
  Use the plain path in both.
- **ES module exports are read-only.** `perms.requestPermission = ...`
  throws "Attempted to assign to readonly property", so the test
  cannot stub the prompt that way. It resolves the module's own
  pending request instead — which is what the prompt dialog does.

**Do not re-litigate the five-permission granularity** — it is coarse
on purpose, so a user asked "may this plugin run shell commands?" can
answer without reading a list of fifty command names.

## Current git state

`main` is at **v0.4.233**, which shipped the six UI-quality items below.
The Settings redesign shipped in v0.4.225
(plus the CI image fix in v0.4.226); the explorer layout regression it
introduced was fixed in v0.4.227 — see "The CSS merge that broke the
explorer" below for what went wrong and how it was caught — and the
plugin-to-plugin settings switch was fixed in v0.4.231 (see "Solid's
`<Show>` needs `keyed`" below).

v0.4.228–v0.4.230 were the child-webview shortcut work, landed
separately.

The release ritual is unchanged: Build CI green → bump → tag-only push
→ Release CI green → bump commit pushed → ntfy agent-tasks +
agent-releases. Two CI notes worth keeping: the Release workflow's
`publish` job `needs: build`, and `build` is a matrix, so **one failed
leg publishes no release at all** (this is how a single missing
`xdg-utils` in the Linux build image blocked every release); and the
Linux leg runs on the self-hosted `heaven` runner, whose job-start hook
was briefly misconfigured (`/usr/local/libexec/github-runner-job-started`
must exist and end in `.sh`/`.ps1`/`.js` — a runner-machine config, not
a repo one).

There is only **one** self-hosted runner, so the Release's Linux leg
queues behind any Build run on the same period, and a release can sit
in `queued` for a long time before it starts. That is the queue
working, not a failure — check `gh run view <id> --json jobs` for the
per-job state rather than the run's overall status.

### Building the Linux installers by hand

`scripts/ci/linux-container.sh release` produces the deb, rpm and
AppImage on a build host, using the same container image CI uses. It
needed three fixes to run outside CI, all in the script:

- `RUNNER_TEMP` is a CI-only variable, and the script runs under
  `set -u`, so it died before reaching the container.
- bun was assumed to be at `$BUN_INSTALL/bin/bun`, which only exists
  when `setup-bun` installed it. On a host where bun comes from a
  version manager the binary can be named `bun.exe` and is reached
  only through a symlink whose target sits outside the mounted tree,
  so the script resolves bun to a real file and mounts its directory.
- A volume mounted from a directory the container cannot traverse is
  unreadable on a SELinux-enforcing host unless it is relabelled with
  `:z`. The label is applied only outside CI, so a CI runner's own
  temp directory is never relabelled.

Note that this host is **aarch64**, so a local build produces arm64
artifacts (`flurer_0.4.233_arm64.deb`), while CI's runner is x64 and
produces amd64 ones. A local build proves the code compiles and
bundles; it is not a substitute for the published amd64 artifacts.

### A media query that never applied

The narrow-window layout for the settings rows — the control dropping
under its label, and the slider widening — **never worked**. The
`@media (max-width: 900px)` block sat *earlier* in the file than the
base `.ui-field-row` and `.setting-control-slider` rules, and with
equal specificity the later rule wins, so the base layout always
applied. This was true before the CSS split too (the media query was at
line 2792 and the base rule at 2960 of the old `App.css`); the split
just made it easier to see.

The fix was to move the media query below the rules it overrides. A
headless-Chromium check of the *computed* styles at 1200/900/700/500/380px
is what caught it — reading the CSS, the rule looks right.

Two lessons:
- **A media query must come after the rules it overrides.** If it comes
  before, it silently loses on equal specificity.
- **Check computed styles, not the stylesheet.** This is the same
  lesson as "verify CSS changes by their effect, not by their
  selectors" above, and it caught a bug that had survived two CSS
  refactors.

The same trap applies to the shared kit's read-only row: its selector
is deliberately two classes (`.ui-field-row.ui-field-row-readonly`), so
that the narrow-viewport media query — which restyles `.ui-field-row`
itself — cannot beat it on specificity.

Chromium for these checks is at
`~/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`; drive it
over the DevTools protocol (the WebSocket URL is printed on stderr)
and read `getComputedStyle` / `getBoundingClientRect` out of
`Runtime.evaluate`.

The UX improvements project (all 8 chunks, command palette through tab
polish) is complete: every chunk shipped through the full release ritual
and its Release workflow succeeded. Post-project follow-ups v0.4.212
(live plugin progress), v0.4.213 (in-app child webviews), v0.4.214
(explorer view-type selector) and v0.4.215 (plugin-extensible view types)
are each also shipped through the same ritual.
Settings live in
`~/.config/flurer/<version>/settings.json` with serde defaults bridging
old files (see "Settings compatibility" below). The per-version ritual in
"Release ritual" plus AGENTS.md §7 (ntfy notifications, CI watch, bump
only after a green build, tag-only push) is the required workflow for any
new change. This file and AGENTS.md are the source of truth for working
on this repo.

## Settings redesign (2026-10) — DONE, shipped as v0.4.225

User request: "the settings looks like a ai slop. Redesign it to give it
a fresh modern look with advanced ux for quick navigation between
settings, currently I need to scroll a lot."

Commit `ac1c383` (feature) + `70eb22d` (bump) + tag `v0.4.225`.
Frontend only — **no Rust changes**, so no Rust CI risk. Files:
new `src/lib/settingsRegistry.ts` (categories, sections, searchable
items, visibility predicates — data only, no JSX, so icon keys map to
SVG in the panel), new `src/lib/fuzzy.ts` (`fuzzyScore` extracted from
`CommandPalette.tsx` plus a stricter `matchScore`), new
`src/components/settings-ui.tsx` (`SettingsSection`, `SettingRow`,
`SettingGroup`, and the collapse-state context), new
`src/components/SettingsSearch.tsx`, rewritten
`src/components/SettingsPanel.tsx`, restructured
`src/components/CustomizationSettings.tsx` (1137 → 1302 lines but split
into 10 anchored sections instead of 3 huge cards), plus
`ShortcutsSettings`, `UpdatesView`, `SearchIndexSettings`,
`PluginMarketplace`, `PluginAppearanceSettings`, `App.tsx`, `App.css`,
`src/lib/plugins.ts`.

What shipped:
- **Cross-category search** in the header. Fuzzy-matches every
  individual setting across all categories; a hit switches category,
  expands the section, scrolls to the control and flashes it. It
  *navigates* — a query never hides content.
- **Sticky sub-nav** of section pills per category, acting as a
  scroll-spy that tracks the scroll position.
- **Collapsible section cards**; folded state persists per section in
  `localStorage` (`flurer.settings.collapsed`) — UI state, so no
  `settings.json` schema change and no Rust migration.
- **Two-column setting rows** (label + explanation left, control right).
- **Appearance & Theme split** into Background / Gradient / Solid colour
  / Wallpaper / Theme / Typography / Behavior / Top bar metrics /
  Startup & system / Storage. Gradient, Solid colour and Wallpaper are
  conditional on `backgroundType`.

Three bugs fixed along the way, worth remembering:
- `SettingsPanel.tsx` called `invoke("get_settings")` **without
  importing `invoke`** — "Export Settings JSON" threw a `ReferenceError`
  when clicked. It had been broken since the button was added.
- The search results popover rendered **underneath** the content pane.
  `backdrop-filter` on `.settings-header` makes it a stacking context, so
  the popover's `z-index: 120` was trapped inside it and the later
  `.settings-body` painted over it. Fixed with
  `position: relative; z-index: 20` on the header.
- A plugin "Update" button never showed its busy state.

### Solid's `<Show>` needs `keyed` when `when` is a value, not a boolean

Switching from one plugin's settings straight to another plugin's
settings left the first plugin's panel on screen. Switching from a
global settings category into a plugin worked, which made it look like
a plugin problem rather than a rendering one.

It is neither — it is Solid's `<Show>`. Without `keyed`, Show's
condition memo uses `equals: (a, b) => !a === !b`, i.e. it only
re-renders its children when the **truthiness** of `when` changes:

```js
const condition = keyed ? conditionValue : createMemo(conditionValue, undefined, {
  equals: (a, b) => !a === !b
});
```

`SettingsPanel` passed the plugin id as `when`, which is always a
truthy string, so going from `"plugin-alpha"` to `"plugin-beta"` never
re-invoked the children function and the previous panel stayed mounted.
Coming from a global category changed truthiness (`undefined` → string),
which is why that direction worked.

`keyed` makes Show compare the value itself, so the children are
recreated for the newly selected plugin. Note that with `keyed` the
child receives the **value**, not an accessor — `pluginCategory` rather
than `pluginCategory()`.

This bug predates the settings redesign; the same `<Show>` was there
before it. The general rule: **if `when` can be truthy in more than one
distinct state, `<Show>` needs `keyed`** — otherwise it only reacts to
the truthiness edge. The same trap applies to `<Switch>`/`<Match>` and
to any conditional rendering keyed on a changing value.

Fix: `1483ade` (v0.4.231). Verified with two mock plugins registered
in the preview harness — alpha → beta, beta → alpha and global → plugin
all render the right panel and the right `pluginSettings`.

Two lessons from this work, both about verifying rather than assuming:
- **A plain subsequence fuzzy match is too permissive for long labels.**
  "blur" matched "**G**lo**b**al hotkey to ope**n** Fl**u**r**er**" — every
  letter is present, twenty characters apart. `matchScore` in
  `src/lib/fuzzy.ts` adds a proximity rule (matched characters must sit
  within `len * 2 + 2` of each other) and scores keywords one at a
  time, because scoring a whole keyword list as one string lets a query
  scatter across unrelated words ("blur" matched "rebuild").
- **A screenshot is worth more than a careful read of the JSX.** The
  popover z-index bug was invisible in the code and obvious in a
  rendered screenshot. The settings screen can be rendered outside the
  Tauri app with a throwaway `preview.html` + `src/preview.tsx` entry
  and headless Chromium (`~/.cache/ms-playwright/.../chrome
  --headless --screenshot`); drive it with a small CDP script over
  Node's global `WebSocket` when an interaction needs verifying.

### The CSS merge that broke the explorer (v0.4.227)

v0.4.225 shipped the redesign **and a regression in the file
explorer**, which was reported by the user and fixed in v0.4.227
(`58f901c`). It is worth writing down because the failure mode was
silent and the cause was not where anyone would look.

The redesign removed a block of dead CSS with a Python script that did a
plain string replace:

```
.settings-panel-header h2,
.settings-section h3 {
    text-shadow: var(--text-shadow);
}
```

Those two selectors were the **tail of a longer shared selector list**:

```
.sidebar-item,
.sidebar-section-label,
.breadcrumb-segment,
.file-table th,
.file-table td,
.progress-task-label,
.settings-panel-header h2,
.settings-section h3 {
    text-shadow: var(--text-shadow);
}

.file-list-error-banner { ... }
```

(The `.settings-section` class in these quotes was later renamed to
`.ui-section` when the settings primitives moved into the shared UI
kit — see "UI quality pass" above. The quote is left as it was, because
that is the code the lesson is about.)

Deleting the tail removed the rule's **closing brace** as well, so the
list ran straight into the next rule and merged with it. Everything in
the list inherited `.file-list-error-banner`'s declarations — a red
tint, a 1px border, a 12px gap, 4px margins, 6px radius and
`display: flex`. The file table cells went from `display: table-cell`
to `display: flex`, and the sidebar items, section labels and
breadcrumb segments all turned into red error banners.

Rules to take from it:
- **Never bulk-edit CSS with string replacement.** A rule's selector
  list can continue past the block you think you are removing. Remove
  whole rules with a CSS parser, or by matching the full rule text.
- **A selector-list change is not a local change.** Removing the last
  selector of a list is equivalent to deleting the whole rule, and
  merging two rules is equivalent to deleting the boundary between
  them. Both were invisible in a diff of "settings" selectors.
- **Verify CSS changes by their effect, not by their selectors.** The
  check that found this: parse both revisions with postcss and diff
  the *rules*, then render one element per class in headless Chromium
  and diff the *computed styles*. Before the fix, `.file-table td`
  reported `display: table-cell -> flex` and a red background; after
  it, every explorer class is byte-identical to the original. A
  selector-level diff had missed it because the corrupted rule still
  had the right selector text.

Also note: `bun run build` is `vite build` and does **not** typecheck —
CI will not catch a TypeScript error. Run `./node_modules/.bin/tsc
--noEmit` locally. The pre-existing baseline on `main` is **7 errors**
(TS6133 unused vars in `App.tsx`, `ExplorerPathBar.tsx` and
`FileList.tsx`; a missing `openTerminalHere` in `App.tsx`; an
`autoComplete`/`autocomplete` casing error in `CommandPalette`; a wrong
arity call in `ExplorerPathBar`; and a MouseEvent/PointerEvent mismatch
in `ExplorerTabs`). These are pre-existing and out of scope — do not
fix them opportunistically; just do not add to them. A change is clean
when the count stays at 7 and the distribution is unchanged.

## UX improvements project (2026-09) — CURRENT ACTIVE WORK

User request: implement the full UX-improvement shortlist "in chunks and
version bumps" — one feature per chunk, each chunk going through the full
release ritual (commit → push → watch Build CI → bump version → tag
tag-only → watch Release CI → push bump commit → ntfy agent-tasks +
agent-releases). Chunk order (chosen for impact/risk):

1. **Command palette (Ctrl+K)** — **DONE, shipped as v0.4.204.** Commit
   `003696c`. Files: new `src/components/CommandPalette.tsx` (fuzzy
   subsequence scoring, Portal'd overlay using `.modal-backdrop` so the
   global shortcut handler skips it, keyboard nav, scroll-into-view),
   `src/lib/shortcuts.ts` (new `commandPalette` action, default `Ctrl+K`,
   listed under Navigation in the remappable-shortcuts categories),
   `src/App.tsx` (state + binding in `handleKeyDown` +
   `paletteCommands` memo: nav actions, views incl. registered plugins,
   tabs/panes, per-theme entries, recent + favourite path jumps),
   `src/App.css` (`.command-palette-*` styles). Rust untouched
   (`in_app_shortcuts` is already `HashMap<String, String>`).
2. **Grid/icon view with thumbnails** — **DONE, shipped as v0.4.205.**
   Commit `687b4a2` (feature) + `3e7f269` (bump). `viewMode:
   "details" | "grid"` setting (+ `view_mode` serde-default Rust field —
   compiled green in CI), toolbar toggle, `renderGrid()`/`renderTile()`
   reusing the table rows' handlers (selection, drag, rename via the
   extracted `renderRenameInput`, context menu), grouped sections,
   marquee widened to `[data-row-path]`, thumbnails via
   `get_file_preview` + bounded module LRU (`Thumbnail` component).
   Grid is NOT virtualized in v1 — revisit if huge-folder grid perf
   becomes a problem. `bun run build` was clean before the push.
3. **Breadcrumb path bar** — **DONE, shipped as v0.4.206.** Commit
   `da437e9`. `ExplorerPathBar.tsx` now renders inline clickable breadcrumb
   segments (with per-segment subfolder dropdowns via a second
   `createPopover` instance and the shared `list_directory` cache) whenever
   the typed-path popover is closed; the folder icon still opens the
   editable-path popover, so Ctrl+L and drop targets are unchanged.
4. **Folder tree pane** — **DONE, shipped as v0.4.207.** Commit `67e548a`.
   New reorderable sidebar section `"tree"` ("Folders"): lazy-loading
   expandable tree rooted at the active pane's drive root; navigation
   auto-expands the current path's ancestors; rows are drop targets; nodes
   re-list on re-expand instead of watching. `SidebarSectionId` extended
   (frontend merges unknown ids, so older settings files are safe); Rust
   `default_sidebar_section_order` gained `"tree"` (one-word CI-compiled
   change).
5. **Multi-step undo** — **DONE, shipped as v0.4.208.** Commit `991c23e`.
   FileList's single-slot undo is a 20-deep stack; new remappable shortcut
   `undo` (default Ctrl+Z) pops one operation at a time; toast shows the
   latest operation plus a `(+N more)` count. Scope unchanged
   (rename/move/create/bulkRename/trash-restore).
6. **Quick look preview** — **DONE, shipped as v0.4.209.** Commit
   `e601892`. New `QuickLookModal.tsx`: Space with exactly one item
   selected toggles a centered image/text overlay via `get_file_preview`;
   Space/Esc closes. Space keeps its select-under-cursor behavior when the
   selection isn't a single item.
7. **Marketplace registry browsing** — **DONE, shipped as v0.4.210.**
   Commit `c06ad0d`. `PluginMarketplace.tsx` fetches `marketplace.json`
   from the main repo (`raw.githubusercontent.com/sahuishan01/Flurer/main`)
   at mount into a new "Available Plugins" section with one-click Install
   (reusing the GitHub release install path); failure degrades to a
   message. Starter registry file (`marketplace.json`) ships with the two
   reference plugins.
8. **Tab management polish** — **DONE, shipped as v0.4.211.** Commit
   `a636e47`. Double-clicking the empty tab strip opens a new tab; the
   command palette lists every open tab as a switch target. (Close
   buttons and middle-click close already existed.)

**PROJECT COMPLETE — all 8 chunks shipped v0.4.204 → v0.4.211, each
through the full release ritual (Build CI green → bump → tag → Release
CI green → bump commit pushed → ntfy agent-tasks + agent-releases).

Follow-ups shipped after the project: v0.4.212 (`b5a0426`) added live
progress for plugin install/ZIP/update — Rust emits `plugin-progress`
events (`{stage, percent}`) with a streamed download percent; the
marketplace renders a progress panel (reusing the app-updater styles,
indeterminate animation where no fraction exists). Also: the
marketplace registry gained `web-loader` and its graph entry was
corrected to `sahuishan01/flurer-graph-plugin` (the original guessed
repo 404'd — that was the "Install failed: GitHub API 404" report).
- **v0.4.213** (`1322591`): enabled the Tauri `unstable` feature for native
  in-app child webviews.
- **v0.4.214** (`e5fe02c`): `feat(explorer)` — an extensible view-type
  selector. A registry (`ExplorerViewType` / `EXPLORER_VIEW_TYPES` in
  `src/lib/view.ts`) drives a `ViewTypeSelect` dropdown in the file-list
  toolbar, replacing the binary details/grid toggle; `viewMode` is broadened
  to a registry-driven string (backwards-compatible), with `lookupViewType`
  falling back to a valid layout for unknown/legacy persisted values. Built-in
  types are Details and Grid (their icons reused as descriptors); adding a type
   is a registry entry plus a render branch. Added `ChevronDownIcon`
   (`icons.tsx`).
- **v0.4.215** (`aa0cd41`): made the view-type selector plugin-extensible.
  `PluginInfo.explorerViewTypes` is a new contribution (`id`/`label`/`icon`
  + an optional `render` Solid component) documented in `plugin-spec.md` §4;
  a plugin view type's `render` mounts in place of the table/grid via an
  `ExplorerListViewContext` (current listing, selection, row actions, and a
  `renderTile` convenience) that FileList builds from its own state. App
  merges Core's `EXPLORER_VIEW_TYPES` with plugin types through `ExplorerView
  → FileList → ViewTypeSelect`, so new layouts appear in the selector for free
  and persist as `settings.viewMode`. Core's Details/Grid renderers are
  untouched; `viewMode` resolution falls back to a valid type for
  legacy/unknown persisted values. (Build `36689858263` + Release
  `36690999677` both green.)
Remaining follow-up ideas not in scope: grid-view virtualization for
huge folders, per-pane tab integration, content-index search, plugin
sandboxing (AGENTS.md §4), and the plugin SDK/types package (§5).

Process reminders for every chunk (learned in chunk 1):
- Commit feature first WITHOUT a version bump; only after Build CI is
  green do the bump (package.json, src-tauri/Cargo.toml,
  src-tauri/tauri.conf.json — Cargo.lock was NOT needed this time; the
  sed-style bump commit includes all three), local commit, tag
  `vX.Y.Z`, push tag ONLY, watch Release, then push the bump commit.
- `git pull --rebase` may be needed before pushing (remote moves); the
  auto-managed `.commandcode/taste/*` files are dirty — stash them
  around a rebase and pop after.
- ntfy: agent-tasks after the push, agent-releases only after Release
  CI succeeds. Both sent for v0.4.204 already.
- Solid note: the palette's open-reset uses `createEffect` on
  `props.open` (not `onMount` — props are reactive getters, mount runs
  once).
