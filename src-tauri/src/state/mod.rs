use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{
    configs::Config,
    fs::{SortDirection, SortKey},
    sizecache::SizeCacheState,
};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Light,
    Dark,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundType {
    #[default]
    None,
    Gradient,
    Solid,
    Unsplash,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum UnsplashMode {
    #[default]
    Fixed,
    AutoRotateCategory,
    AutoRotateList,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum LastMainView {
    #[default]
    Explorer,
    Graph,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct BackgroundSettings {
    pub background_type: BackgroundType,
    pub opacity: f32,
    pub gradient_color1: String,
    pub gradient_color2: String,
    pub gradient_direction: String,
    pub solid_color: String,
    pub unsplash_mode: UnsplashMode,
    pub unsplash_category: Option<String>,
    pub unsplash_fixed_list: Vec<String>,
    pub unsplash_change_frequency_ms: u64,
}

impl Default for BackgroundSettings {
    fn default() -> Self {
        Self {
            background_type: BackgroundType::default(),
            opacity: 0.35,
            gradient_color1: "#667eea".to_string(),
            gradient_color2: "#764ba2".to_string(),
            gradient_direction: "to bottom right".to_string(),
            solid_color: "#1f2937".to_string(),
            unsplash_mode: UnsplashMode::default(),
            unsplash_category: None,
            unsplash_fixed_list: Vec::new(),
            unsplash_change_frequency_ms: 5 * 60 * 1000,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodePosition {
    pub node_id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct GraphState {
    pub expanded_node_ids: Vec<String>,
    pub pan_x: f64,
    pub pan_y: f64,
    pub zoom: f64,
    pub node_positions: Vec<GraphNodePosition>,
}

#[derive(Serialize, Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub wallpaper: Option<PathBuf>,
    pub background: BackgroundSettings,
    pub theme: Theme,
    pub ui_tint_opacity: f32,
    pub ui_blur_px: f32,
    pub last_main_view: LastMainView,
    pub persist_graph_state: bool,
    pub graph_state: Option<GraphState>,
    pub favourite_paths: Vec<String>,
    // Most-recently-visited first; the frontend caps and dedupes this list
    // (see recordRecent in App.tsx) rather than the backend, since it's just
    // opaque persisted state from Rust's point of view.
    pub recent_paths: Vec<String>,
    pub sort_key: SortKey,
    pub sort_direction: SortDirection,
    pub font_family: String,
    pub font_size_px: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            wallpaper: None,
            background: BackgroundSettings::default(),
            theme: Theme::default(),
            ui_tint_opacity: 0.35,
            ui_blur_px: 12.0,
            last_main_view: LastMainView::default(),
            persist_graph_state: true,
            graph_state: None,
            favourite_paths: Vec::new(),
            recent_paths: Vec::new(),
            sort_key: SortKey::default(),
            sort_direction: SortDirection::default(),
            font_family: "Inter, Avenir, Helvetica, Arial, sans-serif".to_string(),
            font_size_px: 16.0,
        }
    }
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config: Config,
    pub size_cache: SizeCacheState,
}
