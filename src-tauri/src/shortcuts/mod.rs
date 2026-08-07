use tauri::{AppHandle, Manager};
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
pub fn show_and_focus_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
