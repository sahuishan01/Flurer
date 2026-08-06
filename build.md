# Build & Packaging

How Flurer is versioned, packaged, and released. This is the reference for
the packaging *config itself* — for the release checklist (bump → tag →
push → verify), see the `flurer-conventions` skill or `AGENTS.md`.

## Targets

Windows only, produced by `bun run tauri build` via `tauri-plugin-*` and
the bundlers configured in `src-tauri/tauri.conf.json` (`bundle.targets:
"all"`):

| Bundle | Installer | Install scope |
|---|---|---|
| NSIS | `src-tauri/target/release/bundle/nsis/*.exe` | User's choice at install time (see below) |
| MSI (WiX) | `src-tauri/target/release/bundle/msi/*.msi` | Per-machine (fixed) |

Both are built by CI on every tagged release and attached to the GitHub
Release (`.github/workflows/release.yml`).

**If you want the per-user/per-machine choice, download the `.exe`, not
the `.msi`.** The MSI has no such choice — see below. The in-app updater
(`check_for_updates` in `src-tauri/src/updater.rs`) always prefers the
`.exe` asset for this reason; it only falls back to `.msi` if a release
genuinely has no `.exe` attached.

## Install scope (per-user vs. per-machine)

The NSIS installer is configured with:

```json
"bundle": {
  "windows": {
    "nsis": { "installMode": "both" }
  }
}
```

`installMode: "both"` makes the NSIS installer prompt the user to choose
**"Install for me only"** (no admin required, installs to
`%LOCALAPPDATA%`) or **"Install for all users"** (installs to
`Program Files`, requires elevation) — rather than hardcoding one. The
other valid values are `"currentUser"` and `"perMachine"`, which skip the
prompt and always pick that scope.

The MSI/WiX bundle does not have an equivalent toggle in Tauri's config —
it always installs per-machine. If a per-user MSI is ever needed, it
requires hand-authoring WiX fragments, which we haven't done since the
NSIS installer already covers the per-user case. **Don't add an
`installMode`-style key under `bundle.windows.wix` expecting it to work —
it doesn't exist.**

## Icons

All platform icon files under `src-tauri/icons/` (`.ico`, `.icns`, the
`Square*Logo.png` / `StoreLogo.png` set, and the loose PNGs) are
**generated, not hand-edited**. The single source of truth is a 1024×1024
PNG or SVG with transparency — regenerate the whole set from it with the
Tauri CLI:

```bash
cd src-tauri
npx tauri icon path/to/source-icon.png
```

This also generates `icons/ios/` and `icons/android/` directories, which
Flurer doesn't target (Windows-only) — **delete those two directories
after running the command**; they're not referenced by `tauri.conf.json`
and would otherwise sit in the repo as dead weight.

`bundle.icon` in `tauri.conf.json` only lists the subset actually
referenced for Windows bundling:

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

(`icon.icns` is listed for cross-platform consistency even though this is
a Windows-only build; it costs nothing to keep and saves a config change
if a macOS target is ever added.)

## Versioning

Four files must always carry the **same** version string — nothing reads
a single source of truth for this, so drift between them silently breaks
either the app's reported version or the release tag:

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/Cargo.lock` → the `flurer` package's `version` (mirrors
  `Cargo.toml`; only needs a manual edit because we can't run `cargo
  update` in every environment — see below)
- `src-tauri/tauri.conf.json` → `"version"` (this is what ships as the
  installed app's version number, e.g. in Windows' "Apps & Features")

Bump all four together, in the same commit, before tagging. See
`flurer-conventions`'s Release & Version Bump Workflow for the full
sequence (build check → bump → commit → tag → push → verify CI).

## CI

- **`.github/workflows/build.yml`** — runs on every push/PR to `main`.
  Frontend build + `tauri build` as a compile sanity check. Does not
  publish anything.
- **`.github/workflows/release.yml`** — runs on `v*` tag push. Builds on
  `windows-latest`, installs NSIS via Chocolatey, runs `bun run tauri
  build`, and publishes both bundle artifacts to a GitHub Release named
  after the tag.

Both install the Rust `stable` toolchain (`dtolnay/rust-toolchain@stable`)
rather than pinning a version — there is no MSRV floor enforced for this
project currently.

## Local build limitations

`cargo check`/`cargo build` for the full Tauri app **cannot run on a
plain Linux dev box** without the GTK/WebKitGTK dev libraries Tauri's
Linux target links against (`glib-2.0 >= 2.70`, `gobject-2.0`, etc.) —
this is a Linux-target requirement of the `tauri` crate itself, unrelated
to the fact that Flurer only ships Windows builds. If those aren't
installed system-wide (and this repo doesn't assume they are), local
`cargo check` fails at a `gtk-sys`/`glib-sys` build script before it gets
anywhere near this project's own code.

When that happens: verify new Rust code by extracting it into a scratch
crate with matching dependencies (no `tauri` dependency, just the crates
actually exercised) and `cargo check` that in isolation, then rely on CI's
`windows-latest` runner — which has the real MSVC toolchain and no GTK
dependency — as the actual compile gate.
