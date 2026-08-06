use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    panic,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::Local;
use log::{Level, LevelFilter, Log, Metadata, Record};

// Production logs and crash reports live in the platform's local (i.e.
// non-roaming) app-data directory, deliberately separate from the
// ~/.config/flurer root the rest of the app's settings/cache use — this is
// specifically what a user is told to zip up and attach to a bug report, so
// it shouldn't be mixed in with settings.json or the wallpaper cache.
fn base_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join(".flurer"))
}

fn logs_dir() -> Option<PathBuf> {
    base_dir().map(|d| d.join("logs"))
}

fn crashes_dir() -> Option<PathBuf> {
    base_dir().map(|d| d.join("crashes"))
}

// One log file per run (rather than one growing file, or a daily file
// shared by every launch that day) — makes it trivial to hand over "the log
// from the run where it crashed" without needing to grep timestamps out of
// a shared file. Bounded by pruning the oldest files past this count on
// every startup, so a long-lived install doesn't accumulate logs forever.
const MAX_LOG_FILES: usize = 30;
const MAX_CRASH_FILES: usize = 30;

struct FileLogger {
    file: Mutex<File>,
    level: LevelFilter,
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "[{}] [{:>5}] {}: {}\n",
            Local::now().format("%Y-%m-%dT%H:%M:%S%.3f"),
            record.level(),
            record.target(),
            record.args(),
        );
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

// Debug builds log everything down to Debug; release (production) builds
// stick to Info and above so routine per-file operations don't flood the
// log — the point is capturing what led up to a crash or an error the user
// hit, not a full trace of every list_directory call.
fn level_filter() -> LevelFilter {
    if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

// Deletes the oldest files under `dir` whose name starts with `prefix`,
// keeping at most `keep`. Best-effort: a directory read/metadata failure
// just skips pruning for this run rather than blocking startup on it.
fn prune_old(dir: &Path, prefix: &str, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<_> = entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(prefix))
        .filter_map(|entry| entry.metadata().ok().and_then(|m| m.modified().ok()).map(|t| (entry.path(), t)))
        .collect();
    if files.len() <= keep {
        return;
    }
    files.sort_by_key(|(_, modified)| *modified);
    for (path, _) in files.iter().take(files.len() - keep) {
        let _ = fs::remove_file(path);
    }
}

// Sets up file logging and a crash-reporting panic hook, both under the
// platform's local app-data dir. Must run before anything else in `run()`
// so early startup failures are captured too. Not being able to set this up
// (no writable app-data dir, permissions, …) is non-fatal — the app just
// runs without file logging rather than refusing to start over it.
pub fn init() {
    let Some(dir) = logs_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    prune_old(&dir, "flurer-", MAX_LOG_FILES);

    let file_name = format!("flurer-{}.log", Local::now().format("%Y%m%dT%H%M%S%.3f"));
    let Ok(file) = OpenOptions::new().create(true).append(true).open(dir.join(&file_name)) else {
        return;
    };

    let level = level_filter();
    let logger = FileLogger { file: Mutex::new(file), level };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(level);
    }

    install_panic_hook();

    log::info!(
        "flurer {} starting (pid {}, os {})",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        std::env::consts::OS,
    );
}

// A panic in a packaged production build has no terminal for its default
// stderr output to land on — nothing survives once the process exits. This
// hook writes the panic's message, source location, and a full backtrace
// (always captured, not gated on RUST_BACKTRACE, since production users
// won't have that set) to its own timestamped crash file, mirrors it into
// the regular log, and still chains to the previous hook so `cargo run` /
// dev builds keep their usual stderr output.
fn install_panic_hook() {
    let previous_hook = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown location>".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();

        log::log!(Level::Error, "PANIC at {location}: {message}\n{backtrace}");

        if let Some(dir) = crashes_dir() {
            if fs::create_dir_all(&dir).is_ok() {
                prune_old(&dir, "crash-", MAX_CRASH_FILES);
                let file_name = format!("crash-{}.log", Local::now().format("%Y%m%dT%H%M%S%.3f"));
                let contents = format!(
                    "flurer {}\ntime: {}\nlocation: {location}\nmessage: {message}\n\nbacktrace:\n{backtrace}\n",
                    env!("CARGO_PKG_VERSION"),
                    Local::now().to_rfc3339(),
                );
                let _ = fs::write(dir.join(file_name), contents);
            }
        }

        previous_hook(info);
    }));
}
