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

/// Checks whether a raw CLI argument represents an HTTP, HTTPS, or web URL.
pub fn is_web_url(raw: &str) -> bool {
    let lower = raw.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("www.")
        || (lower.contains("://") && !lower.starts_with("file://"))
}

/// Normalizes a web URL to ensure standard protocol prefix.
pub fn normalize_web_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"').trim_matches('\'');
    if trimmed.to_ascii_lowercase().starts_with("www.") {
        format!("https://{}", trimmed)
    } else {
        trimmed.to_string()
    }
}

/// Resolves a raw CLI argument to a web URL if the argument starts with http/https/www or has a web scheme.
pub fn resolve_launch_url(args: &[String]) -> Option<String> {
    let raw = find_path_arg(args)?;
    if is_web_url(raw) {
        Some(normalize_web_url(raw))
    } else {
        None
    }
}

/// Resolves a raw CLI argument to an absolute, existing directory path, or
/// None if there's no usable path argument (normal launch with no args,
/// or an argument that doesn't resolve to anything on disk — silently
/// falling back to the default rather than erroring, since a typo here
/// shouldn't block the app from opening at all).
///
/// If the argument is a web URL, returns None so it can be handled by `resolve_launch_url`.
///
/// "." (or any relative path) resolves against `cwd` — the shell's working
/// directory at the moment Flurer was invoked, passed in explicitly rather
/// than calling `std::env::current_dir()` internally, so the same function
/// works for both this process's own cwd (cold start) and a second
/// process's cwd if single-instance forwarding is ever added later.
pub fn resolve_launch_path(args: &[String], cwd: &Path) -> Option<String> {
    let raw = find_path_arg(args)?;
    if is_web_url(raw) {
        return None;
    }
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

/// Consumes (not just reads) the startup web URL if Flurer was launched with a URL.
#[tauri::command]
pub fn take_launch_url(state: tauri::State<'_, crate::state::AppState>) -> Option<String> {
    state.launch_url.lock().unwrap().take()
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
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_dir = exe.parent().ok_or("Cannot locate executable parent directory")?;
        let target_dir = exe_dir.to_string_lossy().to_string();

        let home = dirs::home_dir().ok_or("Cannot determine user home directory")?;
        let export_line = format!("\nexport PATH=\"{}:$PATH\"\n", target_dir);

        let profiles = [home.join(".bashrc"), home.join(".zshrc"), home.join(".profile")];
        let mut modified = false;

        for profile in &profiles {
            if profile.exists() {
                let content = std::fs::read_to_string(profile).unwrap_or_default();
                if !content.contains(&target_dir) {
                    use std::io::Write;
                    let mut file = std::fs::OpenOptions::new()
                        .append(true)
                        .open(profile)
                        .map_err(|e| format!("Failed to update {}: {e}", profile.display()))?;
                    file.write_all(export_line.as_bytes())
                        .map_err(|e| format!("Failed to write to {}: {e}", profile.display()))?;
                    modified = true;
                } else {
                    modified = true;
                }
            }
        }

        if !modified {
            // Fallback: write to ~/.profile if none of the specific files existed
            let profile = home.join(".profile");
            std::fs::write(&profile, export_line)
                .map_err(|e| format!("Failed to create {}: {e}", profile.display()))?;
        }

        Ok(true)
    }
}

/// Checks whether Flurer is registered as a browser handler on Windows (in HKCU RegisteredApplications / ProgID).
#[tauri::command]
pub fn check_is_default_browser() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        // Check if FlurerHTML ProgId exists under HKCU\Software\Classes\FlurerHTML
        let classes = hkcu.open_subkey(r"Software\Classes\FlurerHTML");
        if classes.is_err() {
            return Ok(false);
        }

        // Check if RegisteredApplications has Flurer
        if let Ok(reg_apps) = hkcu.open_subkey(r"Software\RegisteredApplications") {
            let app_cap: Result<String, _> = reg_apps.get_value("Flurer");
            if app_cap.is_ok() {
                return Ok(true);
            }
        }

        Ok(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Linux/macOS, check default browser using xdg-settings or return false
        if let Ok(output) = std::process::Command::new("xdg-settings")
            .args(["get", "default-web-browser"])
            .output()
        {
            let s = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if s.contains("flurer") {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// Registers Flurer as an available/default browser in Windows Registry (HKCU) and opens Default Apps settings.
#[tauri::command]
pub fn register_default_browser() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_path = exe.to_string_lossy().to_string();
        let quoted_exe = format!("\"{}\"", exe_path);
        let command_str = format!("\"{}\" \"%1\"", exe_path);

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // 1. Create ProgID HKCU\Software\Classes\FlurerHTML
        let (html_progid, _) = hkcu
            .create_subkey_with_flags(r"Software\Classes\FlurerHTML", KEY_READ | KEY_WRITE)
            .map_err(|e| format!("Failed to create FlurerHTML: {e}"))?;
        html_progid.set_value("", &"Flurer HTML Document").map_err(|e| e.to_string())?;
        html_progid.set_value("AppUserModelId", &"com.algosculptor.flurer").unwrap_or(());

        // DefaultIcon
        let (icon_key, _) = html_progid
            .create_subkey_with_flags("DefaultIcon", KEY_READ | KEY_WRITE)
            .map_err(|e| e.to_string())?;
        icon_key.set_value("", &format!("{},0", quoted_exe)).unwrap_or(());

        // shell\open\command
        let (open_cmd_key, _) = html_progid
            .create_subkey_with_flags(r"shell\open\command", KEY_READ | KEY_WRITE)
            .map_err(|e| e.to_string())?;
        open_cmd_key.set_value("", &command_str).map_err(|e| e.to_string())?;

        // 2. Protocols: HKCU\Software\Classes\http and https
        for proto in ["http", "https"] {
            let proto_path = format!(r"Software\Classes\{}", proto);
            let (proto_key, _) = hkcu
                .create_subkey_with_flags(&proto_path, KEY_READ | KEY_WRITE)
                .map_err(|e| format!("Failed to create {proto_path}: {e}"))?;
            proto_key.set_value("", &format!("URL:{proto.to_uppercase()} Protocol")).unwrap_or(());
            proto_key.set_value("URL Protocol", &"").unwrap_or(());
            proto_key.set_value("AppUserModelId", &"com.algosculptor.flurer").unwrap_or(());

            let (p_cmd_key, _) = proto_key
                .create_subkey_with_flags(r"shell\open\command", KEY_READ | KEY_WRITE)
                .map_err(|e| e.to_string())?;
            p_cmd_key.set_value("", &command_str).unwrap_or(());
        }

        // 3. HKCU\Software\Flurer\Capabilities
        let (cap_key, _) = hkcu
            .create_subkey_with_flags(r"Software\Flurer\Capabilities", KEY_READ | KEY_WRITE)
            .map_err(|e| format!("Failed to create Capabilities: {e}"))?;
        cap_key.set_value("ApplicationName", &"Flurer").unwrap_or(());
        cap_key.set_value("ApplicationDescription", &"Flurer Web Loader Browser").unwrap_or(());

        let (assoc_url_key, _) = cap_key
            .create_subkey_with_flags("UrlAssociations", KEY_READ | KEY_WRITE)
            .map_err(|e| e.to_string())?;
        assoc_url_key.set_value("http", &"FlurerHTML").unwrap_or(());
        assoc_url_key.set_value("https", &"FlurerHTML").unwrap_or(());

        let (assoc_file_key, _) = cap_key
            .create_subkey_with_flags("FileAssociations", KEY_READ | KEY_WRITE)
            .map_err(|e| e.to_string())?;
        assoc_file_key.set_value(".htm", &"FlurerHTML").unwrap_or(());
        assoc_file_key.set_value(".html", &"FlurerHTML").unwrap_or(());

        // 4. HKCU\Software\RegisteredApplications
        let (reg_apps_key, _) = hkcu
            .create_subkey_with_flags(r"Software\RegisteredApplications", KEY_READ | KEY_WRITE)
            .map_err(|e| format!("Failed to open RegisteredApplications: {e}"))?;
        reg_apps_key.set_value("Flurer", &r"Software\Flurer\Capabilities").unwrap_or(());

        // Notify Windows Shell of association change
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SendMessageTimeoutA, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
            };
            let mut result: usize = 0;
            let env_str = b"\0";
            SendMessageTimeoutA(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                env_str.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                3000,
                &mut result,
            );
        }

        // Launch Windows Default Apps Settings page so the user can confirm/select Flurer
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:defaultapps"])
            .spawn();

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Try xdg-settings on Linux desktop
        let status = std::process::Command::new("xdg-settings")
            .args(["set", "default-web-browser", "flurer.desktop"])
            .status();
        match status {
            Ok(s) if s.success() => Ok(true),
            _ => {
                // If setting directly fails or is unsupported, inform user
                Ok(false)
            }
        }
    }
}

/// Unregisters Flurer browser associations from HKCU\Software\Classes and RegisteredApplications.
#[tauri::command]
pub fn unregister_default_browser() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let _ = hkcu.delete_subkey_all(r"Software\Classes\FlurerHTML");
        let _ = hkcu.delete_subkey_all(r"Software\Flurer\Capabilities");

        if let Ok(reg_apps) = hkcu.open_subkey_with_flags(r"Software\RegisteredApplications", KEY_WRITE) {
            let _ = reg_apps.delete_value("Flurer");
        }

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(true)
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

    #[test]
    fn web_url_resolves_via_launch_url() {
        let cwd = tempdir().unwrap();
        let args_https = vec!["flurer.exe".to_string(), "https://example.com/test".to_string()];
        assert_eq!(resolve_launch_url(&args_https), Some("https://example.com/test".to_string()));
        assert_eq!(resolve_launch_path(&args_https, cwd.path()), None);

        let args_http = vec!["flurer.exe".to_string(), "http://localhost:8080".to_string()];
        assert_eq!(resolve_launch_url(&args_http), Some("http://localhost:8080".to_string()));
        assert_eq!(resolve_launch_path(&args_http, cwd.path()), None);

        let args_www = vec!["flurer.exe".to_string(), "www.google.com".to_string()];
        assert_eq!(resolve_launch_url(&args_www), Some("https://www.google.com".to_string()));
        assert_eq!(resolve_launch_path(&args_www, cwd.path()), None);
    }
}
