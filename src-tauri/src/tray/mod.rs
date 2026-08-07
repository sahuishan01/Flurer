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

// Builds the tray icon + its right-click menu (Show / Quit), and wires the
// window's close button to hide instead of exit — the whole point of the
// tray is to keep the process (and therefore the global shortcut, which
// only works while something is running to catch it) alive after the user
// closes the window, without them having to remember to minimize instead.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id("show", "Show Flurer").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).item(&show_item).item(&quit_item).build()?;

    let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("Flurer").on_menu_event(|app, event| {
        match event.id().as_ref() {
            "show" => shortcuts::show_and_focus_main_window(app),
            "quit" => app.exit(0),
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
                api.prevent_close();
                shortcuts::hide_main_window(&app_handle);
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
