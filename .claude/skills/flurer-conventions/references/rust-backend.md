# Rust backend conventions

## Command shape

Every command follows the shape already used by `get_wallpaper` in `src-tauri/src/network/mod.rs`:

```rust
#[tauri::command]
pub async fn list_directory(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    // ...
    Ok(results)
}
```

Rules of thumb:

- Return `Result<T, String>`. Tauri serializes `Err` into a JS exception the frontend catches — this is the *only* error channel the frontend sees, so don't panic or `.unwrap()` inside a command; a panic there takes the whole app down, not just the one call.
- Convert every fallible operation with `.map_err(|e| e.to_string())` at the point of failure, rather than bubbling a custom error type through `?` unconverted — keeps error messages meaningful without needing a shared error enum.
- Structs returned to the frontend need `#[derive(Debug, Clone, Serialize, Deserialize)]` (see `Wallpaper`/`WallpaperUrls`/`WallpaperAuthor`). Field names are camelCase on the TS side automatically via serde's default — don't add `#[serde(rename_all = "camelCase")]` unless the Rust field names actually use snake_case multi-word identifiers that need it (check what the existing structs do before adding new attributes).
- If a command is a distinct domain (filesystem browsing, file operations, search) rather than "talking to the network," give it its own module (`src-tauri/src/fs/mod.rs`, `src-tauri/src/search/mod.rs`) instead of piling everything into `network/`. Declare it in `lib.rs` with `mod fs;` alongside the existing `mod` list.

## State and config

`src-tauri/src/state/mod.rs`:

```rust
pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config: Config,
}
```

- Anything a command needs to *mutate* goes behind `Mutex<T>` (or `RwLock<T>` if reads will vastly outnumber writes — e.g. a large in-memory file-list cache that's rebuilt occasionally but read on every keystroke of a filter box).
- Anything read-only for the process lifetime (API keys, computed capabilities) doesn't need a lock — see `Config`.
- `Config::load()` (`src-tauri/src/configs/mod.rs`) reads from `.env` via `dotenv` and `env::var(...).expect(...)`. Follow this for any new required environment-based setting: fail fast at startup with a clear `.expect()` message rather than letting a command fail confusingly later.

`src-tauri/src/helpers/settings.rs` is the pattern for anything the *user* changes and expects to persist across launches:

```rust
pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let temp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&temp, data).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())?;
    Ok(())
}
```

The write-to-temp-then-rename is deliberate: a crash or force-quit mid-write can't corrupt `settings.json`, since `rename` is atomic on both Windows and POSIX. Reuse `load_settings`/`save_settings` for new persisted fields (add them to the `Settings` struct) rather than writing a second settings file with its own I/O.

## Permissions & capabilities

`src-tauri/capabilities/default.json` whitelists what the webview is allowed to call:

```json
{
  "permissions": ["core:default", "opener:default"]
}
```

When a feature needs filesystem access, add the specific plugin permission needed rather than the broadest one available — e.g. scope `fs:allow-read-dir` / `fs:allow-read` (or the plugin's scoped variants that restrict to specific directories) instead of a wildcard "allow everything under fs." Two reasons this matters more here than in a typical app:

1. **Security** — a file manager is inherently a program that touches arbitrary user files; least-privilege scoping limits the blast radius of any webview-side bug (e.g. an XSS in a rendered file preview).
2. **Staying lightweight** — narrower capabilities keep Tauri's permission-checking surface small and make it obvious, from reading one JSON file, exactly what the app can touch. That legibility is part of "small and efficient," not just a security nicety.

If you're adding a new Tauri plugin (e.g. `tauri-plugin-fs`, `tauri-plugin-dialog`), add it to `Cargo.toml`, register it with `.plugin(...)` in `lib.rs`'s builder chain next to `tauri_plugin_opener::init()`, and add its specific permissions to `capabilities/default.json` — don't skip the capabilities update; an unregistered permission fails silently as a runtime denial, not a compile error.
