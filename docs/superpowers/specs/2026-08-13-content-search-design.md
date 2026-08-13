# Content search (`>text` mode) — design

## Purpose

Flurer already has recursive/non-recursive filename search (`search_directory`
in `src-tauri/src/fs/mod.rs`, wired through `CommandBar.tsx` and
`FileList.tsx`). It has no way to search *inside* files. This adds a content
search mode reusing the same search box, popover, and results table.

## Trigger & UX

- No new UI controls. Typing `>` as the first character of the search query
  switches the box to content-search mode; everything after `>` is the
  content query (e.g. `>TODO` searches file contents for `TODO`).
- An empty content query (just `>`) shows no results, matching today's
  behavior for an empty filename query.
- The existing **recursive** toggle in `CommandBar.tsx` still applies:
  non-recursive scans only the current folder's files, recursive walks
  subfolders too, using the same walk shape as `search_recursive`.
- Filename matching is bypassed entirely in this mode — only file contents
  are checked.

## Backend

- New Tauri command `search_content(root: String, query: String, recursive: bool) -> Result<Vec<ContentMatch>, String>`
  in `src-tauri/src/fs/mod.rs`, alongside `search_directory`.
- `ContentMatch { entry: DirEntry, line_number: u32, snippet: String }` — one
  row per matching file, first match only (not every matching line), same as
  a typical quick-search tool.
- File filtering before reading a candidate:
  - Skip a fixed deny-list of binary/media extensions (exe, dll, so, zip,
    png, jpg, gif, mp4, pdf, etc.) — a small static slice in `fs/mod.rs`
    unless an existing binary-detection helper already covers this.
  - Skip files over a **5 MB** size cap (checked via metadata before
    reading).
- Read candidate files with `std::fs::read_to_string` (UTF-8 lossy is not
  used — a read that fails due to invalid UTF-8 is treated as a per-file
  failure and skipped, same as a permission error). Case-insensitive
  substring match per line via `to_lowercase().contains()`, mirroring
  `search_directory`'s matching approach.
- Reuses the existing `SEARCH_RESULT_LIMIT` (500) result cap.
- No new crate dependency.

## Frontend

- `FileList.tsx`: when `isSearching()` and the query starts with `>`, call
  `search_content` (with the query stripped of its leading `>`) instead of
  `search_directory`.
- Render an extra line under the filename showing the matched `snippet`
  (truncated) and `line_number`, reusing the existing `.file-location`
  styling used for the folder path column.
- No new component. The existing `Location` column continues to show the
  folder path as it does today.

## Error handling

- Per-file read failures (permission denied, read errors) are skipped
  silently, matching `search_recursive`'s `Ok(...) else continue` pattern.
- Root-not-a-directory error reuses `search_directory`'s existing message
  format.

## Testing

Rust unit tests in `src-tauri/src/fs/mod.rs`, mirroring the existing
`search_directory_*` tests:

- Case-insensitive content match, non-recursive.
- Non-recursive search skips matches in nested files.
- Recursive search finds matches in nested files.
- Files with a deny-listed extension are skipped even if their contents
  would match.
- Files over the 5 MB size cap are skipped even if their contents would
  match.

## Out of scope (v1)

- Multiple snippet lines per matching file (first match only).
- Highlighting the matched substring within the snippet.
- Regex/glob query syntax — plain case-insensitive substring only, same as
  filename search.
- Configurable extension deny-list or size cap (hardcoded constants for v1).
