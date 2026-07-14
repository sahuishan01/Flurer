use std::sync::atomic::AtomicBool;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::progress::{cancel_task, emit_progress, is_cancelled, register_task};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpFailure {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub succeeded: Vec<String>,
    pub failed: Vec<OpFailure>,
}

impl BatchResult {
    fn new() -> Self {
        Self {
            succeeded: Vec::new(),
            failed: Vec::new(),
        }
    }

    fn push_ok(&mut self, path: String) {
        self.succeeded.push(path);
    }

    fn push_err(&mut self, path: String, error: String) {
        self.failed.push(OpFailure { path, error });
    }
}

fn operation_label(verb: &str, count: usize) -> String {
    if count == 1 {
        format!("{verb} 1 item")
    } else {
        format!("{verb} {count} items")
    }
}

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn validate_filename(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if name.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || (c as u32) < 32)
    {
        return Err("Name contains characters that aren't allowed on Windows".to_string());
    }
    let stem = name.split('.').next().unwrap_or(name);
    if RESERVED_NAMES.contains(&stem.to_uppercase().as_str()) {
        return Err(format!("\"{}\" is a reserved name on Windows", name));
    }
    Ok(())
}

fn is_within(base: &Path, candidate: &Path) -> bool {
    match (fs::canonicalize(base), fs::canonicalize(candidate)) {
        (Ok(base), Ok(candidate)) => candidate.starts_with(base),
        _ => false,
    }
}

// `is_dir()`/`is_file()` follow symlinks, so a directory symlink or NTFS
// junction pointing back at one of its own ancestors would otherwise send
// the recursive walkers below into unbounded recursion. Checking this first
// (via metadata that does NOT follow the link) lets both walkers treat a
// symlink as a single leaf instead of ever descending into it.
fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

// Leaf-file count, used to size the progress total up front — a single file
// (or symlink) counts as 1, an empty directory as 0, and a path that
// doesn't exist (or isn't a plain file/dir) as 0 too, so it can't inflate
// the total for work that was never going to happen.
fn count_files(path: &Path) -> u64 {
    if is_symlink(path) {
        return 1;
    }
    if path.is_dir() {
        let mut total = 0u64;
        if let Ok(read_dir) = fs::read_dir(path) {
            for entry in read_dir.flatten() {
                total += count_files(&entry.path());
            }
        }
        total
    } else if path.is_file() {
        1
    } else {
        0
    }
}

// Recursive copy that calls on_progress(done, total) after every file, so a
// large folder copy shows real incremental movement instead of sitting at
// 0% until everything finishes. Throttled to every 25 files (plus always on
// the very last one) so a tree with tens of thousands of files doesn't
// flood the frontend with IPC events.
const COPY_CHUNK_SIZE: u64 = 64 * 1024; // 64 KB

fn total_bytes(path: &Path) -> u64 {
    if path.is_symlink() {
        return 0;
    }
    if path.is_dir() {
        match fs::read_dir(path) {
            Ok(entries) => entries
                .filter_map(|e| e.ok())
                .map(|e| total_bytes(&e.path()))
                .sum(),
            Err(_) => 0,
        }
    } else {
        fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    }
}

fn copy_file_tracked(
    src: &Path,
    dst: &Path,
    bytes_copied: &mut u64,
    total_bytes: u64,
    cancelled: &AtomicBool,
    task_id: u64,
    on_progress: &mut dyn FnMut(u64, u64),
) -> std::io::Result<()> {
    let mut src_file = fs::File::open(src)?;
    let mut dst_file = fs::File::create(dst)?;
    let mut buffer = vec![0u8; COPY_CHUNK_SIZE as usize];
    loop {
        if is_cancelled(task_id, cancelled) {
            let _ = fs::remove_file(dst);
            return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "Cancelled"));
        }
        let n = src_file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        dst_file.write_all(&buffer[..n])?;
        *bytes_copied += n as u64;
        on_progress(*bytes_copied, total_bytes);
    }
    Ok(())
}

fn copy_recursive_tracked(
    src: &Path,
    dst: &Path,
    bytes_copied: &mut u64,
    total: u64,
    cancelled: &AtomicBool,
    task_id: u64,
    on_progress: &mut dyn FnMut(u64, u64),
) -> std::io::Result<()> {
    if is_cancelled(task_id, cancelled) {
        return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "Cancelled"));
    }
    if !is_symlink(src) && src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive_tracked(&entry.path(), &dst.join(entry.file_name()), bytes_copied, total, cancelled, task_id, on_progress)?;
        }
    } else {
        copy_file_tracked(src, dst, bytes_copied, total, cancelled, task_id, on_progress)?;
    }
    Ok(())
}

fn remove_any(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn copy_items_inner(
    sources: Vec<String>,
    destination_dir: String,
    cancelled: &AtomicBool,
    task_id: u64,
    mut on_progress: impl FnMut(u64, u64, bool, Option<String>),
) -> Result<BatchResult, String> {
    let dest_dir = PathBuf::from(&destination_dir);
    if !dest_dir.is_dir() {
        return Err(format!("{} is not a directory", destination_dir));
    }

    let mut result = BatchResult::new();
    let mut to_copy: Vec<(String, PathBuf, PathBuf)> = Vec::new();
    for source in sources {
        let src_path = PathBuf::from(&source);
        let Some(file_name) = src_path.file_name() else {
            result.push_err(source, "Invalid source path".to_string());
            continue;
        };
        let dest_path = dest_dir.join(file_name);

        if src_path.is_dir() && is_within(&src_path, &dest_dir) {
            result.push_err(source, "Cannot copy a folder into itself".to_string());
            continue;
        }
        if dest_path.exists() {
            result.push_err(source, "An item with this name already exists".to_string());
            continue;
        }
        if is_cancelled(task_id, cancelled) {
            return Ok(result);
        }
        to_copy.push((source, src_path, dest_path));
    }

    let total = to_copy.iter().map(|(_, src, _)| total_bytes(src)).sum::<u64>().max(1);
    let mut bytes_copied = 0u64;
    on_progress(0, total, false, None);

    for (source, src_path, dest_path) in to_copy {
        if is_cancelled(task_id, cancelled) {
            break;
        }
        match copy_recursive_tracked(
            &src_path, &dest_path, &mut bytes_copied, total, cancelled, task_id,
            &mut |d, t| on_progress(d.min(t), t, false, None),
        ) {
            Ok(()) => result.push_ok(source),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::Interrupted {
                    break;
                }
                result.push_err(source, e.to_string());
            }
        }
    }

    let error = if is_cancelled(task_id, cancelled) {
        Some("Cancelled".to_string())
    } else if !result.failed.is_empty() {
        Some(format!("{} item(s) failed", result.failed.len()))
    } else {
        None
    };
    on_progress(total, total, true, error);
    Ok(result)
}

#[tauri::command]
pub async fn copy_items(app: AppHandle, sources: Vec<String>, destination_dir: String) -> Result<BatchResult, String> {
    let (task_id, cancelled) = register_task();
    let label = operation_label("Copying", sources.len());
    let label_clone = label.clone();
    let app_clone = app.clone();
    let cancelled_clone = cancelled.clone();
    let result = tokio::task::spawn_blocking(move || {
        copy_items_inner(sources, destination_dir, &cancelled_clone, task_id, |done, total, finished, error| {
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
    result
}

fn move_items_inner(
    sources: Vec<String>,
    destination_dir: String,
    cancelled: &AtomicBool,
    task_id: u64,
    mut on_progress: impl FnMut(u64, u64, bool, Option<String>),
) -> Result<BatchResult, String> {
    let dest_dir = PathBuf::from(&destination_dir);
    if !dest_dir.is_dir() {
        return Err(format!("{} is not a directory", destination_dir));
    }

    let mut result = BatchResult::new();
    let mut to_move: Vec<(String, PathBuf, PathBuf)> = Vec::new();
    for source in sources {
        if is_cancelled(task_id, cancelled) { return Ok(result); }
        let src_path = PathBuf::from(&source);
        let Some(file_name) = src_path.file_name() else {
            result.push_err(source, "Invalid source path".to_string());
            continue;
        };
        let dest_path = dest_dir.join(file_name);
        if src_path.is_dir() && is_within(&src_path, &dest_dir) {
            result.push_err(source, "Cannot move a folder into itself".to_string());
            continue;
        }
        if dest_path.exists() {
            result.push_err(source, "An item with this name already exists".to_string());
            continue;
        }
        to_move.push((source, src_path, dest_path));
    }

    let total = to_move.iter().map(|(_, src, _)| total_bytes(src)).sum::<u64>().max(1);
    let mut bytes_copied = 0u64;
    on_progress(0, total, false, None);

    for (source, src_path, dest_path) in to_move {
        if is_cancelled(task_id, cancelled) { break; }
        if fs::rename(&src_path, &dest_path).is_ok() {
            let item_bytes = total_bytes(&src_path);
            bytes_copied += item_bytes.max(1);
            on_progress(bytes_copied.min(total), total, false, None);
            result.push_ok(source);
            continue;
        }
        match copy_recursive_tracked(&src_path, &dest_path, &mut bytes_copied, total, cancelled, task_id,
            &mut |d, t| on_progress(d.min(t), t, false, None))
            .and_then(|()| remove_any(&src_path))
        {
            Ok(()) => result.push_ok(source),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::Interrupted { break; }
                result.push_err(source, e.to_string());
            }
        }
    }

    let error = if is_cancelled(task_id, cancelled) {
        Some("Cancelled".to_string())
    } else if !result.failed.is_empty() {
        Some(format!("{} item(s) failed", result.failed.len()))
    } else {
        None
    };
    on_progress(total, total, true, error);
    Ok(result)
}

#[tauri::command]
pub async fn move_items(app: AppHandle, sources: Vec<String>, destination_dir: String) -> Result<BatchResult, String> {
    let (task_id, cancelled) = register_task();
    let label = operation_label("Moving", sources.len());
    let label_clone = label.clone();
    let app_clone = app.clone();
    let cancelled_clone = cancelled.clone();
    let result = tokio::task::spawn_blocking(move || {
        move_items_inner(sources, destination_dir, &cancelled_clone, task_id, |done, total, finished, error| {
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
    result
}

fn delete_items_inner(
    paths: Vec<String>,
    _cancelled: &AtomicBool,
    _task_id: u64,
    mut on_progress: impl FnMut(u64, u64, bool, Option<String>),
) -> BatchResult {
    let total = (paths.len() as u64).max(1);
    let mut done = 0u64;
    on_progress(0, total, false, None);

    let mut result = BatchResult::new();
    for path in paths {
        match trash::delete(&path) {
            Ok(()) => result.push_ok(path),
            Err(e) => result.push_err(path, e.to_string()),
        }
        done += 1;
        on_progress(done, total, false, None);
    }

    let error = if result.failed.is_empty() {
        None
    } else {
        Some(format!("{} item(s) failed", result.failed.len()))
    };
    on_progress(total, total, true, error);
    result
}

#[tauri::command]
pub async fn delete_items(app: AppHandle, paths: Vec<String>) -> Result<BatchResult, String> {
    let (task_id, cancelled) = register_task();
    let label = operation_label("Deleting", paths.len());
    let app_clone = app.clone();
    let label_clone = label.clone();
    let cancelled_clone = cancelled.clone();
    Ok(tokio::task::spawn_blocking(move || {
        delete_items_inner(paths, &cancelled_clone, task_id, |done, total, finished, error| {
            emit_progress(&app_clone, task_id, &label_clone, done, total, finished, error, false)
        })
    })
    .await
    .map_err(|e| format!("Background task failed: {e}"))?)
}

#[tauri::command]
pub fn rename_item(path: String, new_name: String) -> Result<String, String> {
    validate_filename(&new_name)?;

    let src_path = PathBuf::from(&path);
    let parent = src_path
        .parent()
        .ok_or_else(|| "Cannot rename the root of a drive".to_string())?;
    let dest_path = parent.join(&new_name);

    if dest_path.exists() {
        return Err("An item with this name already exists".to_string());
    }

    fs::rename(&src_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_operation(task_id: u64) -> Result<(), String> {
    if cancel_task(task_id) {
        Ok(())
    } else {
        Err(format!("No active task with id {task_id}"))
    }
}

#[tauri::command]
pub fn create_folder(parent_dir: String, name: String) -> Result<String, String> {
    validate_filename(&name)?;

    let dest_path = PathBuf::from(&parent_dir).join(&name);
    if dest_path.exists() {
        return Err("An item with this name already exists".to_string());
    }

    fs::create_dir(&dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn no_progress(_done: u64, _total: u64, _finished: bool, _error: Option<String>) {}

    fn write_file(path: &Path, contents: &str) {
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn copy_single_file() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "hello");
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let result = copy_items_inner(
            vec![src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
            no_progress,
        )
        .unwrap();

        assert_eq!(result.succeeded.len(), 1);
        assert!(result.failed.is_empty());
        assert!(src.exists());
        assert_eq!(fs::read_to_string(dest_dir.join("a.txt")).unwrap(), "hello");
    }

    #[test]
    fn copy_directory_recursively() {
        let dir = tempdir().unwrap();
        let src_dir = dir.path().join("srcdir");
        fs::create_dir(&src_dir).unwrap();
        write_file(&src_dir.join("nested.txt"), "nested");
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let result = copy_items_inner(
            vec![src_dir.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
            no_progress,
        )
        .unwrap();

        assert_eq!(result.succeeded.len(), 1);
        assert!(dest_dir.join("srcdir").join("nested.txt").exists());
    }

    #[test]
    fn copy_reports_collision_instead_of_overwriting() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "new");
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();
        write_file(&dest_dir.join("a.txt"), "original");

        let result = copy_items_inner(
            vec![src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
            no_progress,
        )
        .unwrap();

        assert!(result.succeeded.is_empty());
        assert_eq!(result.failed.len(), 1);
        assert_eq!(fs::read_to_string(dest_dir.join("a.txt")).unwrap(), "original");
    }

    #[test]
    fn copy_folder_into_itself_is_rejected() {
        let dir = tempdir().unwrap();
        let src_dir = dir.path().join("srcdir");
        fs::create_dir(&src_dir).unwrap();
        write_file(&src_dir.join("f.txt"), "data");

        let result = copy_items_inner(
            vec![src_dir.to_string_lossy().to_string()],
            src_dir.to_string_lossy().to_string(),
            no_progress,
        )
        .unwrap();

        assert!(result.succeeded.is_empty());
        assert_eq!(result.failed.len(), 1);
    }

    #[test]
    fn move_file_same_volume() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "hello");
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let result = move_items_inner(
            vec![src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
            no_progress,
        )
        .unwrap();

        assert_eq!(result.succeeded.len(), 1);
        assert!(!src.exists());
        assert!(dest_dir.join("a.txt").exists());
    }

    #[test]
    fn rename_item_changes_name() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "hello");

        let new_path = rename_item(src.to_string_lossy().to_string(), "b.txt".to_string()).unwrap();

        assert!(!src.exists());
        assert!(PathBuf::from(&new_path).exists());
    }

    #[test]
    fn rename_rejects_collision() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "hello");
        write_file(&dir.path().join("b.txt"), "existing");

        let result = rename_item(src.to_string_lossy().to_string(), "b.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn rename_rejects_invalid_characters() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "hello");

        let result = rename_item(src.to_string_lossy().to_string(), "bad:name.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn rename_rejects_reserved_windows_name() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "hello");

        let result = rename_item(src.to_string_lossy().to_string(), "CON.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn create_folder_makes_new_directory() {
        let dir = tempdir().unwrap();

        let new_path =
            create_folder(dir.path().to_string_lossy().to_string(), "New folder".to_string()).unwrap();

        assert!(PathBuf::from(&new_path).is_dir());
    }

    #[test]
    fn create_folder_rejects_collision() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("existing")).unwrap();

        let result = create_folder(dir.path().to_string_lossy().to_string(), "existing".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn delete_sends_file_to_trash() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("to_delete.txt");
        write_file(&file, "bye");

        let result = delete_items_inner(vec![file.to_string_lossy().to_string()], no_progress);

        assert_eq!(result.succeeded.len(), 1);
        assert!(!file.exists());
    }

    #[test]
    fn empty_batch_is_ok_not_error() {
        let dir = tempdir().unwrap();
        let result = copy_items_inner(vec![], dir.path().to_string_lossy().to_string(), no_progress).unwrap();
        assert!(result.succeeded.is_empty());
        assert!(result.failed.is_empty());
    }

    #[test]
    fn count_files_counts_nested_files_not_directories() {
        let dir = tempdir().unwrap();
        write_file(&dir.path().join("a.txt"), "a");
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        write_file(&nested.join("b.txt"), "b");
        write_file(&nested.join("c.txt"), "c");

        assert_eq!(count_files(dir.path()), 3);
    }

    #[test]
    fn copy_reports_progress_ticks() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.txt");
        write_file(&src, "hello");
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let mut ticks: Vec<(u64, u64, bool)> = Vec::new();
        copy_items_inner(
            vec![src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
            |done, total, finished, _error| ticks.push((done, total, finished)),
        )
        .unwrap();

        assert_eq!(ticks.first(), Some(&(0, 1, false)));
        assert_eq!(ticks.last(), Some(&(1, 1, true)));
    }

    #[test]
    fn count_files_treats_missing_path_as_zero() {
        let dir = tempdir().unwrap();
        assert_eq!(count_files(&dir.path().join("does_not_exist")), 0);
    }

    #[test]
    fn copy_progress_total_excludes_skipped_sources() {
        let dir = tempdir().unwrap();
        let ok_src = dir.path().join("ok.txt");
        write_file(&ok_src, "hello");
        let collide_src = dir.path().join("collide.txt");
        write_file(&collide_src, "new");
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();
        write_file(&dest_dir.join("collide.txt"), "existing");

        let mut ticks: Vec<(u64, u64, bool)> = Vec::new();
        let result = copy_items_inner(
            vec![ok_src.to_string_lossy().to_string(), collide_src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
            |done, total, finished, _error| ticks.push((done, total, finished)),
        )
        .unwrap();

        assert_eq!(result.succeeded.len(), 1);
        assert_eq!(result.failed.len(), 1);
        // total should only count ok.txt (1 file), not the collided source's
        // file too — otherwise done could never reach total except via the
        // forced final tick.
        assert_eq!(ticks.first(), Some(&(0, 1, false)));
        assert_eq!(ticks.last(), Some(&(1, 1, true)));
    }
}
