//! Recycle Bin browsing — deletes already go through the OS trash (see
//! `fs::ops::delete_items`, which calls `trash::delete`), this just exposes
//! `trash`'s `os_limited` module (list/restore/purge) so that's actually
//! visible and reversible from inside Flurer instead of only from Explorer.
//!
//! `TrashItem::id` is an `OsString` (a Windows `IShellItem` display name /
//! a Linux `.trashinfo` path — see the `trash` crate's docs), which isn't
//! serde-serializable, so every command here converts to/from `String` via
//! `to_string_lossy()` at the boundary and re-resolves the real `TrashItem`
//! by re-listing and matching ids before calling `restore_all`/`purge_all`,
//! which both want the actual struct, not just its id.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub name: String,
    pub original_path: String,
    /// Non-leap seconds since the Unix epoch — same unit `DirEntry::modified`
    /// already uses elsewhere, so the frontend can reuse its existing
    /// formatModified() as-is.
    pub time_deleted: i64,
}

fn to_entry(item: trash::TrashItem) -> TrashEntry {
    TrashEntry {
        id: item.id.to_string_lossy().to_string(),
        name: item.name.to_string_lossy().to_string(),
        original_path: item.original_path().to_string_lossy().to_string(),
        time_deleted: item.time_deleted,
    }
}

#[tauri::command]
pub fn list_trash() -> Result<Vec<TrashEntry>, String> {
    let items = trash::os_limited::list().map_err(|e| {
        log::error!("list_trash failed: {e}");
        e.to_string()
    })?;
    Ok(items.into_iter().map(to_entry).collect())
}

/// Re-lists and filters down to the requested ids, rather than trusting
/// stale ids the frontend already had — the trash contents can change
/// between the frontend loading its list and the user acting on it (another
/// delete landing, or the bin being emptied from Explorer), and `restore_all`
/// / `purge_all` need real `TrashItem`s, not bare ids, to act on.
fn resolve_items(ids: &[String]) -> Result<Vec<trash::TrashItem>, String> {
    let wanted: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .filter(|item| wanted.contains(item.id.to_string_lossy().as_ref()))
        .collect())
}

#[tauri::command]
pub fn restore_trash_items(ids: Vec<String>) -> Result<(), String> {
    let items = resolve_items(&ids)?;
    trash::os_limited::restore_all(items).map_err(|e| {
        log::error!("restore_trash_items failed: {e}");
        // RestoreCollision (something already exists at the original path)
        // and RestoreTwins (two selected items share an original path) are
        // the two errors actually worth distinguishing to the user; the
        // Display impl already names them, so just pass it through.
        e.to_string()
    })
}

#[tauri::command]
pub fn delete_trash_items_forever(ids: Vec<String>) -> Result<(), String> {
    let items = resolve_items(&ids)?;
    trash::os_limited::purge_all(items).map_err(|e| {
        log::error!("delete_trash_items_forever failed: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn empty_trash() -> Result<(), String> {
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    trash::os_limited::purge_all(items).map_err(|e| {
        log::error!("empty_trash failed: {e}");
        e.to_string()
    })
}
