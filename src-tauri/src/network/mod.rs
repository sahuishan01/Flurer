use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

use crate::{
    configs::resolve_unsplash_api_key,
    helpers::settings::{atomic_write, wallpaper_cache_path, wallpaper_metadata_path},
    state::AppState,
};

fn default_content_type() -> String {
    "image/jpeg".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WallpaperMetadata {
    updated_at_ms: u64,
    // Recorded per-download rather than assumed, since a wallpaper source
    // URL isn't guaranteed to serve JPEG — a data: URL's declared MIME type
    // is trusted as-is by the browser, so a wrong hardcoded type could
    // silently fail to render. Old metadata files predating this field
    // deserialize as JPEG, matching what was always hardcoded before.
    #[serde(default = "default_content_type")]
    content_type: String,
    // What the cached image actually is: the resolved category for
    // fixed/autoRotateCategory, or the specific source URL for the fixed
    // rotation list. Lets the frontend tell whether the shared cache still
    // matches the mode it's about to display, instead of only knowing
    // "something was cached recently" — see get_cached_wallpaper_image.
    #[serde(default)]
    source_key: String,
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// Best-effort — a failure to record "just updated" isn't worth failing the
// whole fetch over, it just means the next staleness check falls back to
// treating the wallpaper as due for a refresh.
fn record_wallpaper_updated(content_type: &str, source_key: &str) {
    let Ok(path) = wallpaper_metadata_path() else {
        return;
    };
    let metadata = WallpaperMetadata {
        updated_at_ms: now_millis(),
        content_type: content_type.to_string(),
        source_key: source_key.to_string(),
    };
    let Ok(data) = serde_json::to_string(&metadata) else {
        return;
    };
    let _ = atomic_write(&path, data.as_bytes());
}

fn read_wallpaper_metadata() -> Option<WallpaperMetadata> {
    let path = wallpaper_metadata_path().ok()?;
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
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

// Sets w/h/fit/q on `base`, replacing any values it already has for those
// keys rather than appending duplicates — Unsplash's `full` URLs commonly
// already carry their own q=/fit=-equivalent params, and blindly
// concatenating another copy left the outcome up to however the CDN
// happens to resolve duplicate query keys.
fn sized_image_url(base: &str, width: Option<u32>, height: Option<u32>) -> String {
    let Ok(mut url) = url::Url::parse(base) else {
        return base.to_string();
    };

    let mut overrides: Vec<(&str, String)> = Vec::new();
    if let Some(w) = width {
        overrides.push(("w", w.to_string()));
    }
    if let Some(h) = height {
        overrides.push(("h", h.to_string()));
    }
    overrides.push(("fit", "crop".to_string()));
    overrides.push(("q", "80".to_string()));

    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| !overrides.iter().any(|(ok, _)| *ok == k.as_ref()))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    let mut pairs = url.query_pairs_mut();
    pairs.clear();
    for (k, v) in kept.iter().map(|(k, v)| (k.as_str(), v.as_str())).chain(overrides.iter().map(|(k, v)| (*k, v.as_str()))) {
        pairs.append_pair(k, v);
    }
    drop(pairs);

    url.to_string()
}

// Downloads the image at `url` (server-side, never handed to the webview
// directly), caches it to disk under the shared wallpaper cache file
// (replacing whatever was there before), and returns the bytes re-encoded
// as a data: URL the frontend can drop straight into a CSS background-image.
// `source_key` identifies what was actually fetched (a category, or a fixed
// rotation-list URL) so a later get_cached_wallpaper_image caller can tell
// whether this cached image still matches the mode it's about to show.
async fn download_and_cache_image(url: &str, source_key: &str) -> Result<String, String> {
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .filter(|s| s.starts_with("image/"))
        .unwrap_or_else(default_content_type);
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let cache_path = wallpaper_cache_path()?;
    atomic_write(&cache_path, &bytes).map_err(|e| e.to_string())?;
    record_wallpaper_updated(&content_type, source_key);

    Ok(format!("data:{content_type};base64,{}", STANDARD.encode(&bytes)))
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
    let source_key = query.as_deref().unwrap_or("nature");
    let local_data_url = download_and_cache_image(&sized_url, source_key).await?;

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
    download_and_cache_image(&sized_url, &url).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedWallpaper {
    pub data_url: String,
    // Empty for cache files written before this field existed — the
    // frontend treats an empty source key as "unknown, don't assume it
    // matches the current mode" rather than a false match.
    pub source_key: String,
}

// A synchronous, network-free read of whatever image was cached last
// session, so startup can paint a background immediately instead of
// blocking on an Unsplash round-trip — the real fetch still happens, just
// after the app is already up, and replaces this once it resolves. Includes
// the source key so the frontend can tell whether this cached image still
// matches the mode it's about to display, or is left over from a mode the
// user has since switched away from.
#[tauri::command]
pub fn get_cached_wallpaper_image() -> Result<Option<CachedWallpaper>, String> {
    let cache_path = wallpaper_cache_path()?;
    if !cache_path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&cache_path).map_err(|e| e.to_string())?;
    let metadata = read_wallpaper_metadata();
    let content_type = metadata.as_ref().map(|m| m.content_type.clone()).unwrap_or_else(default_content_type);
    let source_key = metadata.map(|m| m.source_key).unwrap_or_default();
    Ok(Some(CachedWallpaper {
        data_url: format!("data:{content_type};base64,{}", STANDARD.encode(&bytes)),
        source_key,
    }))
}

// Lets every running instance check, before fetching, whether the shared
// wallpaper is already fresh enough — so a scheduled refresh only happens
// once (wherever it's checked first) instead of once per open window.
#[tauri::command]
pub fn get_wallpaper_updated_at() -> Result<Option<u64>, String> {
    Ok(read_wallpaper_metadata().map(|m| m.updated_at_ms))
}
