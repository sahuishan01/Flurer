# Flurer

A lightweight, fast, cross-platform file manager built with [Tauri v2](https://tauri.app) (Rust) and [SolidJS](https://solidjs.com). By leveraging native OS webviews (WebKitGTK on Linux, WebView2 on Windows) without bundling Chromium, Flurer maintains a minimal memory footprint and fast startup times.

---

## 🌟 Core Features & Capabilities

- **Cross-Platform Support**: Full native support for **Linux** (`deb`, `rpm`, `AppImage`) and **Windows** (`MSI`, `NSIS` installers).
- **Fast Directory Browsing**: Asynchronous Rust backend file operations with chunked directory streaming, metadata caching, and folder-size calculation.
- **System PATH Integration**: Add `flurer` directly to your system path (`PATH`) on both Linux (`.bashrc`, `.zshrc`, `.profile`) and Windows registry with a single click in Settings.
- **Terminal Emulator Integration**: Launch your preferred terminal (`foot`, `ghostty`, `alacritty`, `kitty`, `konsole`, `gnome-terminal`, `xterm`, or `cmd.exe`) in the currently selected directory.
- **System & Metric Monitoring**: Integrated hardware metrics monitoring (CPU, RAM, GPU, network interfaces) in the customizable top bar.
- **Native Symlink Handling**: Symlinks are safely handled without infinite loop recursion or triggering false-positive access-denied warnings.
- **AI Agent-First Development**: Built-in integration with **GitNexus** graph-based code intelligence for AI agent code navigation (`agy`, `codex`, `claude-code`).

---

## 🛠️ Installation & Building

### Prerequisites

Ensure you have the required system dependencies installed:

#### Linux (Debian/Ubuntu/Arch)
- **Node.js** & **Bun** (`bun`)
- **Rust** & **Cargo** (`rustup`)
- **WebKitGTK** & **GTK3** development libraries:
  - *Ubuntu/Debian*: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
  - *Arch Linux*: `sudo pacman -S webkit2gtk-4.1 base-devel curl wget openssl gtk3 libappindicator-gtk3 librsvg`

#### Windows
- **Rust toolchain**: `x86_64-pc-windows-msvc`
- **Node.js** & **Bun** (`bun`)
- **WiX Toolset** (for building `.msi` installers)

---

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sahuishan01/Flurer.git
   cd Flurer
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Run in development mode**:
   ```bash
   bun run tauri dev
   ```

---

### Production Build

To build release packages locally:

```bash
bun run tauri build
```

The output installers will be generated under `src-tauri/target/release/bundle/`:
- **Linux**: `.deb`, `.rpm`, `.AppImage`
- **Windows**: `.msi`, `.exe` (NSIS)

---

## 📑 Architecture & Code Intelligence

Filesystem operations, background size caching, and native system bindings reside in Rust (`src-tauri/`), exposed to the SolidJS frontend (`src/`) via Tauri IPC commands.

This project is indexed with **GitNexus**. For code navigation and impact analysis:

```bash
# Re-index repository
gitnexus analyze

# Query concept/execution flow
gitnexus query "<concept>"

# Trace blast radius before refactoring
gitnexus impact --target "<symbol>"
```

---

## 🤝 CI/CD & Automated Releases

Cross-platform builds and GitHub releases are managed via GitHub Actions:
- `.github/workflows/build.yml`: Validates Linux and Windows builds on push.
- `.github/workflows/release.yml`: Automatically packages binaries, creates GitHub Releases, and attaches platform installer assets upon tagging (`v*`).
