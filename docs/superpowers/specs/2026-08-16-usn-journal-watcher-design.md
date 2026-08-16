# NTFS USN Journal watcher for live folder-size updates

Status: implemented (unverified on Windows — see Testing/Verification below), decided via brainstorming 2026-08-16.

## Problem

Idle CPU usage on `flurer.exe` traced to `sizecache`'s `live_folder_size_updates`
watcher: `notify::recommended_watcher` is raw (undebounced), and
`watch_scope()` collapses any browsed folder to its volume root (`C:\`), so
in practice the whole drive is recursively watched via `ReadDirectoryChangesW`
inside the unprivileged main process. Every filesystem event anywhere on
that drive — browser cache, temp files, cloud sync, unrelated background
activity — fires `handle_file_system_event` immediately.

## Decision

Move volume-wide change detection into a separate elevated Windows service,
`flurer-watchd`, that reads the NTFS USN Journal (one journal per volume,
not per folder) instead of holding a recursive notify watch open in the
main process. `flurer.exe` stays unprivileged and talks to the service over
a local named pipe; a working per-folder `notify` watcher remains in-process
as the fallback for non-NTFS volumes and for whenever the service is
unreachable.

### Why a separate process, not elevating the whole app

An always-elevated `flurer.exe` would enlarge the privilege blast radius of
every existing command (delete, move, plugin install, archive extraction)
for a feature that only needs elevated access to open a raw volume handle.
Confined to a small helper, only that helper's surface is elevated.

### Why a Windows Service, not a manifest-forced-admin child process

A manifest-forced-admin exe triggers a UAC prompt on every launch; there is
no way to silently auto-elevate a normal process launch. A Windows Service
started by SCM at boot has no such prompt, satisfying "no popup on every
start."

### Scope: eager, all fixed NTFS volumes, full MFT scan

Per explicit decision: watchd opens every fixed NTFS volume's journal at
startup (not lazily per-browsed-folder) and builds its FRN↔path table via a
full MFT scan up front (`FSCTL_ENUM_USN_DATA`), rather than a bounded table
scoped to only currently-cached folders. Chosen for simplicity and because
the layout needs to generalize to future cross-platform backends (see
below) where "index everything, then filter" is the more portable shape
than "index only what's requested."

### IPC: named pipe, length-prefixed JSON

`watch-protocol` crate defines `ClientMessage`/`ServerMessage` plus framing
(`write_message`/`read_message`, 4-byte LE length prefix + JSON). Shared by
both processes so message shapes can't drift between them.

### Non-NTFS volumes

Not handled by watchd at all — reported as `VolumeStatus::Unavailable`.
`flurer.exe`'s existing `GenericNotifyBackend`-equivalent (the original
per-folder notify watcher, now conditionally skipped only for
`JournalReady` volumes) keeps working for these unchanged. Comments in
`watchd/src/volumes.rs` mark where a filesystem-specific backend (e.g. for
network shares) could later replace that generic fallback.

### Cross-platform shape

The volume→backend selection in `sizecache::start_watching_exact` /
`watchd_client.rs` is deliberately the seam a future macOS (FSEvents) or
Linux (fanotify/inotify) equivalent backend would plug into, without
touching the cache-invalidation logic itself (`enqueue_watcher_recompute`,
`is_cached`) — both existing notify events and journal-sourced events feed
the same path.

## Architecture

```
flurer.exe (unprivileged)                    flurer-watchd (SCM service)
  sizecache::watchd_client                      per fixed NTFS volume:
    - connect/reconnect loop        <— pipe —>    1. MFT scan -> FRN<->path
    - Hello/UpdateScope (watch                    2. FSCTL_QUERY/READ_
      scope = cached folder paths)                   USN_JOURNAL poll loop
    - PathChanged -> is_cached +                  3. resolve + push
      enqueue_watcher_recompute                      PathChanged / VolumeStatus
    - VolumeStatus::JournalReady ->
      unwatch that volume's local
      notify root
  sizecache's existing notify watcher (unchanged): still runs for non-NTFS
  volumes and any NTFS volume not yet JournalReady.
```

## Known gaps (explicit, not silent)

- ~~No security descriptor on the named pipe~~ — fixed 2026-08-16 after a
  background security review flagged it (HIGH: local privilege escalation
  via an unrestricted duplex pipe on an elevated service). The pipe now
  carries an SDDL DACL (`D:(A;;GRGW;;;IU)` — read/write limited to the
  INTERACTIVE SID) plus `PIPE_REJECT_REMOTE_CLIENTS`, built per-instance in
  `create_pipe_instance` (`pipe_server.rs`).
- `poll_loop` returning (journal ID changed) does not yet trigger an
  automatic MFT rescan + resubscribe; the affected volume just stops
  reporting until watchd restarts (flagged inline in `volumes.rs`).
- A volume dropping from `JournalReady` back to `Scanning`/`Unavailable`
  doesn't proactively resume the local notify watcher for its
  already-cached roots; a revisit self-heals it via `start_watching`'s
  cache-hit path (flagged inline in `watchd_client.rs`).
- `record_root`'s evictions aren't proactively sent to watchd as
  `UpdateScope` removals (imprecision only, not a correctness bug — see
  inline comment).
- No CI/build wiring yet to produce `target/release/flurer-watchd.exe`
  before `tauri.conf.json`'s resource bundling step expects it.

## Testing / verification status

- `watch-protocol` crate: fully unit-tested, compiles and passes on this
  (Linux) dev environment — no OS-specific code.
- `flurer-watchd` crate: Windows-only code (`mft.rs`, `journal.rs`,
  `pipe_server.rs`, `volumes.rs`, `service.rs`) is `#[cfg(windows)]`-gated
  and **has not been compiled** in this environment (Linux, no Windows
  target/toolchain available). Struct/constant names for the raw USN
  Journal Win32 API (`windows-sys` paths) are written from documented API
  shapes, not verified against the crate. Must be compiled and exercised
  on a real Windows machine before shipping.
- `flurer` (main app) changes in `sizecache/`: could not be checked at all
  in this environment — the pre-existing Linux dev box is missing GTK/glib
  headers Tauri's own Linux build needs (unrelated to this change; the app
  targets Windows), so `cargo check` fails before reaching this crate's own
  source. Reviewed by hand for type/signature consistency with the rest of
  `sizecache/mod.rs` instead.
- NSIS installer hook (`installer/watchd-service-hooks.nsh`): hook macro
  names match Tauri v2's NSIS template as documented, not exercised by an
  actual `tauri build` here (no NSIS toolchain in this environment).
