use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{helpers::settings::size_cache_path, state::AppState};

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(800);
// Recursive folder walks are disk/CPU heavy; capping how many run at once
// keeps expanding a folder with many large children from saturating disk I/O
// and slowing the whole app down.
const WORKER_COUNT: usize = 2;
// How often the background autosave thread checks whether the in-memory
// cache has changed and, if so, writes it to disk — bounds worst-case data
// loss on a forced close without persisting on every single computed size.
const AUTOSAVE_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSizeUpdate {
    pub path: String,
    pub size: u64,
}

/// `get_folder_size` never blocks on the recursive walk itself — it returns
/// `Ready` immediately from cache, or kicks off background work and returns
/// `Pending` so the frontend can show a "syncing" state until the real value
/// arrives via the `folder-size-updated` event.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FolderSizeResponse {
    Ready { size: u64 },
    Pending,
}

#[derive(Default)]
pub struct SizeCacheState {
    sizes: Mutex<HashMap<PathBuf, u64>>,
    // Paths queued or currently being computed by a worker thread, so a
    // folder already in flight isn't enqueued twice.
    pending: Mutex<HashSet<PathBuf>>,
    watched_roots: Mutex<Vec<PathBuf>>,
    job_sender: Mutex<Option<mpsc::Sender<PathBuf>>>,
    // Holding the debouncer keeps its background thread and OS watch handles
    // alive; dropping it silently stops all watching.
    debouncer: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
    // Set whenever `sizes` changes; the autosave thread clears it after
    // persisting, so an idle app doesn't rewrite the cache file every tick.
    dirty: Mutex<bool>,
}

#[derive(Serialize, Deserialize, Default)]
struct PersistedSizeCache {
    sizes: HashMap<String, u64>,
}

fn load_persisted_sizes() -> HashMap<PathBuf, u64> {
    let Ok(path) = size_cache_path() else {
        return HashMap::new();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let Ok(persisted) = serde_json::from_str::<PersistedSizeCache>(&data) else {
        return HashMap::new();
    };
    persisted.sizes.into_iter().map(|(path, size)| (PathBuf::from(path), size)).collect()
}

// Drops entries for folders that no longer exist so the cache file doesn't
// grow forever with paths the user deleted long ago.
fn save_persisted_sizes(sizes: &HashMap<PathBuf, u64>) {
    let Ok(path) = size_cache_path() else {
        return;
    };
    let persisted = PersistedSizeCache {
        sizes: sizes
            .iter()
            .filter(|(path, _)| path.is_dir())
            .map(|(path, &size)| (path.to_string_lossy().to_string(), size))
            .collect(),
    };
    let Ok(data) = serde_json::to_string(&persisted) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if fs::write(&temp, data).is_ok() {
        let _ = fs::rename(&temp, &path);
    }
}

pub fn compute_dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(read_dir) = fs::read_dir(path) else {
        return 0;
    };

    for entry in read_dir.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            total += compute_dir_size(&entry.path());
        } else {
            total += metadata.len();
        }
    }

    total
}

/// Queues a path for background computation unless it's already queued or in
/// progress. Returns whether it was newly queued.
fn enqueue(state: &AppState, path: PathBuf) -> bool {
    let mut pending = state.size_cache.pending.lock().unwrap();
    if !pending.insert(path.clone()) {
        return false;
    }
    drop(pending);

    if let Some(sender) = state.size_cache.job_sender.lock().unwrap().as_ref() {
        let _ = sender.send(path);
    }
    true
}

fn start_watching(state: &AppState, path: &Path) {
    let mut roots = state.size_cache.watched_roots.lock().unwrap();
    if roots.iter().any(|p| p == path) {
        return;
    }
    if let Some(debouncer) = state.size_cache.debouncer.lock().unwrap().as_mut() {
        let _ = debouncer.watcher().watch(path, RecursiveMode::Recursive);
    }
    roots.push(path.to_path_buf());
}

fn spawn_workers(app: AppHandle, receiver: Arc<Mutex<mpsc::Receiver<PathBuf>>>, count: usize) {
    for _ in 0..count {
        let app = app.clone();
        let receiver = Arc::clone(&receiver);
        thread::spawn(move || loop {
            let received = {
                let rx = receiver.lock().unwrap();
                rx.recv()
            };
            let Ok(path) = received else {
                // Sender dropped (app shutting down) — nothing left to do.
                break;
            };

            let size = compute_dir_size(&path);
            let state = app.state::<AppState>();
            state.size_cache.sizes.lock().unwrap().insert(path.clone(), size);
            state.size_cache.pending.lock().unwrap().remove(&path);
            *state.size_cache.dirty.lock().unwrap() = true;
            start_watching(&state, &path);

            let _ = app.emit(
                "folder-size-updated",
                FolderSizeUpdate { path: path.to_string_lossy().to_string(), size },
            );
        });
    }
}

/// Starts the worker pool and the single, process-lifetime debounced
/// watcher. Call once during app setup; `get_folder_size` enqueues specific
/// directories on demand.
pub fn init(app: &AppHandle) {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let receiver = Arc::new(Mutex::new(rx));

    {
        let state = app.state::<AppState>();
        *state.size_cache.sizes.lock().unwrap() = load_persisted_sizes();
        *state.size_cache.job_sender.lock().unwrap() = Some(tx);
    }

    spawn_workers(app.clone(), receiver, WORKER_COUNT);
    spawn_autosave(app.clone());

    let app_handle = app.clone();
    let result = new_debouncer(DEBOUNCE_WINDOW, move |result: notify_debouncer_mini::DebounceEventResult| {
        let Ok(events) = result else {
            return;
        };
        handle_debounced_events(&app_handle, events);
    });

    let Ok(debouncer) = result else {
        return;
    };

    let state = app.state::<AppState>();
    *state.size_cache.debouncer.lock().unwrap() = Some(debouncer);
}

fn spawn_autosave(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(AUTOSAVE_INTERVAL);
        let state = app.state::<AppState>();
        let mut dirty = state.size_cache.dirty.lock().unwrap();
        if !*dirty {
            continue;
        }
        *dirty = false;
        drop(dirty);
        let snapshot = state.size_cache.sizes.lock().unwrap().clone();
        save_persisted_sizes(&snapshot);
    });
}

fn handle_debounced_events(app: &AppHandle, events: Vec<notify_debouncer_mini::DebouncedEvent>) {
    let state = app.state::<AppState>();
    let sizes = state.size_cache.sizes.lock().unwrap();

    // A change deep inside a folder invalidates every cached ancestor up to
    // the watched root, not just the root itself — only recompute the ones
    // we've actually cached (i.e. the user has actually looked at).
    let mut dirty: Vec<PathBuf> = Vec::new();
    for event in &events {
        let mut current = event.path.parent().map(Path::to_path_buf);
        while let Some(dir) = current {
            if sizes.contains_key(&dir) && !dirty.contains(&dir) {
                dirty.push(dir.clone());
            }
            current = dir.parent().map(Path::to_path_buf);
        }
    }
    drop(sizes);

    for dir in dirty {
        enqueue(&state, dir);
    }
}

#[tauri::command]
pub fn get_folder_size(state: tauri::State<'_, AppState>, path: String) -> Result<FolderSizeResponse, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(format!("{} is not a directory", path));
    }

    if let Some(&cached) = state.size_cache.sizes.lock().unwrap().get(&path_buf) {
        // A value loaded from the persisted cache — or computed earlier this
        // session but never watched — may be stale if the folder changed
        // while the app was closed. Return it immediately for a fast/instant
        // result, but silently revalidate in the background; once that
        // finishes the path is watched, so this only ever fires once per
        // path per app run.
        let already_watching = state.size_cache.watched_roots.lock().unwrap().iter().any(|p| p == &path_buf);
        if !already_watching {
            enqueue(&state, path_buf.clone());
        }
        return Ok(FolderSizeResponse::Ready { size: cached });
    }

    enqueue(&state, path_buf);
    Ok(FolderSizeResponse::Pending)
}

/// Bypasses the cache and forces a fresh recursive computation, for a
/// user-triggered "recalculate" action. Still non-blocking: the fresh value
/// arrives via `folder-size-updated` once the worker pool gets to it.
#[tauri::command]
pub fn recompute_folder_size(state: tauri::State<'_, AppState>, path: String) -> Result<FolderSizeResponse, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(format!("{} is not a directory", path));
    }

    // Drop the stale value now, not just when the recompute finishes — while
    // the old size is still cached, any other get_folder_size call for this
    // same path (e.g. the frontend's own initial-load fetch, or another
    // window) would read it back as an already-"Ready" result and clobber
    // the "Calculating…" state the frontend just set, before the real
    // recomputation ever finishes.
    state.size_cache.sizes.lock().unwrap().remove(&path_buf);
    enqueue(&state, path_buf);
    Ok(FolderSizeResponse::Pending)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use tempfile::tempdir;

    #[test]
    fn compute_dir_size_sums_nested_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), vec![0u8; 100]).unwrap();
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("b.txt"), vec![0u8; 250]).unwrap();

        assert_eq!(compute_dir_size(dir.path()), 350);
    }

    #[test]
    fn compute_dir_size_ignores_directories_own_size() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("empty_subfolder")).unwrap();

        assert_eq!(compute_dir_size(dir.path()), 0);
    }

    #[test]
    fn watcher_fires_on_real_file_change() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("initial.txt"), vec![0u8; 10]).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(200), tx).unwrap();
        debouncer
            .watcher()
            .watch(dir.path(), RecursiveMode::Recursive)
            .unwrap();

        fs::write(dir.path().join("new_file.txt"), vec![0u8; 500]).unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw_event = false;
        while Instant::now() < deadline {
            match rx.recv_timeout(deadline - Instant::now()) {
                Ok(Ok(_events)) => {
                    saw_event = true;
                    break;
                }
                Ok(Err(_)) | Err(_) => continue,
            }
        }

        assert!(saw_event, "expected a debounced event after creating a file");
        assert_eq!(compute_dir_size(dir.path()), 510);
    }
}
