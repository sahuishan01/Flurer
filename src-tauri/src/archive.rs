//! Compress-to-ZIP / Extract-archive — no archive support existed before
//! this; `zip` was already a dependency (used for plugin installs, see
//! `plugins::extract_plugin_zip`), just not exposed for the user's own
//! files. Follows the same register_task/spawn_blocking/emit_progress shape
//! as copy_items/move_items in fs/ops.rs, including the `on_progress`
//! closure split between pure inner logic and the Tauri command wrapper.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

use tauri::AppHandle;
use zip::{write::SimpleFileOptions, ZipWriter};

use crate::progress::{cleanup_task, emit_progress, is_cancelled, register_task};

fn operation_label(verb: &str, count: usize) -> String {
    if count == 1 {
        format!("{verb} 1 item")
    } else {
        format!("{verb} {count} items")
    }
}

/// One entry to write into the archive: its real path on disk, its name
/// inside the archive (forward-slash separated, zip's convention regardless
/// of host OS), and whether it's a directory (written as an empty entry so
/// empty folders survive the round trip, same as most archive tools).
struct ArchiveEntry {
    abs_path: PathBuf,
    archive_name: String,
    is_dir: bool,
}

/// Walks `path` and appends every file/dir under it to `out`, naming entries
/// relative to `base` — the *parent* of each top-level selected path, so the
/// selected item's own name becomes the first path segment inside the
/// archive (selecting a folder `bar` and a file `baz.txt` and compressing
/// both produces `bar/...` and `baz.txt`, not their contents dumped flat).
fn walk_for_archive(path: &Path, base: &Path, out: &mut Vec<ArchiveEntry>) -> Result<(), String> {
    let relative = path.strip_prefix(base).unwrap_or(path).to_string_lossy().replace('\\', "/");
    if path.is_dir() {
        out.push(ArchiveEntry { abs_path: path.to_path_buf(), archive_name: format!("{relative}/"), is_dir: true });
        let mut children: Vec<_> = fs::read_dir(path)
            .map_err(|e| format!("Cannot read {}: {e}", path.display()))?
            .filter_map(|e| e.ok())
            .collect();
        // Deterministic order — read_dir's own order is filesystem-dependent
        // and this only affects the archive's internal listing order, but a
        // stable one makes repeated compresses of the same folder diffable.
        children.sort_by_key(|e| e.file_name());
        for entry in children {
            walk_for_archive(&entry.path(), base, out)?;
        }
    } else {
        out.push(ArchiveEntry { abs_path: path.to_path_buf(), archive_name: relative, is_dir: false });
    }
    Ok(())
}

fn compress_to_zip_inner(
    paths: Vec<String>,
    dest_dir: String,
    dest_name: String,
    cancelled: &AtomicBool,
    task_id: u64,
    mut on_progress: impl FnMut(u64, u64, bool, Option<String>),
) -> Result<String, String> {
    // Joined here, not by the frontend concatenating strings — same
    // dest_dir/name split as create_folder/create_file, so this gets the
    // same correct-on-any-drive-letter-or-trailing-separator PathBuf::join
    // behavior instead of ad hoc string concatenation.
    let dest_path = PathBuf::from(&dest_dir).join(&dest_name);
    let dest_zip = dest_path.to_string_lossy().to_string();
    if dest_path.exists() {
        return Err("An item with this name already exists".to_string());
    }

    let mut entries = Vec::new();
    for p in &paths {
        let path = PathBuf::from(p);
        // The parent of the top-level item, not the item itself — see
        // walk_for_archive's doc comment on why.
        let base = path.parent().map(Path::to_path_buf).unwrap_or_default();
        walk_for_archive(&path, &base, &mut entries)?;
    }

    let total = (entries.len() as u64).max(1);
    let mut done = 0u64;
    on_progress(0, total, false, None);

    let file = fs::File::create(&dest_path).map_err(|e| format!("Cannot create {dest_zip}: {e}"))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut error: Option<String> = None;
    for entry in entries {
        if is_cancelled(task_id, cancelled) {
            error = Some("Cancelled".to_string());
            break;
        }
        let result = if entry.is_dir {
            writer.add_directory(&entry.archive_name, options)
        } else {
            (|| -> zip::result::ZipResult<()> {
                writer.start_file(&entry.archive_name, options)?;
                let mut f = fs::File::open(&entry.abs_path)?;
                std::io::copy(&mut f, &mut writer)?;
                Ok(())
            })()
        };
        if let Err(e) = result {
            error = Some(format!("Failed on {}: {e}", entry.archive_name));
            break;
        }
        done += 1;
        on_progress(done, total, false, None);
    }

    if error.is_none() {
        if let Err(e) = writer.finish() {
            error = Some(format!("Failed to finalize archive: {e}"));
        }
    }

    // A partially-written zip left behind after a failure/cancel is worse
    // than no file at all — nothing distinguishes it from a complete one
    // until you try to open it.
    if error.is_some() {
        let _ = fs::remove_file(&dest_path);
    }

    on_progress(total, total, true, error.clone());
    match error {
        Some(e) => Err(e),
        None => Ok(dest_zip),
    }
}

#[tauri::command]
pub async fn compress_to_zip(app: AppHandle, paths: Vec<String>, dest_dir: String, dest_name: String) -> Result<String, String> {
    let (task_id, cancelled) = register_task();
    let label = operation_label("Compressing", paths.len());
    let label_clone = label.clone();
    let app_clone = app.clone();
    let cancelled_clone = cancelled.clone();
    let result = tokio::task::spawn_blocking(move || {
        compress_to_zip_inner(paths, dest_dir, dest_name, &cancelled_clone, task_id, |done, total, finished, error| {
            emit_progress(&app_clone, task_id, &label_clone, done, total, finished, error, false)
        })
    })
    .await
    .map_err(|e| format!("Background task failed: {e}"))?;
    if !is_cancelled(task_id, &cancelled) {
        if let Err(e) = &result {
            emit_progress(&app, task_id, &label, 0, 1, true, Some(e.clone()), false);
        }
    }
    cleanup_task(task_id);
    result
}

// Path-traversal guard for extraction, same reasoning as
// plugins::extract_plugin_zip's: a hostile/corrupt zip entry named e.g.
// "../../evil.exe" must not be allowed to escape dest_dir.
fn is_safe_relative_path(relative: &str) -> bool {
    !relative.is_empty()
        && !relative.starts_with('/')
        && !relative.starts_with('\\')
        && !relative.split(['/', '\\']).any(|segment| segment == "..")
}

fn extract_archive_inner(
    zip_path: String,
    dest_dir: String,
    cancelled: &AtomicBool,
    task_id: u64,
    mut on_progress: impl FnMut(u64, u64, bool, Option<String>),
) -> Result<(), String> {
    let dest = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dest).map_err(|e| format!("Cannot create {dest_dir}: {e}"))?;

    let file = fs::File::open(&zip_path).map_err(|e| format!("Cannot open {zip_path}: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP: {e}"))?;

    let total = (archive.len() as u64).max(1);
    on_progress(0, total, false, None);

    let mut error: Option<String> = None;
    for i in 0..archive.len() {
        if is_cancelled(task_id, cancelled) {
            error = Some("Cancelled".to_string());
            break;
        }
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(e) => {
                error = Some(format!("Failed to read archive entry {i}: {e}"));
                break;
            }
        };
        let name = entry.name().to_string();
        if !is_safe_relative_path(&name) {
            error = Some(format!("Refusing to extract unsafe path in archive: {name}"));
            break;
        }
        let out_path = dest.join(&name);
        let is_dir = name.ends_with('/');
        let write_result = (|| -> std::io::Result<()> {
            if is_dir {
                fs::create_dir_all(&out_path)?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut buf = Vec::new();
                entry.read_to_end(&mut buf)?;
                fs::write(&out_path, &buf)?;
            }
            Ok(())
        })();
        if let Err(e) = write_result {
            error = Some(format!("Failed on {name}: {e}"));
            break;
        }
        on_progress((i + 1) as u64, total, false, None);
    }

    on_progress(total, total, true, error.clone());
    match error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn extract_archive(app: AppHandle, zip_path: String, dest_dir: String) -> Result<(), String> {
    let (task_id, cancelled) = register_task();
    let label = "Extracting archive".to_string();
    let label_clone = label.clone();
    let app_clone = app.clone();
    let cancelled_clone = cancelled.clone();
    let result = tokio::task::spawn_blocking(move || {
        extract_archive_inner(zip_path, dest_dir, &cancelled_clone, task_id, |done, total, finished, error| {
            emit_progress(&app_clone, task_id, &label_clone, done, total, finished, error, false)
        })
    })
    .await
    .map_err(|e| format!("Background task failed: {e}"))?;
    if !is_cancelled(task_id, &cancelled) {
        if let Err(e) = &result {
            emit_progress(&app, task_id, &label, 0, 1, true, Some(e.clone()), false);
        }
    }
    cleanup_task(task_id);
    result
}
