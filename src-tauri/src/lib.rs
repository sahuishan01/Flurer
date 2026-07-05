mod configs;
mod fs;
mod helpers;
mod network;
mod state;

use fs::list_directory;
use network::get_wallpaper;
use tauri::Manager;
use tokio::sync::Mutex;

use crate::{configs::Config, helpers::settings::load_settings, state::AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings = load_settings(&app.handle());
            let config = Config::load();
            app.manage(AppState {
                settings: Mutex::new(settings),
                config,
            });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_wallpaper, list_directory])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
