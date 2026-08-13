//! Duplicate file finder — recursively scans a folder, buckets files by
//! size (a cheap, exact pre-filter: files of different sizes can never be
//! byte-identical), then SHA-256-hashes the contents of every file in a
//! bucket with 2+ members and groups by hash. Only buckets that still have
//! 2+ members after hashing are duplicates; everything else is dropped
//! rather than returned, so the result is exactly "files with byte-identical
//! content", nothing approximate — this feature exists to help delete
//! copies, so a false positive here means deleting data that wasn't
//! actually a duplicate.

use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::progress::{cleanup_task, emit_progress, is_cancelled, register_task};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateEntry {
    pub path: String,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub size: u64,
    pub entries: Vec<DuplicateEntry>,
}

// Skipping files above this size keeps a scan of a folder containing e.g. a
// few VM images or video files from spending most of its time hashing a
// handful of giant files that are unlikely to have a byte-identical twin
// anyway. Exact duplicates of files this large are rare in practice (a genre
// this size mostly belongs to: media libraries, disk images), and the user
// can always target a narrower folder if they specifically expect one.
const MAX_HASH_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB

fn walk_collect(dir: &Path, cancelled: &AtomicBool, task_id: u64, out: &mut Vec<(PathBuf, u64, Option<u64>)>) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir {
        if is_cancelled(task_id, cancelled) {
            return;
        }
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else { continue };
        // Same reasoning as sizecache's recursive walk: don't follow
        // symlinks/junctions, they can point back into an ancestor and turn
        // this into infinite recursion.
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            walk_collect(&path, cancelled, task_id, out);
        } else if let Ok(metadata) = entry.metadata() {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            out.push((path, metadata.len(), modified));
        }
    }
}

fn hash_file(path: &Path) -> std::io::Result<[u8; 32]> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().into())
}

fn find_duplicates_inner(
    root: String,
    cancelled: &AtomicBool,
    task_id: u64,
    mut on_progress: impl FnMut(u64, u64, bool, Option<String>),
) -> Result<Vec<DuplicateGroup>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("{root} is not a directory"));
    }

    on_progress(0, 0, false, None);
    let mut all = Vec::new();
    walk_collect(&root_path, cancelled, task_id, &mut all);
    if is_cancelled(task_id, cancelled) {
        return Err("Cancelled".to_string());
    }

    // Bucket by (size), dropping singletons immediately — most files in a
    // typical folder have a unique size and are never worth hashing.
    let mut by_size: HashMap<u64, Vec<(PathBuf, Option<u64>)>> = HashMap::new();
    for (path, size, modified) in all {
        if size == 0 {
            // Every empty file is trivially "identical" to every other empty
            // file, which makes "duplicate" a meaningless/unhelpful label
            // for them — skip rather than returning one enormous group.
            continue;
        }
        by_size.entry(size).or_default().push((path, modified));
    }
    by_size.retain(|_, v| v.len() > 1);

    let total: u64 = by_size.values().map(|v| v.len() as u64).sum();
    let mut done = 0u64;
    on_progress(0, total.max(1), false, None);

    let mut groups = Vec::new();
    for (size, candidates) in by_size {
        if is_cancelled(task_id, cancelled) {
            return Err("Cancelled".to_string());
        }
        let mut by_hash: HashMap<[u8; 32], Vec<(PathBuf, Option<u64>)>> = HashMap::new();
        for (path, modified) in candidates {
            if size <= MAX_HASH_BYTES {
                if let Ok(hash) = hash_file(&path) {
                    by_hash.entry(hash).or_default().push((path, modified));
                }
                // A file that fails to hash (permission denied mid-scan,
                // deleted between listing and hashing) is silently dropped
                // from consideration rather than failing the whole scan —
                // same "one bad entry doesn't sink the listing" philosophy
                // as list_directory.
            }
            done += 1;
            on_progress(done, total.max(1), false, None);
        }
        for (_, entries) in by_hash {
            if entries.len() > 1 {
                groups.push(DuplicateGroup {
                    size,
                    entries: entries
                        .into_iter()
                        .map(|(path, modified)| DuplicateEntry { path: path.to_string_lossy().to_string(), modified })
                        .collect(),
                });
            }
        }
    }

    // Largest wasted space first — a group of five 1 MB duplicates and a
    // group of two 500 MB duplicates waste roughly the same amount, but
    // sorting by total size (not group size or file size alone) surfaces
    // whichever actually matters most to clean up first.
    groups.sort_by(|a, b| {
        let waste_a = a.size * (a.entries.len() as u64 - 1);
        let waste_b = b.size * (b.entries.len() as u64 - 1);
        waste_b.cmp(&waste_a)
    });

    on_progress(total.max(1), total.max(1), true, None);
    Ok(groups)
}

#[tauri::command]
pub async fn find_duplicates(app: AppHandle, root: String) -> Result<Vec<DuplicateGroup>, String> {
    let (task_id, cancelled) = register_task();
    let label = "Scanning for duplicates".to_string();
    let label_clone = label.clone();
    let app_clone = app.clone();
    let cancelled_clone = cancelled.clone();
    let result = tokio::task::spawn_blocking(move || {
        find_duplicates_inner(root, &cancelled_clone, task_id, |done, total, finished, error| {
            emit_progress(&app_clone, task_id, &label_clone, done, total, finished, error, done == 0 && total == 0)
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
