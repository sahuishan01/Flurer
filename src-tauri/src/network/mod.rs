use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

use crate::{
    configs::resolve_unsplash_api_key,
    helpers::settings::{wallpaper_cache_path, wallpaper_metadata_path},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WallpaperMetadata {
    updated_at_ms: u64,
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// Best-effort — a failure to record "just updated" isn't worth failing the
// whole fetch over, it just means the next staleness check falls back to
// treating the wallpaper as due for a refresh.
fn record_wallpaper_updated() {
    let Ok(path) = wallpaper_metadata_path() else {
        return;
    };
    let metadata = WallpaperMetadata { updated_at_ms: now_millis() };
    let Ok(data) = serde_json::to_string(&metadata) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if fs::write(&temp, data).is_ok() {
        let _ = fs::rename(&temp, &path);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperUrls {
    pub raw: String,
    pub full: String,
    pub regular: String,
    pub small: String,
    pub thumb: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperAuthor {
    pub name: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wallpaper {
    pub id: String,
    pub description: Option<String>,
    pub urls: WallpaperUrls,
    pub user: WallpaperAuthor,
    // A data: URL of the actual downloaded image, not a hotlinked Unsplash
    // URL — the app never points the webview straight at a third-party URL
    // for the live background, it fetches the bytes itself first.
    pub local_data_url: String,
}

fn sized_image_url(base: &str, width: Option<u32>, height: Option<u32>) -> String {
    let mut url = base.to_string();
    let sep = if url.contains('?') { '&' } else { '?' };
    url.push(sep);
    let mut parts = Vec::new();
    if let Some(w) = width {
        parts.push(format!("w={w}"));
    }
    if let Some(h) = height {
        parts.push(format!("h={h}"));
    }
    parts.push("fit=crop".to_string());
    parts.push("q=80".to_string());
    url.push_str(&parts.join("&"));
    url
}

// Downloads the image at `url` (server-side, never handed to the webview
// directly), caches it to disk under the shared wallpaper cache file
// (replacing whatever was there before), and returns the bytes re-encoded
// as a data: URL the frontend can drop straight into a CSS background-image.
async fn download_and_cache_image(url: &str) -> Result<String, String> {
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let cache_path = wallpaper_cache_path()?;
    let temp = cache_path.with_extension("jpg.tmp");
    fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, &cache_path).map_err(|e| e.to_string())?;
    record_wallpaper_updated();

    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&bytes)))
}

#[tauri::command]
pub async fn get_wallpaper(
    state: State<'_, AppState>,
    query: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<Wallpaper, String> {
    let client_id = resolve_unsplash_api_key(&state.config)
        .ok_or_else(|| "Unsplash isn't configured yet — add an API key in Settings".to_string())?;
    let client = reqwest::Client::new();

    let mut request = client
        .get("https://api.unsplash.com/photos/random")
        .query(&[
            ("client_id", client_id.as_str()),
            ("orientation", "landscape"),
        ]);

    if let Some(query) = query.as_deref() {
        request = request.query(&[("query", query)]);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Unsplash request failed with status {}",
            response.status()
        ));
    }

    #[derive(Deserialize)]
    struct UnsplashPhoto {
        id: String,
        description: Option<String>,
        urls: WallpaperUrls,
        user: WallpaperAuthor,
    }

    let photo = response.json::<UnsplashPhoto>().await.map_err(|e| e.to_string())?;
    let sized_url = sized_image_url(&photo.urls.full, width, height);
    let local_data_url = download_and_cache_image(&sized_url).await?;

    Ok(Wallpaper {
        id: photo.id,
        description: photo.description,
        urls: photo.urls,
        user: photo.user,
        local_data_url,
    })
}

// Used for the fixed rotation-list mode, where the frontend already knows
// the image URL up front (no Unsplash API lookup needed) but the image
// itself still has to be fetched and cached rather than hotlinked.
#[tauri::command]
pub async fn fetch_wallpaper_image(
    url: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<String, String> {
    let sized_url = sized_image_url(&url, width, height);
    download_and_cache_image(&sized_url).await
}

// A synchronous, network-free read of whatever image was cached last
// session, so startup can paint a background immediately instead of
// blocking on an Unsplash round-trip — the real fetch still happens, just
// after the app is already up, and replaces this once it resolves.
#[tauri::command]
pub fn get_cached_wallpaper_image() -> Result<Option<String>, String> {
    let cache_path = wallpaper_cache_path()?;
    if !cache_path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&cache_path).map_err(|e| e.to_string())?;
    Ok(Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(&bytes))))
}

// Lets every running instance check, before fetching, whether the shared
// wallpaper is already fresh enough — so a scheduled refresh only happens
// once (wherever it's checked first) instead of once per open window.
#[tauri::command]
pub fn get_wallpaper_updated_at() -> Result<Option<u64>, String> {
    let path = wallpaper_metadata_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let Ok(data) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    let Ok(metadata) = serde_json::from_str::<WallpaperMetadata>(&data) else {
        return Ok(None);
    };
    Ok(Some(metadata.updated_at_ms))
}
