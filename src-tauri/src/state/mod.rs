use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{configs::Config, sizecache::SizeCacheState};

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

#[derive(Serialize, Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub wallpaper: Option<PathBuf>,
    pub background: BackgroundSettings,
    pub theme: Theme,
    pub ui_tint_opacity: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            wallpaper: None,
            background: BackgroundSettings::default(),
            theme: Theme::default(),
            ui_tint_opacity: 0.35,
        }
    }
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config: Config,
    pub size_cache: SizeCacheState,
}
