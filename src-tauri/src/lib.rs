mod configs;
mod disks;
mod fs;
mod helpers;
mod network;
mod sizecache;
mod state;

use disks::get_disk_topology;
use fs::{
    copy_items, create_folder, delete_items, get_quick_access, list_directory, list_graph_children, move_items,
    rename_item, search_directory,
};
use helpers::settings::{get_settings, load_settings, set_settings};
use network::get_wallpaper;
use sizecache::{get_folder_size, recompute_folder_size};
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
                size_cache: Default::default(),
            });
            sizecache::init(&app.handle());
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
            list_graph_children,
            search_directory,
            get_disk_topology,
            get_folder_size,
            recompute_folder_size,
            get_settings,
            set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
