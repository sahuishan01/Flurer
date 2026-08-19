//! Per-view watch on the *one* directory a file list is currently showing.
//!
//! Deliberately separate from sizecache's watcher: that one is a single,
//! process-lifetime, **recursive** watch whose job is keeping cached folder
//! sizes fresh, and it ignores a lot of churn (see is_ignored_watcher_path)
//! that a file list very much does care about. This one is non-recursive,
//! short-lived, and swapped every time the user navigates.
//!
//! Watches are keyed by an opaque string the frontend owns (one per
//! FileList instance) rather than by window label, because a single window
//! can show two panes — see the split view in ExplorerView.tsx.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecursiveMode, Watcher};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Long enough that unpacking an archive or a browser writing a `.part`
/// file coalesces into a handful of refreshes rather than hundreds; short
/// enough that a single dropped file feels immediate.
const DEBOUNCE: Duration = Duration::from_millis(250);

type Watchers = Mutex<HashMap<String, Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>;

fn watchers() -> &'static Watchers {
    static WATCHERS: OnceLock<Watchers> = OnceLock::new();
    WATCHERS.get_or_init(Default::default)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryChanged {
    key: String,
    path: String,
}

/// Watches `path` on behalf of `key`, replacing whatever `key` was watching
/// before. Dropping the old debouncer is what unwatches it, so navigation
/// never leaks watches.
///
/// Errors are returned rather than swallowed, but a caller that can't watch
/// (an unplugged drive, a path that vanished between navigation and this
/// call) should treat it as "no live updates here" and carry on — the list
/// still works, it just won't self-refresh.
#[tauri::command]
pub fn watch_directory(app: AppHandle, key: String, path: String) -> Result<(), String> {
    let dir = Path::new(&path).to_path_buf();
    if !dir.is_dir() {
        // Not an error worth surfacing: Quick Access and search results are
        // legitimately not directories. Just make sure the previous watch
        // for this key is torn down so it can't report changes for a folder
        // the user has already left.
        watchers().lock().unwrap().remove(&key);
        return Ok(());
    }

    let emit_key = key.clone();
    let emit_path = path.clone();
    let handle = app.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
        // The payload intentionally carries no per-file detail. Diffing
        // events against the rendered list would mean duplicating sorting,
        // grouping and filtering rules in Rust; re-listing a single
        // directory is cheap and always correct.
        if result.is_ok() {
            let _ = handle.emit(
                "directory-changed",
                DirectoryChanged { key: emit_key.clone(), path: emit_path.clone() },
            );
        }
    })
    .map_err(|e| format!("Could not start watching this folder: {e}"))?;

    debouncer
        .watcher()
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Could not watch \"{path}\": {e}"))?;

    // Insert last: on the error paths above the old watcher stays in place,
    // which is strictly better than leaving the key with nothing.
    watchers().lock().unwrap().insert(key, debouncer);
    Ok(())
}

/// Stops the watch for `key`. Called when a file list unmounts; navigation
/// goes through watch_directory instead, which replaces in one step.
#[tauri::command]
pub fn unwatch_directory(key: String) {
    watchers().lock().unwrap().remove(&key);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn replacing_a_key_drops_the_previous_watch() {
        let dir = tempdir().unwrap();
        let (tx, _rx) = std::sync::mpsc::channel();
        let mut first = new_debouncer(DEBOUNCE, tx).unwrap();
        first.watcher().watch(dir.path(), RecursiveMode::NonRecursive).unwrap();
        watchers().lock().unwrap().insert("pane-test".into(), first);

        let (tx2, _rx2) = std::sync::mpsc::channel();
        let mut second = new_debouncer(DEBOUNCE, tx2).unwrap();
        second.watcher().watch(dir.path(), RecursiveMode::NonRecursive).unwrap();
        watchers().lock().unwrap().insert("pane-test".into(), second);

        assert_eq!(watchers().lock().unwrap().len(), 1);
        unwatch_directory("pane-test".into());
        assert!(watchers().lock().unwrap().is_empty());
    }
}
