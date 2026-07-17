use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Read, Seek},
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use tempfile::tempdir;

use crate::helpers::settings::atomic_write;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub entry: String,
}

fn config_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".config").join("flurer"))
}

fn plugins_dir() -> Result<PathBuf, String> {
    let root = config_root()?;
    let dir = root.join("plugins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn list_installed_plugins() -> Result<Vec<PluginManifest>, String> {
    let dir = plugins_dir()?;
    let mut installed = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let manifest_path = entry.path().join("plugin.json");
                    if manifest_path.is_file() {
                        if let Ok(content) = fs::read_to_string(manifest_path) {
                            if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                                installed.push(manifest);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(installed)
}

#[tauri::command]
pub async fn load_plugin_code(id: String) -> Result<String, String> {
    let dir = plugins_dir()?;
    let plugin_dir = dir.join(&id);
    let manifest_path = plugin_dir.join("plugin.json");

    if !manifest_path.is_file() {
        return Err(format!("Plugin {} manifest not found", id));
    }

    let manifest_content = fs::read_to_string(manifest_path).map_err(|e| e.to_string())?;
    let manifest = serde_json::from_str::<PluginManifest>(&manifest_content).map_err(|e| e.to_string())?;

    let entry_path = plugin_dir.join(&manifest.entry);
    if !entry_path.is_file() {
        return Err(format!("Plugin {} entry file {} not found", id, manifest.entry));
    }

    fs::read_to_string(entry_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_plugin(id: String) -> Result<(), String> {
    let dir = plugins_dir()?;
    let plugin_dir = dir.join(&id);
    if plugin_dir.is_dir() {
        fs::remove_dir_all(plugin_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a GitHub URL or `owner/repo` shorthand into (owner, repo).
fn parse_github_url(input: &str) -> Result<(String, String), String> {
    let trimmed = input.trim().trim_matches('/');

    if let Ok(parsed) = url::Url::parse(trimmed) {
        if parsed.host_str() == Some("github.com") {
            let path = parsed.path().trim_matches('/');
            let parts: Vec<&str> = path.split('/').collect();
            if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
                let repo = parts[1].trim_end_matches(".git");
                return Ok((parts[0].to_string(), repo.to_string()));
            }
        }
    }

    // Try as "owner/repo" shorthand
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        let repo = parts[1].trim_end_matches(".git");
        return Ok((parts[0].to_string(), repo.to_string()));
    }

    Err("Invalid GitHub URL. Expected format: https://github.com/owner/repo or owner/repo".to_string())
}

/// Recursively copy a directory tree (std::fs does not provide this).
fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        if file_type.is_dir() {
            copy_dir(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Extract a plugin ZIP into `target_dir`, handling both flat and
/// nested (e.g. `owner-repo-1.0.0/`) structures. Returns the parsed manifest.
fn extract_plugin_zip<R: Read + Seek>(
    mut archive: zip::ZipArchive<R>,
    target_dir: &Path,
) -> Result<PluginManifest, String> {
    // Pass 1: find plugin.json and determine the base path to strip
    let mut base_path = String::new();
    let mut found = false;

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        let segments: Vec<&str> = name.split('/').collect();

        if segments.last() == Some(&"plugin.json") {
            if segments.len() > 1 {
                let prefix: Vec<&str> = segments[..segments.len() - 1].iter().copied().collect();
                base_path = prefix.join("/") + "/";
            }
            found = true;
            break;
        }
    }

    if !found {
        return Err("No plugin.json found in the ZIP archive".to_string());
    }

    // Pass 2: extract every file, stripping the base path
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        if name.ends_with('/') {
            continue;
        }

        let relative = if !base_path.is_empty() {
            name.strip_prefix(&base_path).unwrap_or(&name)
        } else {
            &name
        };

        // Path traversal guard
        if relative.is_empty() || relative.starts_with('/') || relative.starts_with("..") {
            continue;
        }

        let output_path = target_dir.join(relative);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(|e| e.to_string())?;
        fs::write(&output_path, &data).map_err(|e| e.to_string())?;
    }

    // Read and return the manifest
    let manifest_path = target_dir.join("plugin.json");
    let content = fs::read_to_string(&manifest_path).map_err(|e| format!("Failed to read plugin.json: {e}"))?;
    serde_json::from_str::<PluginManifest>(&content).map_err(|e| format!("Invalid plugin.json: {e}"))
}

// ---------------------------------------------------------------------------
// Plugin installation commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn install_plugin_from_github(repo_url: String) -> Result<PluginManifest, String> {
    let (owner, repo) = parse_github_url(&repo_url)?;

    let api_url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
    let client = reqwest::Client::new();

    let resp = client
        .get(&api_url)
        .header("User-Agent", "Flurer/0.4.19")
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

    let assets = release["assets"]
        .as_array()
        .ok_or("No assets found in the latest release")?;

    let zip_asset = assets
        .iter()
        .find(|a| a["name"].as_str().map_or(false, |n| n.ends_with(".zip")))
        .ok_or_else(|| {
            "No .zip asset found in the latest release. The release must have a .zip attached.".to_string()
        })?;

    let download_url = zip_asset["browser_download_url"]
        .as_str()
        .ok_or("Missing download URL in release asset")?;

    // Download the full ZIP into memory
    let zip_bytes = client
        .get(download_url)
        .header("User-Agent", "Flurer/0.4.19")
        .send()
        .await
        .map_err(|e| format!("Failed to download ZIP: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read ZIP data: {e}"))?;

    // Extract to a temp directory
    let temp = tempdir().map_err(|e| e.to_string())?;
    let cursor = Cursor::new(zip_bytes.to_vec());
    let archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid ZIP: {e}"))?;
    let manifest = extract_plugin_zip(archive, temp.path())?;

    // Move into the permanent plugin directory
    let plugins = plugins_dir()?;
    let plugin_dir = plugins.join(&manifest.id);
    if plugin_dir.exists() {
        return Err(format!("Plugin \"{}\" is already installed", manifest.id));
    }

    copy_dir(temp.path(), &plugin_dir)?;

    Ok(manifest)
}

#[tauri::command]
pub async fn install_plugin_from_zip(zip_path: String) -> Result<PluginManifest, String> {
    let zip_bytes = fs::read(&zip_path).map_err(|e| format!("Failed to read ZIP file: {e}"))?;

    let temp = tempdir().map_err(|e| e.to_string())?;
    let cursor = Cursor::new(zip_bytes);
    let archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid ZIP file: {e}"))?;
    let manifest = extract_plugin_zip(archive, temp.path())?;

    let plugins = plugins_dir()?;
    let plugin_dir = plugins.join(&manifest.id);
    if plugin_dir.exists() {
        return Err(format!("Plugin \"{}\" is already installed", manifest.id));
    }

    copy_dir(temp.path(), &plugin_dir)?;

    Ok(manifest)
}
