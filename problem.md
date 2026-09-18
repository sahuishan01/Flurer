# Problem: Rename editor closes immediately on "New folder"

## Symptom

1. Right-click in the file list → **New folder**
2. The folder is created, the inline rename input appears
3. It **instantly closes on its own** — no user input, and the selection is dropped

Related report (same input component): after pressing **F2** on a folder, the
rename input did not take focus or select its text, and pressing **Enter**
committed the rename *and* opened the folder.

## Affected code

- `src/components/FileList.tsx`
  - `createNewEntry()` — creates the folder, calls `refresh()`, then sets
    `renamingPath` / `renameValue`
  - `commitRename()` / `cancelRename()` — the only places that clear `renamingPath`
  - The rename `<input>` — ref-based focus/select, `onKeyDown` Enter/Escape,
    `onBlur` → `commitRename`
  - `handleDirectoryChunk()` / `startStreamedListing()` — streamed listings and
    the `directory-changed` silent relist
  - `handleKeyDown()` (document-level) — Enter opens the selected folder
- `src/components/ContextMenu.tsx` — context menu (no focus restoration found)

## Key architectural facts

- `refresh()` returns immediately for plain listings; rows stream in via
  `directory-chunk` events. Chunk `seq === 0` **replaces the whole entries
  array** with brand-new `DirEntry` objects.
- Solid's `<For>` keys rows by **reference**, so any relist that produces new
  entry objects tears down and rebuilds every row — including the row holding
  the rename input.
- The rename input commits/closes on `blur`.
- A document-level `keydown` listener (same node as Solid's delegated events)
  handles Enter → open folder; it already skips when an `<input>` has focus.

## Attempted fixes (all shipped, none resolved the new-folder case)

### v0.4.182 — focus + stopImmediatePropagation
- Replaced `autofocus` (no-op for dynamically inserted elements) with a ref
  that focuses and preselects the base name.
- Changed the input's `onKeyDown` from `stopPropagation()` to
  `stopImmediatePropagation()` because the global keydown listener shares the
  `document` node with Solid's delegated handler.
- Result: Enter-no-longer-opens-folder logic was correct, but focus still
  didn't land.

### v0.4.183 — deferred focus
- Solid runs ternary refs **before** the node is inserted into the DOM;
  `focus()` on a disconnected element is a silent no-op. Deferred
  `focus()` + `setSelectionRange()` one microtask via `queueMicrotask`.
- Result: F2 focus reportedly fixed the click-to-focus complaint, but the
  new-folder editor still closed immediately.

### v0.4.184 — reuse unchanged DirEntry objects on silent relist
- Theory: the `directory-changed` watcher's silent relist rebuilt all rows,
  unmounting the focused input; blur fired; `commitRename` closed the editor.
  Reused previous entry objects when name/path/isDir/size/modified are
  unchanged so `<For>` keeps those rows' DOM alive.
- Result: still closes. The new folder's own entry is always a new object, so
  its row can still be rebuilt.

### v0.4.185 — ignore blur caused by unmount
- Chromium fires `blur` when a focused element is removed from the DOM. Blur
  handler now only commits if `e.currentTarget.isConnected` is true.
- Result: still closes — so either the blur fires while the input is still
  connected (something else steals focus), or the close is not caused by blur
  at all.

### v0.4.186 — diagnostic build (current)
- Added temporary `[rename-debug]` tracing via `log_frontend` (lands in the
  Rust file log at `%LOCALAPPDATA%\.flurer\logs`) covering:
  - input ref mount (`connected=` …) and focus result
    (`activeElementIsInput=` …)
  - `blur connected=… activeElement=…`
  - `commit(enter|blur|unknown)` with path and new name
  - `cancel (Escape)`
  - directory-chunk arrivals (`seq`, `silent`, entry count) while a rename is
    open
  - `createNewEntry` completion and `renamingPath` assignment
- **Awaiting a reproduction log from the user.**

## Remaining hypotheses

1. **Something steals focus from the input** while it is still connected
   (blur commits). Candidates: the undo toast, a second relist remount, the
   context menu unmount timing, or focus restore logic elsewhere in the app.
2. **A leaked key event** (Enter/Escape reaching the input's handler) — would
   show as `commit(enter)` / `cancel (Escape)` in the trace with no user input.
3. **The input's row unmounts and never remounts** — e.g. a relist produces a
   `DirEntry.path` for the new folder that differs from the `newPath` returned
   by `create_folder` (separator/case normalization), so
   `renamingPath() === entry.path` never matches again.
4. **Multiple `FileList` instances** (tabs/split view) — an instance-specific
   stream or watcher interfering despite per-instance `streamId` keys.

## Next steps

1. Get the `[rename-debug]` lines from the newest log in
   `%LOCALAPPDATA%\.flurer\logs` after one reproduction of the bug.
2. The trace directly discriminates the hypotheses:
   - `commit(blur) connected=true` → focus theft; find the focus stealer
   - `commit(enter)` / `cancel` → leaked key event; fix key routing
   - no commit/cancel but editor gone → row unmount/path mismatch; log the
     relisted path vs `newPath`
   - `chunk seq=0` arriving right after `setting renamingPath` → the streamed
     listing is rebuilding rows under the editor
3. Once fixed, remove the `[rename-debug]` instrumentation
   (`renameDebug` helper and its call sites) and ship a clean release.
