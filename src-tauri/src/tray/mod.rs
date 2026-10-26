use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

use crate::shortcuts;

// Passed by the autostart plugin (see Cargo.toml/lib.rs wiring) so a
// login-triggered launch starts quietly in the tray instead of popping the
// window open on top of whatever the user was doing right after signing in.
pub const MINIMIZED_ARG: &str = "--minimized";

pub fn launched_minimized() -> bool {
    std::env::args().any(|a| a == MINIMIZED_ARG)
}

fn save_current_window_metrics_and_get_close_to_tray(app: &AppHandle) -> bool {
    let mut close_to_tray = false;
    let state = app.state::<crate::state::AppState>();
    let mut guard = state.settings.try_lock();
    if guard.is_err() {
        for _ in 0..5 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            guard = state.settings.try_lock();
            if guard.is_ok() {
                break;
            }
        }
    }
    if let Ok(mut settings) = guard {
        close_to_tray = settings.close_to_tray;
        if let Some(w) = app.get_webview_window("main") {
            let is_max = w.is_maximized().unwrap_or(false);
            settings.window_maximized = is_max;
            if !is_max {
                if let Ok(size) = w.inner_size() {
                    if size.width >= 400 && size.height >= 300 {
                        settings.window_width = size.width;
                        settings.window_height = size.height;
                    }
                }
            }
        }
        let _ = crate::helpers::settings::save_settings(app, &settings);
    }
    close_to_tray
}

fn save_current_window_metrics(app: &AppHandle) {
    let _ = save_current_window_metrics_and_get_close_to_tray(app);
}

// Builds the tray icon + its right-click menu (Show / Quit), and wires the
// window's close button. When close_to_tray is true, close hides to the tray
// instead of exiting so background shortcuts stay live; when false (default),
// close exits the application directly.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id("show", "Show Flurer").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).item(&show_item).item(&quit_item).build()?;

    let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("Flurer").on_menu_event(|app, event| {
        match event.id().as_ref() {
            "show" => shortcuts::show_and_focus_main_window(app),
            "quit" => {
                save_current_window_metrics(app);
                app.exit(0);
            }
            _ => {}
        }
    });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = save_current_window_metrics_and_get_close_to_tray(&app_handle);
                if close_to_tray {
                    api.prevent_close();
                    shortcuts::hide_main_window(&app_handle);
                } else {
                    app_handle.exit(0);
                }
            }
        });
    }

    Ok(())
}

// Keeps the OS-level autostart registration in sync with the setting on
// every launch — best-effort, logged rather than propagated, same
// reasoning as the shortcut registration: the user manually removing the
// startup entry (or the OS blocking it) shouldn't be a startup-blocking
// error, just a state Flurer will try to correct again next launch.
pub fn sync_autostart(app: &AppHandle, enabled: bool) {
    let autolaunch = app.autolaunch();
    let result = if enabled { autolaunch.enable() } else { autolaunch.disable() };
    if let Err(e) = result {
        log::error!("failed to sync autostart (enabled={enabled}): {e}");
    }
}

// Called from set_settings when launch_at_startup actually changes, mirroring
// shortcuts::reregister's "only touch the OS state when the value changed"
// shape.
pub fn resync_autostart_if_changed(app: &AppHandle, previous: bool, next: bool) {
    if previous == next {
        return;
    }
    sync_autostart(app, next);
}
