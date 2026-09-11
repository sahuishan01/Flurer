//! Command-line "open this folder" support — `flurer .` or `flurer <path>`.
//!
//! Handles resolving CLI arguments on both cold start (via `take_launch_path`)
//! and warm secondary invocations (forwarded via `tauri-plugin-single-instance`
//! to open in a new tab of the existing window).

use std::path::{Path, PathBuf};

/// Picks the path argument out of a process's argv, ignoring the exe name
/// (argv[0]) and any flag-like args (leading '-', e.g. --minimized). Only
/// the first non-flag argument is used — a second one is silently ignored
/// rather than erroring, since this exists for "open me at this folder",
/// not a full CLI parser.
fn find_path_arg(args: &[String]) -> Option<&str> {
    args.iter()
        .skip(1)
        .map(String::as_str)
        .map(|s| s.trim_matches('"').trim_matches('\''))
        .find(|a| !a.is_empty() && !a.starts_with('-'))
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

    if !dir.is_dir() {
        return None;
    }

    let canonical = dir.canonicalize().unwrap_or(dir);
    let path_str = canonical.to_string_lossy().to_string();
    let cleaned = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str).to_string();
    Some(cleaned)
}

/// Consumes (not just reads) the startup path, so a second window spawned
/// later in the same process doesn't also navigate there — only the first
/// caller (in practice, whichever window's frontend mounts first) gets it.
#[tauri::command]
pub fn take_launch_path(state: tauri::State<'_, crate::state::AppState>) -> Option<String> {
    state.launch_path.lock().unwrap().take()
}

/// Checks if Flurer's executable directory is present in the user PATH.
#[tauri::command]
pub fn is_in_path() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_dir = exe.parent().ok_or("Cannot locate executable parent directory")?;
        let target_dir = exe_dir.to_string_lossy().to_lowercase();

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let env_key = hkcu.open_subkey("Environment").map_err(|e| e.to_string())?;
        let current_path: String = env_key.get_value("Path").unwrap_or_default();

        let in_user_path = current_path
            .split(';')
            .any(|p| p.trim().to_lowercase() == target_dir);

        if in_user_path {
            return Ok(true);
        }

        // Fallback check system PATH
        if let Ok(sys_path) = std::env::var("PATH") {
            if sys_path.split(';').any(|p| p.trim().to_lowercase() == target_dir) {
                return Ok(true);
            }
        }

        Ok(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_dir = exe.parent().ok_or("Cannot locate executable directory")?;
        let target_dir = exe_dir.to_string_lossy().to_string();

        if let Ok(sys_path) = std::env::var("PATH") {
            if sys_path.split(':').any(|p| p == target_dir) {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// Appends Flurer's executable directory to the user environment PATH registry key.
#[tauri::command]
pub fn add_to_system_path() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_dir = exe.parent().ok_or("Cannot locate executable parent directory")?;
        let target_dir_str = exe_dir.to_string_lossy().to_string();

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let env_key = hkcu.open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE).map_err(|e| e.to_string())?;
        let current_path: String = env_key.get_value("Path").unwrap_or_default();

        let already_present = current_path
            .split(';')
            .any(|p| p.trim().eq_ignore_ascii_case(&target_dir_str));

        if already_present {
            return Ok(true);
        }

        let new_path = if current_path.trim().is_empty() {
            target_dir_str
        } else {
            format!("{};{}", current_path.trim_end_matches(';'), target_dir_str)
        };

        env_key.set_value("Path", &new_path).map_err(|e| e.to_string())?;

        // Broadcast WM_SETTINGCHANGE so running terminal windows update their environment
        #[cfg(target_os = "windows")]
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SendMessageTimeoutA, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
            };
            let mut result: usize = 0;
            let env_str = b"Environment\0";
            SendMessageTimeoutA(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                env_str.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5000,
                &mut result,
            );
        }

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Adding to system PATH is only supported on Windows".to_string())
    }
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

    #[test]
    fn quoted_path_resolves_correctly() {
        let cwd = tempdir().unwrap();
        let sub = cwd.path().join("sub folder");
        std::fs::create_dir(&sub).unwrap();
        let args = vec!["flurer.exe".to_string(), "\"sub folder\"".to_string()];
        let resolved = resolve_launch_path(&args, cwd.path()).unwrap();
        assert_eq!(PathBuf::from(resolved), sub);
    }
}
