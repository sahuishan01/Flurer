mod configs;
mod fs;
mod helpers;
mod network;
mod state;

use fs::{copy_items, create_folder, delete_items, get_quick_access, list_directory, move_items, rename_item};
use helpers::settings::{get_settings, load_settings, set_settings};
use network::get_wallpaper;
use tauri::Manager;
use tokio::sync::Mutex;

use crate::{configs::Config, state::AppState};

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
        .invoke_handler(tauri::generate_handler![
            get_wallpaper,
            list_directory,
            copy_items,
            move_items,
            delete_items,
            rename_item,
            create_folder,
            get_quick_access,
            get_settings,
            set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
