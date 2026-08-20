mod archive;
mod cli;
mod configs;
mod dirwatch;
mod disks;
mod drag_out;
mod duplicates;
mod fs;
mod helpers;
mod logging;
mod network;
mod plugins;
mod progress;
mod shortcuts;
mod sizecache;
mod state;
mod tray;
mod trash_bin;
mod updater;

use archive::{compress_to_zip, extract_archive};
use cli::take_launch_path;
use dirwatch::{unwatch_directory, watch_directory};
use disks::get_disk_topology;
use drag_out::set_external_drop_allowed;
use duplicates::find_duplicates;
use fs::{
    cancel_operation, copy_items, create_file, create_folder, delete_items, get_file_preview, get_path_metadata,
    get_quick_access, list_directory, list_directory_streamed, list_graph_children, move_items,
    open_file_with_default, open_terminal_here, pick_folder, rename_item, search_content, search_directory,
};
use helpers::settings::{get_settings, load_settings, set_settings};
use network::{fetch_wallpaper_image, get_cached_wallpaper_image, get_wallpaper, get_wallpaper_updated_at, search_wallpapers};
use sizecache::{clear_folder_size_cache, get_folder_size, get_folder_size_cache_stats, recompute_folder_size};
use tauri::{Manager, PhysicalSize};
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
use trash_bin::{delete_trash_items_forever, empty_trash, list_trash, restore_trash_items};
use updater::{check_for_updates, download_and_install_update, relaunch_as_admin};

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
            tray::sync_autostart(&app.handle(), settings.launch_at_startup);
            tray::setup(&app.handle())?;
            let config = Config::load();
            let window_width = settings.window_width.clamp(400, 3840);
            let window_height = settings.window_height.clamp(300, 2160);
            let window_maximized = settings.window_maximized;
            // `flurer .` / `flurer <path>` — resolved once here from this
            // process's own argv/cwd (cold start; see cli.rs's doc comment
            // on why there's no cross-process forwarding for an
            // already-running instance).
            let launch_path = std::env::current_dir()
                .ok()
                .and_then(|cwd| cli::resolve_launch_path(&std::env::args().collect::<Vec<_>>(), &cwd));
            app.manage(AppState {
                settings: Mutex::new(settings),
                config,
                size_cache: Default::default(),
                launch_path: std::sync::Mutex::new(launch_path),
            });
            if let Some(window) = app.get_webview_window("main") {
                // Restore the saved size first so un-maximizing later lands
                // back on it, then maximize on top if that's how the window
                // was left — maximizing alone (without a saved restore size)
                // would leave `set_size` as the un-maximize target instead.
                window.set_size(PhysicalSize::new(window_width, window_height))?;
                if window_maximized {
                    window.maximize()?;
                }
            }
            // The window starts hidden (see tauri.conf.json) so a
            // login-triggered autostart launch never flashes it open before
            // we get a chance to restore its saved size and check for
            // --minimized.
            if !tray::launched_minimized() {
                shortcuts::show_and_focus_main_window(&app.handle());
            }
            sizecache::init(&app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::Builder::new().args([tray::MINIMIZED_ARG]).build())
        .plugin(tauri_plugin_drag::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Always opens a new window, same as Explorer's Win+E —
                    // see shortcuts::spawn_new_window for why this isn't
                    // show_and_focus_main_window.
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        shortcuts::spawn_new_window(app);
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
            list_directory_streamed,
            watch_directory,
            unwatch_directory,
            copy_items,
            move_items,
            delete_items,
            rename_item,
            create_folder,
            create_file,
            get_path_metadata,
            get_file_preview,
            get_quick_access,
            list_graph_children,
            search_directory,
            search_content,
            get_disk_topology,
            get_folder_size,
            recompute_folder_size,
            get_folder_size_cache_stats,
            clear_folder_size_cache,
            open_file_with_default,
            open_terminal_here,
            pick_folder,
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
            relaunch_as_admin,
            // Recycle Bin
            list_trash,
            restore_trash_items,
            delete_trash_items_forever,
            empty_trash,
            // Archive
            compress_to_zip,
            extract_archive,
            // Duplicate finder
            find_duplicates,
            // CLI "open this folder" support
            take_launch_path,
            // Native row drag-out (see dnd.ts)
            set_external_drop_allowed,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // Flush the folder-size cache on the way out rather than relying on
        // the 5s autosave tick — otherwise sizes computed just before the
        // user quits are lost and those folders recalculate on next launch.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                sizecache::flush(app);
            }
        });
}
