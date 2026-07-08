use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{configs::resolve_unsplash_api_key, state::AppState};

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
pub struct Wallpaper {
    pub id: String,
    pub description: Option<String>,
    pub urls: WallpaperUrls,
    pub user: WallpaperAuthor,
}

#[tauri::command]
pub async fn get_wallpaper(
    state: State<'_, AppState>,
    query: Option<String>,
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

    response
        .json::<Wallpaper>()
        .await
        .map_err(|e| e.to_string())
}
