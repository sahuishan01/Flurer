use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{
    configs::Config,
    fs::{SortDirection, SortKey},
    sizecache::{CachedSize, SizeCacheState},
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
    // Multiple categories, so "auto rotate from category" can cycle across
    // all of them instead of being pinned to one. `#[serde(default)]` at
    // the struct level means settings saved before this was plural just
    // deserialize this as empty rather than failing to load.
    pub unsplash_categories: Vec<String>,
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
            unsplash_categories: Vec::new(),
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
    // Path -> hex color ("#rrggbb"), for the color-tag dot shown next to an
    // item (file or folder — the field name predates files getting tags
    // too) in the file list and sidebar. A plain map rather than a struct
    // per entry since color is the only per-path attribute this feature
    // needs; absence of a key means "no tag", not "default color".
    #[serde(default)]
    pub folder_colors: HashMap<String, String>,
    // Action id ("delete", "rename", "copy", "cut", "paste", "selectAll") ->
    // key combo string ("Ctrl+C", "Delete", "F2", …), for FileList's
    // configurable in-app shortcuts. Distinct from global_shortcut below,
    // which is the OS-wide show-Flurer hotkey. An action missing from this
    // map falls back to its hardcoded default in the frontend
    // (DEFAULT_IN_APP_SHORTCUTS in lib/shortcuts.ts) rather than needing
    // every action to have an explicit entry from day one.
    #[serde(default)]
    pub in_app_shortcuts: HashMap<String, String>,
    // Most-recently-visited first; the frontend caps and dedupes this list
    // (see recordRecent in App.tsx) rather than the backend, since it's just
    // opaque persisted state from Rust's point of view.
    pub recent_paths: Vec<String>,
    // Maximum number of recent paths shown in the sidebar and retained on
    // disk. The frontend trims the list immediately when this changes.
    #[serde(default = "default_max_history_items")]
    pub max_history_items: usize,
    pub sort_key: SortKey,
    pub sort_direction: SortDirection,
    pub font_family: String,
    pub font_size_px: f32,
    pub sidebar_tooltip_delay_ms: u64,
    pub show_progress_when_idle: bool,
    // Whether filesystem changes should update cached folder sizes live.
    // Explicit Recalculate remains available when this is disabled.
    #[serde(default = "default_live_folder_size_updates")]
    pub live_folder_size_updates: bool,
    #[serde(default)]
    pub plugin_settings: std::collections::HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub disabled_plugins: Vec<String>,
    #[serde(default)]
    pub folder_sizes: HashMap<String, CachedSize>,
    // OS-wide hotkey that brings the window to front/focus from anywhere,
    // even when Flurer isn't focused (or is minimized). Defaults to
    // Ctrl+Alt+E, both here (for settings files predating this field) and
    // in Default::default() below. An explicit empty string means "no
    // shortcut" (user disabled it) and is left as-is, not silently
    // replaced with the default — see shortcuts::register/unregister,
    // which both treat "" as a no-op.
    #[serde(default = "default_global_shortcut")]
    pub global_shortcut: String,
    // Whether Flurer launches (minimized to the tray) on login, so the
    // global shortcut above is live from boot rather than only after the
    // user has opened the app at least once that session. Off by default —
    // this is an opt-in, not something we register on the user's behalf
    // without asking.
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default = "default_window_width")]
    pub window_width: u32,
    #[serde(default = "default_window_height")]
    pub window_height: u32,
    // Whether the window was maximized when last closed, so relaunch can
    // restore that state with `Window::maximize()` instead of merely
    // resizing to the maximized dimensions (which leaves the window
    // "un-maximized but full-screen-sized" — no restore semantics, no
    // maximize icon toggled, and it ignores taskbar-reserved space).
    #[serde(default)]
    pub window_maximized: bool,
}

fn default_global_shortcut() -> String {
    "Ctrl+Alt+E".to_string()
}

fn default_max_history_items() -> usize {
    15
}

fn default_live_folder_size_updates() -> bool {
    true
}

fn default_window_width() -> u32 {
    800
}

fn default_window_height() -> u32 {
    600
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
            folder_colors: HashMap::new(),
            in_app_shortcuts: HashMap::new(),
            recent_paths: Vec::new(),
            max_history_items: default_max_history_items(),
            sort_key: SortKey::default(),
            sort_direction: SortDirection::default(),
            font_family: "Inter, Avenir, Helvetica, Arial, sans-serif".to_string(),
            font_size_px: 16.0,
            sidebar_tooltip_delay_ms: 500,
            show_progress_when_idle: false,
            live_folder_size_updates: default_live_folder_size_updates(),
            plugin_settings: std::collections::HashMap::new(),
            disabled_plugins: Vec::new(),
            folder_sizes: HashMap::new(),
            global_shortcut: default_global_shortcut(),
            launch_at_startup: false,
            window_width: default_window_width(),
            window_height: default_window_height(),
            window_maximized: false,
        }
    }
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config: Config,
    pub size_cache: SizeCacheState,
    // The folder `flurer .` / `flurer <path>` was launched with, if any —
    // set once from argv in lib.rs's setup() and consumed (take()n, not just
    // read) by the take_launch_path command the frontend calls on its first
    // mount, so a later window spawned in the same process doesn't also
    // pick up the same startup path.
    pub launch_path: std::sync::Mutex<Option<String>>,
}
