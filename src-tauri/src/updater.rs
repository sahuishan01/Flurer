use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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

#[tauri::command]
pub async fn download_and_install_update(url: String) -> Result<(), String> {
    log::info!("download_and_install_update: starting download from {url}");
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .inspect_err(|e| log::error!("download_and_install_update: request failed: {e}"))
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !resp.status().is_success() {
        log::error!("download_and_install_update: HTTP {}", resp.status());
        return Err(format!("Download returned HTTP {}", resp.status()));
    }

    let total_size = resp
        .content_length()
        .unwrap_or(0);

    // Stream to a temp file
    let temp_dir = std::env::temp_dir();
    let file_name = url
        .split('/')
        .last()
        .unwrap_or("flurer-update.msi");

    let output_path = temp_dir.join(file_name);
    let bytes = resp
        .bytes()
        .await
        .inspect_err(|e| log::error!("download_and_install_update: failed to read download stream: {e}"))
        .map_err(|e| format!("Failed to read download stream: {e}"))?;

    tokio::fs::write(&output_path, &bytes)
        .await
        .inspect_err(|e| {
            log::error!("download_and_install_update: failed to write {}: {e}", output_path.display())
        })
        .map_err(|e| format!("Failed to write installer to disk: {e}"))?;

    // Launch the installer
    let installer_path = output_path.to_string_lossy().to_string();
    let is_msi = file_name.ends_with(".msi");

    let child = if is_msi {
        launch_elevated("msiexec", &["/i", &installer_path, "/promptrestart"])
    } else {
        launch_elevated(&installer_path, &[])
    };

    child
        .map(|_| {
            log::info!("download_and_install_update: launched installer {installer_path} ({total_size} bytes)");
        })
        .map_err(|e| {
            log::error!("download_and_install_update: failed to launch installer {installer_path}: {e}");
            format!("Failed to launch installer: {e}")
        })
}

// Both bundle targets' installers request admin rights in their manifest
// (the NSIS one since installMode "both" lets a user pick a per-machine
// install; msiexec always does for a per-machine MSI). Spawning them with
// `Command::spawn()` calls CreateProcess directly, which — unlike
// ShellExecute — does NOT honor a "requireAdministrator" manifest: instead
// of showing the UAC consent prompt, it fails outright with
// ERROR_ELEVATION_REQUIRED (os error 740). Routing through PowerShell's
// `Start-Process -Verb RunAs` uses ShellExecute internally, which is what
// actually triggers the UAC dialog the way double-clicking the installer
// in Explorer would.
fn launch_elevated(path: &str, args: &[&str]) -> std::io::Result<std::process::Child> {
    fn ps_quote(s: &str) -> String {
        format!("'{}'", s.replace('\'', "''"))
    }

    let mut command = format!("Start-Process -FilePath {}", ps_quote(path));
    if !args.is_empty() {
        let arg_list = args.iter().map(|a| ps_quote(a)).collect::<Vec<_>>().join(",");
        command.push_str(&format!(" -ArgumentList {arg_list}"));
    }
    command.push_str(" -Verb RunAs");

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &command]);

    // Prevent the PowerShell launcher itself from flashing a console
    // window — the UAC prompt (and the installer's own UI) still show;
    // this only hides the intermediate powershell.exe process.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
}