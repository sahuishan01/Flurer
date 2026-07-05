# SolidJS frontend conventions

## Calling into Rust

The existing pattern in `src/App.tsx`:

```tsx
async function getWallpaper() {
  setWallpaperError("");
  try {
    const result = await invoke<Wallpaper>("get_wallpaper", { query: "nature" });
    setWallpaper(result);
  } catch (err) {
    setWallpaperError(String(err));
  }
}
```

Carry this shape forward for new commands:

- Type the `invoke<T>()` call with a TS type that mirrors the Rust struct field-for-field (see `Wallpaper`/`WallpaperUrls` in `App.tsx` mirroring the Rust types in `network/mod.rs`). There's no codegen here, so when a Rust struct changes, the TS type must be updated by hand in the same change.
- Always wrap `invoke()` in `try/catch`. A rejected Tauri command is a thrown JS value (the `Err(String)` from Rust) — `String(err)` turns it into a displayable message. Don't let it propagate as an unhandled rejection.
- Keep a dedicated error signal per operation (`wallpaperError`) rather than one global error signal — with multiple file operations in flight (a copy, a delete, a listing) a shared error signal makes it ambiguous which operation failed.

## Why fine-grained rendering matters here specifically

Solid's whole pitch over React is that it doesn't re-render components — it updates only the exact DOM nodes whose signal changed. That property is *why* Solid is a good fit for a file manager (potentially thousands of rows updating independently — a rename, a new file appearing, a selection change) instead of React's re-render-the-subtree model. But that benefit only shows up if you write idiomatic Solid rather than React-shaped code:

- **Use `<For>`, not `.map()`, for any list.** `<For each={files()}>{(file) => <Row file={file} />}</For>` keeps a stable DOM node per item keyed by reference/identity and only touches the rows that actually changed. `{files().map(f => <Row file={f} />)}` throws all of that away and rebuilds the whole list on every signal update — the exact React habit that defeats the point of using Solid.
- **Don't destructure props.** `function Row(props: { file: FileEntry })` — access `props.file` directly, or wrap access in a function. Destructuring (`const { file } = props`) breaks reactivity because it reads the value once instead of tracking it.
- **Use `createMemo` for derived/expensive computations** (filtering a file list by a search box, sorting by column) so the work only reruns when its actual dependencies change, not on every render pass.
- **Prefer `createStore` over many separate signals once state has real shape** (e.g. a file entry with `name`, `size`, `modified`, `selected`) — a store gives you fine-grained updates into nested fields without recreating the whole object, which matters when thousands of file objects exist at once.

## Pushing work to Rust instead of JS

If a task involves iterating over "all files" or "all entries," the default should be: ask Rust for the already-processed result, not the raw list. Rust doesn't pay a GC tax and doesn't run on the UI thread, so:

- Filtering/sorting/searching a large directory listing → do it in the Tauri command, return the final list.
- Computing aggregate stats (total size, file counts) → compute in Rust, return the number.
- Only keep in JS state what the current view actually needs to render — don't cache an entire directory tree in a signal "just in case," since that's exactly the kind of memory overhead that fights the "small and efficient" goal.

## File organization

`App.tsx` is currently a single file because the app is still template-sized. As file-manager views get added (a file list pane, a breadcrumb/path bar, a properties panel, a settings dialog), split each into its own component file under `src/` (e.g. `src/components/FileList.tsx`) rather than growing `App.tsx` indefinitely — but don't preemptively split before there's a second view; one small file is fine until it isn't.
