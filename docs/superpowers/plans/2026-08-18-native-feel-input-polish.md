# Native-Feel Input Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flurer's pointer interactions feel like a native Windows file manager instead of a web page — no browser-style text highlighting on double-click/drag, a correct default cursor over file rows, and Explorer-style rubber-band multi-select when dragging from empty list space.

**Architecture:** Frontend-only (SolidJS + CSS). `App.css` gets a global `user-select: none` default with a few call sites opted back into `user-select: text`. `FileList.tsx` gets a `cursor: default` row rule and a new marquee-select interaction layered next to the existing row-drag-to-move/copy gesture, sharing its 4px move threshold and its `document`-level mousemove/mouseup listener pattern.

**Tech Stack:** SolidJS (signals, `createSignal`), plain CSS (no CSS-in-JS in this repo), native DOM APIs (`getBoundingClientRect`) — no new dependencies.

## Global Constraints

- Frontend-only change; no Tauri command, `AppState`, or capability changes.
- Follow existing repo conventions: no `.map()` in JSX for lists (already satisfied, no list-rendering changes here), CSS lives in `App.css` alongside the rules it's modifying, no new files unless a task calls for one.
- The existing row press-and-drag gesture (`handleRowMouseDown` → `beginRowDrag` → `startRowDrag`, `FileList.tsx:896-947`) must keep working unchanged — marquee-select only activates when the press starts on empty background, never on a row.
- Per repo convention (`flurer-conventions` skill, "Release & Version Bump Workflow"): after this plan's tasks are complete and committed, run `bun run build` to verify the frontend compiles, then bump the version across `package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json`, commit, push, tag `vX.Y.Z`, push the tag, and monitor the GitHub Actions run to completion before considering the release done.

---

### Task 1: Global text-selection lockdown with explicit opt-back-in

**Files:**
- Modify: `src/App.css:85-88` (the `body` rule), and add new rules near it
- Modify: `src/components/ExplorerPathBar.tsx:117` (`explorer-path-bar` div) — no code change needed here, only CSS targets this class
- Modify: `src/components/PropertiesDialog.tsx` — no code change needed, only CSS targets `.properties-value`
- No test file: this is a CSS/manual-verification change (no automated UI pointer-interaction test harness exists in this repo, matching prior UI polish plans in this repo)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks — Task 3 (marquee) is independent of this task's CSS.

- [ ] **Step 1: Add the app-wide `user-select: none` default**

In `src/App.css`, the existing `body` rule is:

```css
body {
    background-color: transparent;
    color: var(--text-color);
}
```

Change it to:

```css
body {
    background-color: transparent;
    color: var(--text-color);
    user-select: none;
    -webkit-user-select: none;
}
```

- [ ] **Step 2: Add a reusable `.selectable-text` opt-back-in class**

Directly below the `body` rule in `src/App.css`, add:

```css
/* Explicit opt-in for the few surfaces where copying text out is useful —
   everything else stays non-selectable so double-click/drag reads as row
   selection, not browser text highlighting (see docs/superpowers/specs/
   2026-08-18-native-feel-input-polish-design.md). */
.selectable-text {
    user-select: text;
    -webkit-user-select: text;
}
```

- [ ] **Step 3: Apply `.selectable-text` to the path bar, properties values, and error/notice text**

In `src/components/ExplorerPathBar.tsx:117`, change:

```tsx
<div class="explorer-path-bar" ref={containerRef}>
```

to:

```tsx
<div class="explorer-path-bar selectable-text" ref={containerRef}>
```

In `src/components/PropertiesDialog.tsx`, every `class="properties-value"` (and `class="properties-value properties-size-row"`) becomes `class="properties-value selectable-text"` (and `class="properties-value properties-size-row selectable-text"` respectively) — there are 6 occurrences (lines 53, 58, 61, 66, 83, 90, 97 per current file; verify by re-grepping `class="properties-value` before editing since line numbers may have shifted).

In `src/components/FileList.tsx`, find the error/notice elements and add `selectable-text`:
- `class="file-list-error"` → `class="file-list-error selectable-text"` (there are two occurrences: the top-level `error()` paragraph and the `adminRelaunchError()`/`opError()` paragraphs — apply to all `file-list-error` elements)
- `class="file-list-notice-details"` → `class="file-list-notice-details selectable-text"`

- [ ] **Step 4: Manual verification**

Run `bun run tauri dev` (or `bun run dev` if a browser preview is faster for this check). Confirm:
- Double-clicking a filename in the file list no longer highlights text.
- Click-dragging across sidebar entries, tab titles, or toolbar buttons no longer highlights text.
- Click-dragging across the path bar breadcrumb text, or a Properties dialog value (e.g. the Location row), still selects text normally.
- Any visible error banner text (trigger one by e.g. trying an operation that fails, or skip if none easily reproducible) remains selectable.

- [ ] **Step 5: Commit**

```bash
git add src/App.css src/components/ExplorerPathBar.tsx src/components/PropertiesDialog.tsx src/components/FileList.tsx
git commit -m "fix: disable browser-style text selection app-wide, opt back in where copying is useful"
```

---

### Task 2: Row cursor correctness

**Files:**
- Modify: `src/App.css:1779-1785` (`.file-row-dir`, `.file-row:hover` block)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `cursor: default` to `.file-row`**

Current CSS:

```css
.file-row-dir {
    cursor: pointer;
}

.file-row:hover {
    background-color: var(--hover-bg);
}
```

Change to:

```css
.file-row {
    cursor: default;
}

.file-row-dir {
    cursor: pointer;
}

.file-row:hover {
    background-color: var(--hover-bg);
}
```

(`.file-row-dir` is added to a row's `classList` alongside the base `file-row` class — see `FileList.tsx:1205-1211` — so the more specific `.file-row-dir` selector still wins for directory rows and keeps its pointer cursor; file rows fall back to the new `.file-row` default-cursor rule.)

- [ ] **Step 2: Manual verification**

In the running dev build, hover over a file name and a folder name in the file list. Confirm the file row shows the default arrow cursor (not a text I-beam) and the folder row still shows a pointer cursor. Confirm sortable column headers, tabs, and sidebar entries are unaffected (still show pointer where they did before).

- [ ] **Step 3: Commit**

```bash
git add src/App.css
git commit -m "fix: use default cursor over file rows instead of browser text cursor"
```

---

### Task 3: Marquee (rubber-band) multi-select

**Files:**
- Modify: `src/components/FileList.tsx` (add marquee state, handlers, and the marquee div render)
- Modify: `src/App.css` (add `.marquee-select` rule)

**Interfaces:**
- Consumes: `selected` (existing `createSignal<Set<string>>`, declared earlier in `FileList.tsx` and used by `handleRowClick`/`handleRowMouseDown`/rendering), `sortedEntries()` (existing accessor returning the currently displayed, ordered `DirEntry[]`), `renamingPath()` (existing signal used as a rename-in-progress guard, see `handleRowMouseDown`'s existing check at `FileList.tsx:897`).
- Produces: no new exports — this task is self-contained inside `FileList.tsx`.

- [ ] **Step 1: Add marquee state**

Near the top of the component body in `FileList.tsx`, alongside the other `createSignal` declarations (e.g. near where `selected`/`lastClickedIndex` are declared), add:

```ts
const [marqueeRect, setMarqueeRect] = createSignal<{ x: number; y: number; width: number; height: number } | null>(null);
```

- [ ] **Step 2: Add the background mousedown handler**

Directly below `handleRowMouseDown` (after its closing brace, `FileList.tsx:916`), add:

```ts
// Starts an Explorer-style rubber-band selection when the press begins on
// empty list background rather than on a row (handleRowMouseDown above
// owns the row-press case and takes priority since it's bound directly to
// each <tr>). Uses the same 4px move threshold and document-level
// mousemove/mouseup pattern as the row-drag handler above for consistency.
function handleListMouseDown(e: MouseEvent) {
  if (e.button !== 0 || renamingPath() !== null) return;
  const wrap = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startY = e.clientY;
  const additive = e.ctrlKey || e.metaKey;
  const baseSelection = additive ? new Set(selected()) : new Set<string>();
  let started = false;

  function rectFrom(ev: MouseEvent) {
    const x = Math.min(startX, ev.clientX);
    const y = Math.min(startY, ev.clientY);
    const width = Math.abs(ev.clientX - startX);
    const height = Math.abs(ev.clientY - startY);
    return { x, y, width, height };
  }

  function applySelection(rect: { x: number; y: number; width: number; height: number }) {
    const next = new Set(baseSelection);
    const rows = wrap.querySelectorAll<HTMLElement>("tr[data-row-path]");
    rows.forEach((row) => {
      const box = row.getBoundingClientRect();
      const intersects = box.left < rect.x + rect.width && box.right > rect.x && box.top < rect.y + rect.height && box.bottom > rect.y;
      if (intersects) {
        const path = row.dataset.rowPath;
        if (path) next.add(path);
      }
    });
    setSelected(next);
  }

  function onMove(ev: MouseEvent) {
    if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
    started = true;
    const rect = rectFrom(ev);
    setMarqueeRect(rect);
    applySelection(rect);
  }
  function cleanup() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", cleanup);
    setMarqueeRect(null);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", cleanup);
}
```

Note: `applySelection` intersects viewport-space rectangles (`getBoundingClientRect`), so it stays correct regardless of the wrap's scroll position — no coordinate translation is needed since both the marquee rect and row boxes come from the same viewport-space `clientX/clientY`/`getBoundingClientRect` origin.

- [ ] **Step 3: Wire the handler onto the scrollable list container, and skip it when the press started on a row**

Find the `file-list-table-wrap` div (`FileList.tsx:1343`, `<div class="file-list-table-wrap">`) and add the mousedown handler:

```tsx
<div class="file-list-table-wrap" onMouseDown={handleListMouseDown}>
```

Because `<tr>` already has its own `onMouseDown={(e) => handleRowMouseDown(e, entry)}` (`FileList.tsx:1216`), and DOM mousedown events bubble by default, a press starting on a row fires `handleRowMouseDown` first and then bubbles up to fire `handleListMouseDown` on the wrap too. Add `e.stopPropagation()` as the first line inside `handleRowMouseDown` (right after its existing early-return guard) so a press starting on a row never also triggers `handleListMouseDown`:

```ts
  function handleRowMouseDown(e: MouseEvent, entry: DirEntry) {
    if (e.button !== 0 || renamingPath() === entry.path) return;
    e.stopPropagation();
    const startX = e.clientX;
    ...
```

(only the new `e.stopPropagation();` line is added, right after the existing early-return guard.)

- [ ] **Step 4: Render the marquee rectangle**

Immediately after the `<div class="file-list-table-wrap" ...>` opening tag (before the `<table>` it wraps), add:

```tsx
<Show when={marqueeRect()}>
  {(rect) => (
    <div
      class="marquee-select"
      style={{
        left: `${rect().x}px`,
        top: `${rect().y}px`,
        width: `${rect().width}px`,
        height: `${rect().height}px`,
      }}
    />
  )}
</Show>
```

Since `marqueeRect()` coordinates are viewport-space (`clientX`/`clientY`) but this div is positioned inside `file-list-table-wrap` (a scrolling ancestor), give `.marquee-select` `position: fixed` in its CSS (Step 5) rather than `position: absolute`, so the viewport-space coordinates line up without needing scroll-offset math.

- [ ] **Step 5: Add the `.marquee-select` CSS rule**

In `src/App.css`, near `.file-list-table-wrap` (around line 1497), add:

```css
.marquee-select {
    position: fixed;
    border: 1px dashed var(--accent);
    background-color: color-mix(in srgb, var(--accent) 15%, transparent);
    pointer-events: none;
    z-index: 5;
}
```

- [ ] **Step 6: Manual verification**

In the running dev build:
- Click-drag starting on empty space below the last row (or in the header gutter area within `file-list-table-wrap`) draws a dashed rectangle and selects every row it touches as you drag.
- Releasing the mouse leaves the selection in place and removes the rectangle.
- Ctrl-dragging a marquee adds to the existing selection instead of replacing it.
- Click-dragging starting on a row still starts the existing OS move/copy drag (cursor changes, dragging the row elsewhere still works) and does **not** also draw a marquee.
- A plain click on a single row (no drag) still selects just that row (unaffected by the `stopPropagation` addition, since `handleRowClick` is a separate `onClick` handler, not touched by this change).

- [ ] **Step 7: Commit**

```bash
git add src/components/FileList.tsx src/App.css
git commit -m "feat: add Explorer-style marquee multi-select to the file list"
```

---

### Task 4: Build verification and version bump

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` (version fields only)

**Interfaces:**
- Consumes: the completed changes from Tasks 1-3.
- Produces: nothing (terminal task).

- [ ] **Step 1: Verify the frontend build compiles cleanly**

```bash
bun run build
```

Expected: build succeeds with no errors. If it fails, fix the reported issue in the relevant task's files before proceeding — do not bump the version on a broken build (per `flurer-conventions` skill's release workflow).

- [ ] **Step 2: Bump the version**

Read the current version from `package.json` (`"version"` field), increment the patch number, and apply the same new version string to all four files:

```bash
grep -n '"version"' package.json src-tauri/tauri.conf.json
grep -n '^version' src-tauri/Cargo.toml
grep -n -A1 'name = "flurer"' src-tauri/Cargo.lock
```

Update each occurrence to the new version (patch bump from whatever `package.json` currently shows).

- [ ] **Step 3: Commit, push, tag, and push the tag**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "bump version to <X.Y.Z>"
git push origin main
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

- [ ] **Step 4: Monitor the GitHub Actions release run to completion**

Poll `https://api.github.com/repos/sahuishan01/Flurer/actions/runs?per_page=5` until the `Build` and `Release` runs for the new tag's commit both show `"status": "completed"` and `"conclusion": "success"`. Do not consider this task done until both are confirmed successful.

- [ ] **Step 5: Send the `agent-releases` notification**

Per the user's global instructions, POST to `https://ntfy.algosculptor.com/agent-releases` with a bulleted changelog (text selection lockdown, row cursor fix, marquee multi-select) and the release version, only after the release run above is confirmed successful.
