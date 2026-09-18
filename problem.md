# Problem: Rename editor closes immediately on "New folder" — RESOLVED

## Symptom

1. Right-click in the file list → **New folder**
2. The folder is created, the inline rename input appears
3. It **instantly closes on its own** — no user input, and the selection is dropped

Related report (same input component): after pressing **F2** on a folder, the
rename input did not take focus or select its text, and pressing **Enter**
committed the rename *and* opened the folder. (Fixed in v0.4.182/0.4.183.)

## Root cause (confirmed by headless-Chromium repro, no user log needed)

Two stacked defects, each sufficient on its own:

1. **`<For>` row identity was defeated one layer up.** The v0.4.184 fix made
   silent relists reuse unchanged `DirEntry` objects — but `<For>` iterates
   `visibleItems()`, whose elements come from `flatItems()`, and that memo
   minted **brand-new `{ kind: "row", entry }` wrapper objects on every
   recompute**. `<For>` keys by item identity, so any entries-array
   replacement tore down and rebuilt every row regardless of entry reuse.
   The trigger in the new-folder flow: the `directory-changed` watcher
   (250 ms debounce in dirwatch.rs) fires right after `create_folder`,
   starting a silent relist that lands just after the rename input opens.

2. **The v0.4.185 blur guard measured the wrong thing.** It assumed Chromium
   reports `isConnected === false` when a focused element's row is removed.
   Empirically (headless Chromium, plain-DOM control): removal-blur fires
   with **`isConnected === true`** — Blink clears focus and dispatches blur
   before detachment settles (`activeElement` is already `BODY`). So the
   teardown blur passed the guard and `commitRename("blur")` ran, closing
   the editor permanently (a no-op rename, since the name was unchanged).

Sequence: New folder → input opens and focuses → +250 ms silent relist →
rows torn down (defect 1) → focused input's blur commits (defect 2) →
`renamingPath` cleared → editor gone.

## Fix (v0.4.187)

- **`rowItemFor()` + `WeakMap<DirEntry, FlatItem>`** cache row wrappers per
  entry object, so identity-preserving relists produce an identical item
  sequence and `<For>` touches no DOM at all. Headers stay uncached (their
  `count` is read once at render; rebuilding a header row is harmless).
  Side benefit: streamed multi-chunk appends and background folder-size
  resolutions (size sort) no longer rebuild the whole list either.
- **Blur commit is gated on cause, not timing**: every listing replacement
  goes through `replaceEntries()`, which sets a `replacingEntries` flag for
  the exact synchronous teardown window; the input's `onBlur` commits only
  when the flag is clear (a genuine click/tab away). Teardown blurs can no
  longer commit regardless of what `isConnected` reports.
- **Commit-on-navigation parity**: the `props.path` effect now commits any
  in-progress rename (untracked) before the listing is swapped, since the
  flagged teardown deliberately doesn't — previously that commit happened
  accidentally via the broken blur guard. `commitRename`'s unchanged-name
  check now compares against `baseName(path)` so it still skips no-op
  renames after `entries()` has been cleared.
- The temporary `[rename-debug]` instrumentation (v0.4.186) is removed.

## Verification

Headless-Chromium repro of the exact component mechanics (real Solid
1.9.13 `For`, streamed chunk, then silent swap with entry reuse):

- Unfixed: `blur connected=true` → `commitRename(blur)` → input gone.
- Flag guard only: teardown blur skipped, input rebuilt and refocused.
- Wrapper cache only (and both): no blur at all, input never touched.

## History: attempted fixes (all shipped, none resolved it)

- **v0.4.182** — ref-based focus/select + `stopImmediatePropagation` on the
  input's keydown (fixed Enter-also-opens-folder).
- **v0.4.183** — deferred focus one microtask (refs run pre-insertion).
- **v0.4.184** — reuse unchanged `DirEntry` objects on silent relist
  (defeated by the wrapper layer, defect 1).
- **v0.4.185** — skip blur-commit when `!isConnected` (always true at
  removal-blur, defect 2).
- **v0.4.186** — diagnostic `[rename-debug]` tracing (removed in v0.4.187).
