use serde::{Deserialize, Serialize};

#[cfg(not(target_os = "linux"))]
use crate::elevation::launch_elevated_and_relaunch;

const GITHUB_REPO: &str = "sahuishan01/Flurer";
const USER_AGENT: &str = "Flurer/0.4.26";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub latest_version: String,
    pub current_version: String,
    pub download_url: String,
    pub release_url: String,
    pub release_body: String,
    pub has_update: bool,
}

/// Simple semver comparison — returns true if a > b.
fn version_greater(a: &str, b: &str) -> bool {
    fn parse(v: &str) -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.parse::<u64>().ok())
            .collect()
    }
    let a_parts = parse(a);
    let b_parts = parse(b);
    for (pa, pb) in a_parts.iter().zip(b_parts.iter()) {
        if pa != pb {
            return pa > pb;
        }
    }
    a_parts.len() > b_parts.len()
}

#[tauri::command]
pub async fn check_for_updates(current_version: String) -> Result<UpdateInfo, String> {
    let api_url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let client = reqwest::Client::new();

    let resp = client
        .get(&api_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .inspect_err(|e| log::error!("check_for_updates: GitHub API request failed: {e}"))
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        log::error!("check_for_updates: GitHub API returned {status}: {body}");
        return Err(format!("GitHub API returned {status}: {body}"));
    }

    let release: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {e}"))?;

    let tag_name = release["tag_name"]
        .as_str()
        .ok_or("No tag_name in release response")?;

    let latest_version = tag_name.trim_start_matches('v').to_string();
    let has_update = version_greater(&latest_version, &current_version);

    // Prefer the NSIS .exe over the .msi: the NSIS installer is configured
    // with installMode "both", letting the user choose a per-user or
    // per-machine install; the MSI is hardcoded per-machine-only with no
    // choice. release.yml happens to list the .msi asset before the .exe,
    // so picking "whichever comes first" (the previous behavior) silently
    // favored the installer with no choice — find() over the .exe first,
    // and only fall back to .msi if a release genuinely has no .exe asset.
    let assets = release["assets"].as_array().ok_or("No assets found")?;
    let find_by_suffix = |suffix: &str| {
        assets
            .iter()
            .find(|a| a["name"].as_str().map(|n| n.ends_with(suffix)).unwrap_or(false))
            .and_then(|a| a["browser_download_url"].as_str().map(String::from))
    };
    #[cfg(target_os = "linux")]
    let download_url = find_by_suffix(".AppImage")
        .or_else(|| find_by_suffix(".deb"))
        .ok_or("No Linux package found in the latest release")?;
    #[cfg(not(target_os = "linux"))]
    let download_url = find_by_suffix(".exe")
        .or_else(|| find_by_suffix(".msi"))
        .ok_or("No installer asset found in the latest release")?;

    let release_url = release["html_url"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| format!("https://github.com/{GITHUB_REPO}/releases/tag/{tag_name}"));

    let release_body = release["body"]
        .as_str()
        .unwrap_or("")
        .to_string();

    log::info!("check_for_updates: current={current_version} latest={latest_version} has_update={has_update}");

    Ok(UpdateInfo {
        latest_version,
        current_version: current_version.to_string(),
        download_url,
        release_url,
        release_body,
        has_update,
    })
}

/// Whether the currently-running Flurer executable lives under a
/// per-machine install root (e.g. `Program Files`) rather than a per-user
/// one (e.g. `%LOCALAPPDATA%\Programs`). Used to keep a silent update
/// install in the same scope as the install it's replacing — see the call
/// site in `download_and_install_update`.
#[cfg(not(target_os = "linux"))]
fn is_per_machine_install() -> bool {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_lowercase().contains("program files"))
        .unwrap_or(false)
}

/// Version segment in a release asset name, e.g. `flurer_0.4.254_amd64.AppImage`.
#[cfg(target_os = "linux")]
fn update_version_from_filename(file_name: &str) -> Option<String> {
    file_name.split(|c: char| c == '_' || c == '-').find_map(|part| {
        let mut pieces = part.split('.');
        let major = pieces.next()?;
        let minor = pieces.next()?;
        let patch = pieces.next()?;
        if pieces.next().is_some()
            || !major.chars().all(|c| c.is_ascii_digit())
            || !minor.chars().all(|c| c.is_ascii_digit())
            || !patch.chars().all(|c| c.is_ascii_digit())
        {
            return None;
        }
        Some(format!("{major}.{minor}.{patch}"))
    })
}

/// Where a downloaded AppImage should be installed for this user.
///
/// Only per-user installs under `~/.local/opt/flurer` are updated in place:
/// a system-owned `/usr/bin/flurer` is not writable without root and should
/// go through the OS package manager instead.
#[cfg(target_os = "linux")]
fn linux_update_target(
    home: &std::path::Path,
    current_exe: &std::path::Path,
    appimage: Option<&std::path::Path>,
    version: &str,
) -> Result<std::path::PathBuf, String> {
    let install_root = home.join(".local").join("opt").join("flurer");
    let per_user = current_exe.starts_with(&install_root)
        || appimage.is_some_and(|path| path.starts_with(&install_root));
    if !per_user {
        return Err(
            "Automatic updates on Linux require a per-user install under ~/.local/opt/flurer. \
             Download the latest release from https://github.com/sahuishan01/Flurer/releases/latest instead."
                .to_string(),
        );
    }
    if let Some(appimage) = appimage {
        return Ok(appimage.to_path_buf());
    }
    Ok(install_root.join(format!("flurer-{version}.AppImage")))
}

/// Derive the owning user's home from an install path such as
/// `/home/ishan/.local/opt/flurer/0.4.253/usr/bin/flurer`.
///
/// The updater may run inside an elevated (root) instance whose HOME is
/// /root; deriving from the executable keeps the install, launcher, and
/// autostart in the actual user's home instead of creating a root-owned
/// copy under /root.
#[cfg(target_os = "linux")]
fn install_home_from_path(path: &std::path::Path) -> Option<std::path::PathBuf> {
    let root = std::path::Path::new(".local/opt/flurer");
    path.ancestors()
        .find(|ancestor| ancestor.ends_with(root))
        .and_then(|ancestor| ancestor.ancestors().nth(3))
        .map(std::path::Path::to_path_buf)
}

#[cfg(target_os = "linux")]
fn chown_if_root(path: &std::path::Path, owner: Option<(u32, u32)>) {
    if unsafe { libc::geteuid() } != 0 {
        return;
    }
    if let Some((uid, gid)) = owner {
        let _ = std::os::unix::fs::chown(path, Some(uid), Some(gid));
    }
}

#[cfg(target_os = "linux")]
fn install_linux_update(source: &std::path::Path, file_name: &str) -> Result<std::path::PathBuf, String> {
    let current = std::env::current_exe().map_err(|e| format!("Could not resolve current executable: {e}"))?;
    let appimage = std::env::var_os("APPIMAGE").map(std::path::PathBuf::from);
    let home = install_home_from_path(&current)
        .or_else(|| appimage.as_deref().and_then(install_home_from_path))
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Could not determine the installing user's home directory".to_string())?;
    // Prefer the AppImage file's ownership: an AppImage's mounted inner
    // binary is root-owned in the squashfs, but the .AppImage file itself
    // belongs to the user.
    let owner_source = appimage.as_deref().unwrap_or(&current);
    let owner = std::fs::metadata(owner_source).ok().map(|meta| {
        use std::os::unix::fs::MetadataExt;
        (meta.uid(), meta.gid())
    });
    install_linux_update_at(source, file_name, &home, &current, appimage.as_deref(), owner)
}

#[cfg(target_os = "linux")]
fn install_linux_update_at(
    source: &std::path::Path,
    file_name: &str,
    home: &std::path::Path,
    current: &std::path::Path,
    appimage: Option<&std::path::Path>,
    owner: Option<(u32, u32)>,
) -> Result<std::path::PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;

    if !file_name.ends_with(".AppImage") {
        return Err("The latest Linux release has no AppImage asset; download the package manually.".to_string());
    }
    let version = update_version_from_filename(file_name).unwrap_or_else(|| "latest".to_string());
    let target = linux_update_target(home, current, appimage, &version)?;
    let parent = target
        .parent()
        .ok_or_else(|| "Invalid update target path".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;

    let tmp_name = format!(
        ".{}.{}.new",
        target.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id()
    );
    let tmp = parent.join(tmp_name);
    std::fs::copy(source, &tmp).map_err(|e| format!("Could not write update: {e}"))?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("Could not mark update executable: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("Could not replace {}: {e}", target.display()))?;
    chown_if_root(&target, owner);
    let _ = std::fs::remove_file(source);

    let bin_link = home.join(".local").join("bin").join("flurer");
    if let Some(bin_dir) = bin_link.parent() {
        let _ = std::fs::create_dir_all(bin_dir);
    }
    let replace_link = match std::fs::symlink_metadata(&bin_link) {
        Ok(meta) => meta.file_type().is_symlink(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    };
    if replace_link {
        let link_tmp = bin_link.with_file_name(format!(".flurer.{}.link", std::process::id()));
        let _ = std::fs::remove_file(&link_tmp);
        std::os::unix::fs::symlink(&target, &link_tmp)
            .map_err(|e| format!("Could not create launcher symlink: {e}"))?;
        std::fs::rename(&link_tmp, &bin_link)
            .map_err(|e| format!("Could not replace launcher symlink: {e}"))?;
    }

    let autostart = home.join(".config").join("autostart").join("flurer.desktop");
    if let Ok(contents) = std::fs::read_to_string(&autostart) {
        let mut lines: Vec<String> = contents
            .lines()
            .map(|line| {
                if line.starts_with("Exec=") {
                    format!("Exec={} --minimized", target.display())
                } else {
                    line.to_string()
                }
            })
            .collect();
        lines.push(String::new());
        let _ = crate::helpers::settings::atomic_write(&autostart, lines.join("\n").as_bytes());
        chown_if_root(&autostart, owner);
    }

    log::info!("update installed: {} -> {}", source.display(), target.display());
    Ok(target)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressPayload {
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
    pub stage: String,
}

#[tauri::command]
pub async fn download_and_install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri::Emitter;
    use tokio::io::AsyncWriteExt;

    log::info!("download_and_install_update: starting download from {url}");
    let task_id = crate::progress::next_task_id();

    let emit = |downloaded: u64, total: u64, stage: &str, finished: bool, error: Option<String>| {
        let percent = if total > 0 { (downloaded as f64 / total as f64) * 100.0 } else { 0.0 };
        let _ = app.emit(
            "update-progress",
            UpdateProgressPayload {
                downloaded,
                total,
                percent,
                stage: stage.to_string(),
            },
        );
        crate::progress::emit_progress(
            &app,
            task_id,
            &format!("Updating Flurer ({stage})"),
            downloaded,
            total,
            finished,
            error,
            total == 0,
        );
    };

    emit(0, 0, "Connecting…", false, None);

    let client = reqwest::Client::new();
    let mut resp = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .inspect_err(|e| {
            let err_msg = format!("Download request failed: {e}");
            emit(0, 0, "Failed", true, Some(err_msg.clone()));
            log::error!("download_and_install_update: request failed: {e}");
        })
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !resp.status().is_success() {
        let err_msg = format!("Download returned HTTP {}", resp.status());
        emit(0, 0, "Failed", true, Some(err_msg.clone()));
        log::error!("download_and_install_update: HTTP {}", resp.status());
        return Err(err_msg);
    }

    let total_size = resp.content_length().unwrap_or(0);
    emit(0, total_size, "Downloading installer…", false, None);

    // Stream to a temp file
    let temp_dir = std::env::temp_dir();
    let file_name = url
        .split('/')
        .last()
        .unwrap_or("flurer-update.exe");

    let output_path = temp_dir.join(file_name);
    let mut file = tokio::fs::File::create(&output_path)
        .await
        .inspect_err(|e| {
            let err_msg = format!("Failed to create installer file: {e}");
            emit(0, total_size, "Failed", true, Some(err_msg.clone()));
        })
        .map_err(|e| format!("Failed to create installer file: {e}"))?;

    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Error downloading installer chunk: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write installer chunk: {e}"))?;
        downloaded += chunk.len() as u64;
        emit(downloaded, total_size, "Downloading installer…", false, None);
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush installer: {e}"))?;
    drop(file);

    #[cfg(target_os = "linux")]
    {
        emit(total_size, total_size, "Installing update…", false, None);
        let target = match install_linux_update(&output_path, &file_name) {
            Ok(target) => target,
            Err(e) => {
                emit(downloaded, total_size, "Failed", true, Some(e.clone()));
                crate::progress::cleanup_task(task_id);
                log::error!("download_and_install_update: Linux install failed: {e}");
                return Err(e);
            }
        };
        emit(
            total_size,
            total_size,
            "Update installed — restart Flurer to finish",
            true,
            None,
        );
        crate::progress::cleanup_task(task_id);
        log::info!("download_and_install_update: installed {}", target.display());
        // Do not spawn/exit here. The elevated instance lives in a transient
        // systemd service, and a child spawned from it is killed when the
        // service stops. Install in place and let the next launch pick up the
        // new AppImage; the UI tells the user to restart.
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        emit(total_size, total_size, "Launching installer…", false, None);

        let installer_path = output_path.to_string_lossy().to_string();
        let is_msi = file_name.ends_with(".msi");

        let child = if is_msi {
            launch_elevated_and_relaunch("msiexec", &["/i", &installer_path, "/quiet", "/norestart"])
        } else {
            let scope_flag = if is_per_machine_install() { "/AllUsers" } else { "/CurrentUser" };
            launch_elevated_and_relaunch(&installer_path, &[scope_flag, "/S"])
        };

        match child {
            Ok(_) => {
                log::info!("download_and_install_update: launched silent installer {installer_path} ({total_size} bytes), app will exit and relaunch once it's done");
                emit(total_size, total_size, "Installer launched. Relaunching Flurer…", true, None);
                crate::progress::cleanup_task(task_id);
                app.exit(0);
                Ok(())
            }
            Err(e) => {
                let err_msg = format!("Failed to launch installer: {e}");
                emit(downloaded, total_size, "Failed", true, Some(err_msg.clone()));
                crate::progress::cleanup_task(task_id);
                log::error!("download_and_install_update: failed to launch installer {installer_path}: {e}");
                Err(err_msg)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn asset_version_is_parsed_from_appimage_name() {
        assert_eq!(
            update_version_from_filename("flurer_0.4.254_amd64.AppImage"),
            Some("0.4.254".to_string())
        );
        assert_eq!(
            update_version_from_filename("Flurer-1.2.3-x86_64.AppImage"),
            Some("1.2.3".to_string())
        );
        assert_eq!(update_version_from_filename("flurer.AppImage"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn update_target_switches_per_user_install_to_appimage() {
        let home = std::path::Path::new("/home/ishan");
        let root = home.join(".local/opt/flurer");
        let current = root.join("0.4.253/usr/bin/flurer");
        let target = linux_update_target(home, &current, None, "0.4.254").unwrap();
        assert_eq!(target, root.join("flurer-0.4.254.AppImage"));

        let appimage = root.join("flurer-0.4.253.AppImage");
        let target = linux_update_target(home, &root.join("0.4.253/usr/bin/flurer"), Some(&appimage), "0.4.254").unwrap();
        assert_eq!(target, appimage);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn system_install_refuses_automatic_update() {
        assert!(linux_update_target(
            std::path::Path::new("/home/ishan"),
            std::path::Path::new("/usr/bin/flurer"),
            None,
            "0.4.254"
        )
        .is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn home_is_derived_from_user_install_path_when_running_as_root() {
        let home = install_home_from_path(std::path::Path::new(
            "/home/ishan/.local/opt/flurer/0.4.253/usr/bin/flurer",
        ))
        .unwrap();
        assert_eq!(home, std::path::Path::new("/home/ishan"));
        assert_eq!(
            install_home_from_path(std::path::Path::new(
                "/home/ishan/.local/opt/flurer/flurer-0.4.253.AppImage"
            ))
            .unwrap(),
            std::path::Path::new("/home/ishan")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn install_replaces_binary_launcher_and_autostart() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let root = home.join(".local/opt/flurer");
        let current = root.join("0.4.253/usr/bin/flurer");
        std::fs::create_dir_all(current.parent().unwrap()).unwrap();
        std::fs::write(&current, b"old").unwrap();

        let bin_dir = home.join(".local/bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        std::os::unix::fs::symlink(&current, bin_dir.join("flurer")).unwrap();

        let autostart = home.join(".config/autostart/flurer.desktop");
        std::fs::create_dir_all(autostart.parent().unwrap()).unwrap();
        std::fs::write(&autostart, "[Desktop Entry]\nExec=/old/flurer --minimized\n").unwrap();

        let source = home.join("download.AppImage");
        std::fs::write(&source, b"new-appimage").unwrap();
        let target = install_linux_update_at(&source, "flurer_0.4.254_amd64.AppImage", home, &current, None, None).unwrap();

        assert_eq!(target, root.join("flurer-0.4.254.AppImage"));
        assert_eq!(std::fs::read(&target).unwrap(), b"new-appimage");
        assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o755);
        assert_eq!(std::fs::read_link(bin_dir.join("flurer")).unwrap(), target);
        let entry = std::fs::read_to_string(&autostart).unwrap();
        assert!(entry.contains(&format!("Exec={} --minimized", target.display())), "{entry}");
    }
}
