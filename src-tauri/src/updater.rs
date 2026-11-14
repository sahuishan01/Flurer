use serde::{Deserialize, Serialize};

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
fn is_per_machine_install() -> bool {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_lowercase().contains("program files"))
        .unwrap_or(false)
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
