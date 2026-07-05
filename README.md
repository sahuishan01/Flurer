# Flurer

A lightweight, fast Windows file manager built with [Tauri](https://tauri.app) (Rust) and [SolidJS](https://solidjs.com). Tauri's native OS webview (no bundled Chromium) keeps the binary small and memory usage low compared to Electron-based alternatives.

Filesystem work (directory listing, file operations) lives in Rust and is exposed to the frontend through Tauri commands; the SolidJS UI stays a thin, reactive display layer. See [.claude/skills/flurer-conventions](.claude/skills/flurer-conventions) for the architectural conventions this project follows.

## Development

```sh
bun install
bun run tauri dev
```

Requires an [Unsplash](https://unsplash.com/oauth/applications) access key in `src-tauri/.env` (see `src-tauri/.env.example`) for the wallpaper feature.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
