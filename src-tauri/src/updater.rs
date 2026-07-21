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
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
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

    // Find the first MSI or NSIS installer asset
    let assets = release["assets"].as_array().ok_or("No assets found")?;
    let download_url = assets
        .iter()
        .find(|a| {
            a["name"]
                .as_str()
                .map(|n| n.ends_with(".msi") || n.ends_with(".exe"))
                .unwrap_or(false)
        })
        .and_then(|a| a["browser_download_url"].as_str().map(String::from))
        .ok_or("No installer asset found in the latest release")?;

    let release_url = release["html_url"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| format!("https://github.com/{GITHUB_REPO}/releases/tag/{tag_name}"));

    let release_body = release["body"]
        .as_str()
        .unwrap_or("")
        .to_string();

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
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !resp.status().is_success() {
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
        .map_err(|e| format!("Failed to read download stream: {e}"))?;

    tokio::fs::write(&output_path, &bytes)
        .await
        .map_err(|e| format!("Failed to write installer to disk: {e}"))?;

    // Launch the installer
    let installer_path = output_path.to_string_lossy().to_string();
    let is_msi = file_name.ends_with(".msi");

    // Spawn a detached process so the installer runs even if the app closes
    let child = if is_msi {
        std::process::Command::new("msiexec")
            .args(["/i", &installer_path, "/promptrestart"])
            .spawn()
    } else {
        std::process::Command::new(&installer_path)
            .spawn()
    };

    child
        .map(|_| ())
        .map_err(|e| format!("Failed to launch installer: {e}"))
}