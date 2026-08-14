# Search UX polish — design

## Purpose

Flurer's search box (filename mode and the new `>text` content mode, see
`docs/superpowers/specs/2026-08-13-content-search-design.md`) has four rough
edges found after content search shipped:

1. Every keystroke re-runs the search immediately. In content mode this is a
   full recursive file-read walk per keystroke.
2. `>` triggering content mode is a hidden feature — no UI hints at it.
3. Neither mode shows a result count or whether the 500-result cap
   (`SEARCH_RESULT_LIMIT`) was hit.
4. Closing the search popover doesn't clear the query — `searchQuery` lives
   in `App.tsx`, independent of the popover's open/closed state — so
   stopping a search means manually selecting and deleting the text.

This is a frontend-only polish pass; no backend/Rust changes.

## 1. Debounce backend calls

`FileList.tsx`'s `createEffect` currently depends on
`props.path, props.sortKey, props.sortDirection, props.searchQuery,
props.searchRecursive` and calls `refresh()` synchronously on any change.

Add a debounced mirror of the search-related props, backed by
`createSignal` + `setTimeout`:

```ts
const [debouncedSearchQuery, setDebouncedSearchQuery] = createSignal(props.searchQuery);
const [debouncedSearchRecursive, setDebouncedSearchRecursive] = createSignal(props.searchRecursive);

createEffect(() => {
  const query = props.searchQuery;
  const recursive = props.searchRecursive;
  const timer = setTimeout(() => {
    setDebouncedSearchQuery(query);
    setDebouncedSearchRecursive(recursive);
  }, 250);
  onCleanup(() => clearTimeout(timer));
});
```

The refresh-triggering effect reads `debouncedSearchQuery()` /
`debouncedSearchRecursive()` instead of the raw props; `refresh()` itself
also switches to reading the debounced signals (not `props.searchQuery`)
wherever it currently reads them for the backend call and the stale-response
guard, so a fast-typed query doesn't fire N backend calls for N keystrokes.

`props.path`, `props.sortKey`, `props.sortDirection` are **not** debounced —
navigation and sort changes stay immediate, only the search-driven refresh is
delayed. The `<input>` in `CommandBar.tsx` is untouched: it still echoes
`props.searchQuery` on every keystroke via existing two-way binding, so
typing feels instant even though the backend call lags 250ms behind.

Edge case: clearing the field to empty should also debounce (avoids a
flash back to the full listing mid-backspace), which falls out of the same
mechanism for free — no special-casing needed.

## 2. `>` discoverability hint

Two small, additive changes in `CommandBar.tsx`:

- Placeholder text changes from `"Search…"` to `"Search… (> for contents)"`.
  Static string, no logic.
- When `props.searchQuery.startsWith(">")`, render a one-line hint below the
  search field inside the popover: `"Searching file contents"`. Reuses the
  existing `.file-list-notice` class (secondary text, already used for the
  unreadable-entries notice in `FileList.tsx` / `App.css`) rather than
  introducing a new style. `CommandBar` doesn't currently know about content
  search — this is the one place that needs a `startsWith(">")` check, kept
  local to the hint (no new prop needed since `searchQuery` is already
  passed in).

## 3. Result count / truncation notice

`FileList.tsx` already computes `entries()` from a `refresh()` call. Add a
one-line status computed via `createMemo`, shown just above the results
`<table>` when `isSearching()` is true:

- `entries().length === 0` → no line (empty state already implied by an
  empty table).
- `entries().length === SEARCH_RESULT_LIMIT` (500, mirrored as a frontend
  constant next to the existing search invoke calls) → `"500+ results —
  refine your search"`. This is a heuristic: hitting exactly 500 is treated
  as "capped," since the frontend has no separate truncation flag from the
  backend and adding one is out of scope for a polish pass.
- Otherwise → `"{n} result{s}"`.

Reuses `.file-list-notice` styling, consistent with item 2's hint and the
existing unreadable-entries notice.

## 4. Clear/stop-search button

Add a small "×" button inside `.search-field` in `CommandBar.tsx`, rendered
only when `props.searchQuery.length > 0`. On click: calls
`props.onSearchQueryChange("")` and refocuses the input. Positioned after the
`<input>`, before the popover's closing tag — same row, standard search-box
placement.

This is additive: the search icon's existing toggle-popover-open/closed
behavior and Escape-to-close are unchanged. The clear button only touches
`searchQuery`, giving a one-click way to drop back to the normal directory
listing without manually selecting text or closing/reopening the popover.

## Testing

Frontend-only change; no new Rust logic, so no new Rust unit tests.
Verification is `npx tsc --noEmit -p .` and `bun run build` staying clean,
plus a manual pass (per the project's existing `run` skill / dev server) for:

- Typing a content-search query doesn't fire a backend call per keystroke
  (observable via the debounce delay before results update).
- Placeholder and inline hint appear/disappear correctly around the `>`
  boundary.
- Result count matches table row count; hitting 500 shows the capped
  message.
- Clear button empties the query and restores the normal directory listing.

## Out of scope

- A real "truncated" flag from the backend (`search_directory`/
  `search_content` returning whether the cap was hit vs. exactly 500 real
  matches) — the `=== 500` heuristic is accepted as good enough here.
- Any change to `search_directory` / `search_content` themselves.
- Debounce timing configurability (250ms is a fixed constant, matching the
  project's general preference for hardcoded v1 constants over new settings
  — see the content-search spec's "Out of scope" section).
