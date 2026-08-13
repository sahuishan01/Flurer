//! Command-line "open this folder" support — `flurer .` or `flurer <path>`.
//!
//! No single-instance handling here: a second `flurer.exe` invocation
//! already starts an independent process today (there's no
//! tauri-plugin-single-instance in this codebase), and this deliberately
//! doesn't change that — it only makes whichever window that new process
//! shows open at the given folder instead of the hardcoded default,
//! which is the part actually being asked for.

use std::path::{Path, PathBuf};

/// Picks the path argument out of a process's argv, ignoring the exe name
/// (argv[0]) and any flag-like args (leading '-', e.g. --minimized). Only
/// the first non-flag argument is used — a second one is silently ignored
/// rather than erroring, since this exists for "open me at this folder",
/// not a full CLI parser.
fn find_path_arg(args: &[String]) -> Option<&str> {
    args.iter().skip(1).map(String::as_str).find(|a| !a.starts_with('-'))
}

/// Resolves a raw CLI argument to an absolute, existing directory path, or
/// None if there's no usable path argument (normal launch with no args,
/// or an argument that doesn't resolve to anything on disk — silently
/// falling back to the default rather than erroring, since a typo here
/// shouldn't block the app from opening at all).
///
/// "." (or any relative path) resolves against `cwd` — the shell's working
/// directory at the moment Flurer was invoked, passed in explicitly rather
/// than calling `std::env::current_dir()` internally, so the same function
/// works for both this process's own cwd (cold start) and a second
/// process's cwd if single-instance forwarding is ever added later.
pub fn resolve_launch_path(args: &[String], cwd: &Path) -> Option<String> {
    let raw = find_path_arg(args)?;
    let path = PathBuf::from(raw);
    let resolved = if path.is_absolute() { path } else { cwd.join(&path) };

    // A file path (not a folder) is out of scope for "open this folder" —
    // resolve to its parent instead, the same as pasting a file path into
    // Explorer's address bar.
    let dir = if resolved.is_file() { resolved.parent()?.to_path_buf() } else { resolved };

    dir.is_dir().then(|| dir.to_string_lossy().to_string())
}

/// Consumes (not just reads) the startup path, so a second window spawned
/// later in the same process doesn't also navigate there — only the first
/// caller (in practice, whichever window's frontend mounts first) gets it.
#[tauri::command]
pub fn take_launch_path(state: tauri::State<'_, crate::state::AppState>) -> Option<String> {
    state.launch_path.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn no_args_resolves_to_none() {
        let cwd = tempdir().unwrap();
        assert_eq!(resolve_launch_path(&["flurer.exe".to_string()], cwd.path()), None);
    }

    #[test]
    fn flag_only_args_resolve_to_none() {
        let cwd = tempdir().unwrap();
        let args = vec!["flurer.exe".to_string(), "--minimized".to_string()];
        assert_eq!(resolve_launch_path(&args, cwd.path()), None);
    }

    #[test]
    fn dot_resolves_against_cwd() {
        let cwd = tempdir().unwrap();
        let args = vec!["flurer.exe".to_string(), ".".to_string()];
        let resolved = resolve_launch_path(&args, cwd.path()).unwrap();
        assert_eq!(PathBuf::from(resolved), cwd.path());
    }

    #[test]
    fn relative_subfolder_resolves_against_cwd() {
        let cwd = tempdir().unwrap();
        let sub = cwd.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let args = vec!["flurer.exe".to_string(), "sub".to_string()];
        let resolved = resolve_launch_path(&args, cwd.path()).unwrap();
        assert_eq!(PathBuf::from(resolved), sub);
    }

    #[test]
    fn absolute_path_ignores_cwd() {
        let cwd = tempdir().unwrap();
        let elsewhere = tempdir().unwrap();
        let args = vec!["flurer.exe".to_string(), elsewhere.path().to_string_lossy().to_string()];
        let resolved = resolve_launch_path(&args, cwd.path()).unwrap();
        assert_eq!(PathBuf::from(resolved), elsewhere.path());
    }

    #[test]
    fn file_path_resolves_to_its_parent() {
        let cwd = tempdir().unwrap();
        let file = cwd.path().join("notes.txt");
        std::fs::write(&file, b"hi").unwrap();
        let args = vec!["flurer.exe".to_string(), "notes.txt".to_string()];
        let resolved = resolve_launch_path(&args, cwd.path()).unwrap();
        assert_eq!(PathBuf::from(resolved), cwd.path());
    }

    #[test]
    fn nonexistent_path_resolves_to_none() {
        let cwd = tempdir().unwrap();
        let args = vec!["flurer.exe".to_string(), "does-not-exist".to_string()];
        assert_eq!(resolve_launch_path(&args, cwd.path()), None);
    }

    #[test]
    fn flag_before_path_is_skipped() {
        let cwd = tempdir().unwrap();
        let sub = cwd.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let args = vec!["flurer.exe".to_string(), "--minimized".to_string(), "sub".to_string()];
        let resolved = resolve_launch_path(&args, cwd.path()).unwrap();
        assert_eq!(PathBuf::from(resolved), sub);
    }
}
