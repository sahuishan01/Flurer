//! `flurer-watchd` — the elevated Windows service half of live folder-size
//! updates. See docs/superpowers/specs/2026-08-16-usn-journal-watcher-design.md
//! for the full design; in short: this process reads the NTFS USN Journal
//! for every fixed volume (one journal per volume, not per folder) so
//! `flurer.exe` doesn't need to hold a recursive `ReadDirectoryChangesW`
//! watch open per browsed folder, and doesn't need to run elevated itself
//! (opening a volume handle for journal reads needs admin/backup-operator
//! rights; `flurer.exe` stays a normal-user process and talks to this
//! service over a named pipe instead).
//!
//! Installed as a `SERVICE_AUTO_START` Windows service at install time (see
//! the NSIS installer hook), so it starts at boot with no UAC prompt ever —
//! services aren't subject to interactive elevation prompts the way a
//! manifest-forced-admin exe would be on every launch.

#[cfg(windows)]
mod journal;
#[cfg(windows)]
mod mft;
#[cfg(windows)]
mod pipe_server;
#[cfg(windows)]
mod service;
#[cfg(windows)]
mod state;
#[cfg(windows)]
mod volumes;

#[cfg(windows)]
fn main() -> windows_service::Result<()> {
    // TODO(follow-up): factor the main app's rolling-file-logger + panic
    // hook setup (src-tauri/src/logging.rs) into a small shared crate both
    // binaries depend on, so watchd's crash logs land in the same
    // %LOCALAPPDATA%/.flurer/logs an admin/support session already checks,
    // instead of this bare stdout logger (a service has no console — this
    // currently only helps when run manually with `flurer-watchd debug`
    // during development, see service.rs).
    let _ = log::set_boxed_logger(Box::new(StdoutLogger));
    log::set_max_level(log::LevelFilter::Info);
    service::run()
}

#[cfg(windows)]
struct StdoutLogger;

#[cfg(windows)]
impl log::Log for StdoutLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        println!("[{}] {}", record.level(), record.args());
    }
    fn flush(&self) {}
}

#[cfg(not(windows))]
fn main() {
    // The USN Journal is an NTFS/Windows-only mechanism; on any other
    // platform this service has nothing to do. flurer.exe's volume-backend
    // selection (see sizecache::backend) already treats "service
    // unreachable" as "use the in-process notify watcher for this volume,"
    // so a non-Windows build simply never has a watchd to connect to.
    eprintln!("flurer-watchd only runs on Windows (NTFS USN Journal is a Windows-only mechanism); nothing to do here.");
    std::process::exit(1);
}
