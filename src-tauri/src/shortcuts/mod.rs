use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

// Ctrl+Alt+E rather than something like Ctrl+Shift+F (common "find" binding)
// or a bare function key — low collision risk with both OS-level shortcuts
// and other apps, while still being a one-handed reach.
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+E";

// Best-effort, logged rather than propagated: a shortcut that's already
// claimed by another app (or just malformed) shouldn't block startup or a
// settings save over it — the rest of the app keeps working either way,
// the user just doesn't get a working hotkey until they pick a free one.
pub fn register(app: &AppHandle, shortcut: &str) {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().register(shortcut) {
        log::error!("failed to register global shortcut {shortcut:?}: {e}");
    }
}

pub fn unregister(app: &AppHandle, shortcut: &str) {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().unregister(shortcut) {
        log::error!("failed to unregister global shortcut {shortcut:?}: {e}");
    }
}

// Called when the user changes the shortcut in Settings — swaps the OS-level
// registration so the old binding stops working and the new one starts,
// without needing an app restart. Skips the unregister/register round-trip
// entirely when nothing actually changed (this runs on every settings save,
// not just ones that touch the shortcut).
pub fn reregister(app: &AppHandle, previous: &str, next: &str) {
    if previous == next {
        return;
    }
    unregister(app, previous);
    register(app, next);
}

// Brings the main window to the front and focuses it — restoring it first
// if it was minimized, since `show()` alone doesn't undo that on Windows.
// Used by the tray's "Show Flurer" item, which is a "bring the app back"
// action, not "open another one".
pub fn show_and_focus_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

static SPAWNED_WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

// What the global shortcut actually triggers: a brand-new, independent
// window every press — the same "always opens another one" behavior as
// Windows Explorer's Win+E, rather than just refocusing whatever's already
// open. Deliberately not the "main" window/label: that one stays hidden
// permanently as the tray-residency anchor (see tray::setup) and is never
// meant to be shown directly by this path. Each spawned window is otherwise
// a full, independent instance of the app — same shared backend state
// (settings, size cache, …) via AppState, but its own navigation history
// and UI state client-side, exactly like separate Explorer windows.
pub fn spawn_new_window(app: &AppHandle) {
    let id = SPAWNED_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("flurer-{id}");
    let result = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("flurer")
        .inner_size(800.0, 600.0)
        .transparent(true)
        // Matches the main window: no native title bar — the command bar
        // carries the drag region and window controls instead (a native
        // title bar over a transparent window renders as an unstyleable
        // black strip on Windows).
        .decorations(false)
        .visible(true)
        .build();

    match result {
        Ok(window) => {
            let app_handle = app.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let close_to_tray = crate::tray::save_current_window_metrics_and_get_close_to_tray(&app_handle);
                    if close_to_tray {
                        api.prevent_close();
                        for (label, wv) in app_handle.webviews() {
                            if label != "main" {
                                let _ = wv.hide();
                            }
                        }
                        crate::shortcuts::hide_main_window(&app_handle);
                    } else {
                        crate::sizecache::flush(&app_handle);
                        app_handle.exit(0);
                    }
                }
            });
            let _ = window.set_focus();
        }
        Err(e) => log::error!("failed to spawn new window {label:?}: {e}"),
    }
}

// The other half of the tray-residency behavior in src/tray — closing the
// window hides it rather than exiting the process, so the global shortcut
// (and everything else that needs the app running) stays alive.
pub fn hide_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.hide();
}
