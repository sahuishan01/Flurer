# Flurer — Handoff: reintroducing the 5 reverted features

Current version: **0.4.106** (tagged, pushed). Features 1, 2, and 3 of 5
shipped and confirmed working by the user. Feature 4 (split view)
shipped as v0.4.106, but the user found a real bug (couldn't type a path
into the second pane) and asked for an N-pane grid instead of a fixed
two-pane split — that rework is implemented and about to ship as
v0.4.107; **not yet confirmed working**, don't treat feature 4 as done
until it is. (v0.4.104 was an unrelated updater fix, not one of the 5
features — see git log.)

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

## Feature 5 — search index (LAST, highest risk, needs a real change)

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

## Current git state

`main` is at v0.4.106 (feature 4, first cut of split view). The N-pane
grid rework is committed on top of that and about to ship as v0.4.107 —
still feature 4, not a new feature slot. Remaining after it's confirmed:
feature 5 (search index), the highest-risk one. This file is the source
of truth for what's left and in what order.
