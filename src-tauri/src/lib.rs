mod configs;
mod disks;
mod fs;
mod helpers;
mod logging;
mod network;
mod plugins;
mod progress;
mod shortcuts;
mod sizecache;
mod state;
mod updater;

use disks::get_disk_topology;
use fs::{
    cancel_operation, copy_items, create_folder, delete_items, get_quick_access, list_directory, list_graph_children,
    move_items, rename_item, search_directory,
};
use helpers::settings::{get_settings, load_settings, set_settings};
use network::{fetch_wallpaper_image, get_cached_wallpaper_image, get_wallpaper, get_wallpaper_updated_at, search_wallpapers};
use sizecache::{get_folder_size, recompute_folder_size};
use tauri::Manager;
use tokio::sync::Mutex;

use configs::{has_unsplash_api_key, set_unsplash_api_key};
use plugins::{
    check_plugin_updates, git::{
        git_branches, git_checkout, git_commit, git_log, git_pull, git_push, git_repo_status, git_stage,
        git_unstage,
    },
    install_plugin_from_github, install_plugin_from_zip, list_installed_plugins, load_plugin_code,
    uninstall_plugin, update_plugin, link_plugin_repo,
};

use crate::{configs::Config, state::AppState};
use updater::{check_for_updates, download_and_install_update};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must be first: installs the panic hook and file logger so any failure
    // during setup below (or any panic for the rest of the process's life)
    // is captured to %LOCALAPPDATA%/.flurer/{logs,crashes} instead of being
    // lost to a terminal the packaged app doesn't have.
    logging::init();

    tauri::Builder::default()
        .setup(|app| {
            let settings = load_settings(&app.handle());
            // Settings::default() (and its serde field default) already
            // resolve a missing/never-saved value to shortcuts::DEFAULT_SHORTCUT
            // — an empty string here can only mean the user explicitly
            // cleared it to turn the shortcut off, which register() treats
            // as a no-op rather than silently falling back to the default.
            shortcuts::register(&app.handle(), &settings.global_shortcut);
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
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        shortcuts::show_and_focus_main_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_wallpaper,
            fetch_wallpaper_image,
            get_cached_wallpaper_image,
            get_wallpaper_updated_at,
            search_wallpapers,
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
            cancel_operation,
            get_settings,
            set_settings,
            has_unsplash_api_key,
            set_unsplash_api_key,
            list_installed_plugins,
            load_plugin_code,
            install_plugin_from_github,
            install_plugin_from_zip,
            uninstall_plugin,
            check_plugin_updates,
            update_plugin,
            link_plugin_repo,
            // Git plugin commands
            git_repo_status,
            git_branches,
            git_log,
            git_stage,
            git_unstage,
            git_commit,
            git_push,
            git_pull,
            git_checkout,
            // Updater
            check_for_updates,
            download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
