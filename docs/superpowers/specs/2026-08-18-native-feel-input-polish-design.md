# Native-feel input polish — design

## Purpose

Flurer currently behaves like a web page for basic pointer interactions,
which breaks the illusion of a native Windows file manager:

1. **Text selection**: nothing sets `user-select: none` app-wide, so
   double-clicking a filename, dragging across rows, or dragging across
   sidebar/tab labels highlights text like a browser page instead of
   selecting rows the way Explorer does.
2. **Cursor**: row content in `FileList` has no `cursor: default` override,
   so hovering filename text shows the browser's text (I-beam) cursor
   instead of the default arrow/pointer Explorer shows over list rows.
3. **No marquee select**: pressing and dragging from empty space in the
   file list does nothing today — Explorer/Finder open a dashed
   rubber-band rectangle that multi-selects any row it touches.

This is a frontend-only polish pass (SolidJS + CSS); no backend/Rust
changes, no changes to the existing row press-drag-to-move/copy gesture
(`handleRowMouseDown` / `startRowDrag` in `FileList.tsx`), which continues
to fire when the press starts on a row.

## 1. Global text-selection lockdown, with explicit opt-back-in

Add to `App.css`, alongside the existing `body` rule:

```css
body {
  user-select: none;
  -webkit-user-select: none;
}
```

Then re-enable selection only where copying text out is genuinely useful:

- The path/breadcrumb bar (`ExplorerPathBar.tsx`'s rendered path segments)
- `PropertiesDialog`'s value cells (path, size, dates, etc.)
- Any free-form error/log text blocks (`file-list-error`,
  `file-list-notice-details`, plugin/update log output)

via a shared utility class, e.g.:

```css
.selectable-text {
  user-select: text;
  -webkit-user-select: text;
}
```

applied to those specific elements. Filenames in `FileList` rows stay
non-selectable — consistent with Explorer, where getting a name out means
F2 rename or right-click → Copy, both of which Flurer already supports via
the context menu / inline rename.

Existing explicit `user-select: none` rules elsewhere in `App.css` (drag
handles, graph nodes, etc.) become redundant once the `body` default is in
place, but are left alone rather than pruned — no behavior change, and
removing them is unrelated cleanup.

## 2. Row cursor correctness

Add `cursor: default` to the file-list row (`tr`)/cell rule in `App.css` so
hovering over filename or metadata text shows the default arrow rather than
the browser's text-selection I-beam. This does not touch cells/elements
that already set `cursor: pointer` (sortable column headers, tabs, sidebar
items, toolbar buttons) — those keep their pointer cursor since they're
genuinely clickable.

## 3. Marquee (rubber-band) multi-select

Add drag-to-select in `FileList.tsx` when a press starts on empty list
background rather than on a row:

- A `mousedown` handler on the `file-list-table-wrap` container (not on
  individual `tr`s, which already own `handleRowMouseDown`) records the
  start point and, past a small move threshold (matching the existing
  4px threshold used for row-drag), begins tracking.
- While tracking, render an absolutely-positioned dashed-border div sized
  to the rectangle between the start point and current pointer position
  (a new `marqueeRect` signal drives its `style`).
- On each `mousemove`, compute which row elements' bounding boxes
  intersect the rectangle (`getBoundingClientRect` per row, compared
  against the marquee rect) and set `selected()` to that set — replacing
  the selection outright, matching Explorer (no union with prior
  selection unless Ctrl is held, matching the existing ctrl-click-to-toggle
  convention already used in `handleRowClick`).
- On `mouseup`, stop tracking and remove the marquee div; the resulting
  `selected()` set is left as-is (already updated live during the drag).
- Starting a marquee clears any in-progress rename (mirrors the existing
  `renamingPath()` guard in `handleRowMouseDown`).

The marquee div itself needs `pointer-events: none` so it never intercepts
the `mousemove`/`mouseup` listeners attached to `document`.

## Testing

- Manual verification (no automated UI test harness for pointer gestures
  in this repo): double-click and drag-select over filenames, sidebar
  entries, and tab titles no longer highlight text; path bar and
  properties dialog text remains selectable; hovering rows shows the
  default cursor; dragging from empty list space draws a marquee and
  selects intersected rows; dragging from a row still starts an OS
  move/copy drag, unaffected.
