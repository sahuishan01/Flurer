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

#[cfg(target_os = "windows")]
const SCHEDULED_TASK_NAME: &str = "FlurerAutostart";

#[cfg(target_os = "windows")]
fn sync_windows_scheduled_task(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if enabled {
        let current_exe = std::env::current_exe().map_err(|e| format!("Could not get current exe: {e}"))?;
        let exe_str = current_exe.to_string_lossy();
        let tr_value = format!("\"{}\" {}", exe_str, MINIMIZED_ARG);

        let mut cmd = std::process::Command::new("schtasks");
        cmd.args([
            "/create",
            "/tn",
            SCHEDULED_TASK_NAME,
            "/tr",
            &tr_value,
            "/sc",
            "onlogon",
            "/rl",
            "highest",
            "/f",
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.status() {
            Ok(status) if status.success() => {
                log::info!("Created/updated scheduled task '{SCHEDULED_TASK_NAME}' with highest privileges");
                Ok(())
            }
            Ok(status) => Err(format!("schtasks /create exited with code {:?}", status.code())),
            Err(e) => Err(format!("Failed to execute schtasks /create: {e}")),
        }
    } else {
        let mut cmd = std::process::Command::new("schtasks");
        cmd.args(["/delete", "/tn", SCHEDULED_TASK_NAME, "/f"]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.status() {
            Ok(status) if status.success() => {
                log::info!("Deleted scheduled task '{SCHEDULED_TASK_NAME}'");
                Ok(())
            }
            Ok(status) => {
                // If it doesn't exist, code may be non-zero, which is fine
                log::debug!("schtasks /delete exited with code {:?}", status.code());
                Ok(())
            }
            Err(e) => Err(format!("Failed to execute schtasks /delete: {e}")),
        }
    }
}

// Keeps the OS-level autostart registration in sync with the setting on
// every launch — best-effort, logged rather than propagated, same
// reasoning as the shortcut registration: the user manually removing the
// startup entry (or the OS blocking it) shouldn't be a startup-blocking
// error, just a state Flurer will try to correct again next launch.
// When launch_as_admin is true on Windows, standard HKCU Run registry entries
// will either trigger a UAC prompt on logon or be blocked by Windows.
// Instead, a Windows Scheduled Task configured with Run with highest privileges
// (/rl highest) is used so logon starts elevated and quiet in tray with zero prompts.
pub fn sync_autostart(app: &AppHandle, enabled: bool, run_as_admin: bool) {
    #[cfg(target_os = "windows")]
    {
        if enabled && run_as_admin {
            // Unregister standard autostart registry entry to avoid duplicate startup
            let _ = app.autolaunch().disable();
            if let Err(e) = sync_windows_scheduled_task(app, true) {
                log::error!("failed to sync elevated autostart scheduled task: {e}");
            }
            return;
        } else {
            // Remove the scheduled task if disabled or run_as_admin turned off
            let _ = sync_windows_scheduled_task(app, false);
        }
    }

    // Standard cross-platform autostart (Linux .config/autostart, macOS LaunchAgents, Windows Run key)
    let autolaunch = app.autolaunch();
    let result = if enabled { autolaunch.enable() } else { autolaunch.disable() };
    if let Err(e) = result {
        log::error!("failed to sync autostart (enabled={enabled}): {e}");
    }
}

// Called from set_settings when launch_at_startup or launch_as_admin changes,
// mirroring shortcuts::reregister's "only touch the OS state when needed" shape.
pub fn resync_autostart_if_changed(
    app: &AppHandle,
    prev_enabled: bool,
    next_enabled: bool,
    prev_as_admin: bool,
    next_as_admin: bool,
) {
    if prev_enabled == next_enabled && prev_as_admin == next_as_admin {
        return;
    }
    sync_autostart(app, next_enabled, next_as_admin);
}
