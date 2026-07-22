use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    helpers::settings::save_settings,
    progress::{cleanup_task, emit_progress, next_task_id},
    state::AppState,
};

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(800);
// Recursive folder walks are disk/CPU heavy; capping how many run at once
// keeps expanding a folder with many large children from saturating disk I/O
// and slowing the whole app down.
const WORKER_COUNT: usize = 2;
// How often the background autosave thread checks whether the in-memory
// cache has changed and, if so, writes it to disk — bounds worst-case data
// loss on a forced close without persisting on every single computed size.
const AUTOSAVE_INTERVAL: Duration = Duration::from_secs(5);
/// Soft cap on the in-memory folder-size cache. When exceeded the
/// oldest entries (by insertion order) are evicted to stay within
/// this limit, preventing unbounded growth during long sessions.
const MAX_CACHED_SIZES: usize = 500;
/// Maximum number of size-computation jobs waiting in the channel. When
/// the user rapidly navigates between many folders this prevents the
/// pending queue from growing without bound — old jobs for folders no
/// longer visible are silently dropped at the sender side.
const MAX_PENDING_JOBS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSizeUpdate {
    pub path: String,
    pub size: u64,
    pub done: bool,
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

// A folder-size computation the unified progress indicator should show
// alongside copy/move/delete — carries the task id assigned at enqueue time
// so the worker that finishes the job can report it as done.
struct TrackedJob {
    task_id: u64,
    label: String,
}

struct SizeJob {
    path: PathBuf,
    // None for background work the user never explicitly waited on (silent
    // cache revalidation, watcher-triggered recomputes) — those stay
    // invisible rather than flooding the progress panel on every filesystem
    // change under a watched folder.
    tracking: Option<TrackedJob>,
}

/// A cached folder size with the directory's modification time at the moment
/// it was computed, so we can skip revalidation on restart when nothing
/// changed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CachedSize {
    pub size: u64,
    /// Unix-epoch seconds of the directory's `mtime` when this entry was
    /// computed. 0 means "unknown" (legacy entry from before this field was
    /// introduced); these always trigger a silent revalidation once.
    #[serde(default)]
    pub dir_mtime: i64,
}

#[derive(Default)]
pub struct SizeCacheState {
    sizes: Mutex<HashMap<PathBuf, CachedSize>>,
    // Paths queued or currently being computed by a worker thread, so a
    // folder already in flight isn't enqueued twice.
    pending: Mutex<HashSet<PathBuf>>,
    watched_roots: Mutex<Vec<PathBuf>>,
    job_sender: Mutex<Option<mpsc::SyncSender<SizeJob>>>,
    // Holding the debouncer keeps its background thread and OS watch handles
    // alive; dropping it silently stops all watching.
    debouncer: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
    // Set whenever `sizes` changes; the autosave thread clears it after
    // persisting, so an idle app doesn't rewrite the cache file every tick.
    dirty: Mutex<bool>,
}

/// Loads persisted folder sizes from app settings (which are loaded from
/// `settings.json` on startup).  On the first run after upgrading from the
/// old separate `size_cache.json`, also migrates that file into settings
/// and removes it so future launches go straight through settings.
fn load_persisted_sizes(app: &AppHandle) -> HashMap<PathBuf, CachedSize> {
    let state = app.state::<AppState>();
    let settings = state.settings.blocking_lock();
    let from_settings: HashMap<PathBuf, CachedSize> = settings
        .folder_sizes
        .iter()
        .map(|(p, s)| (PathBuf::from(p), *s))
        .collect();
    if !from_settings.is_empty() {
        return from_settings;
    }
    drop(settings);

    // First run after upgrade — migrate the old separate cache file.
    #[derive(Deserialize)]
    struct LegacyEntry {
        size: u64,
        #[serde(default)]
        dir_mtime: i64,
    }
    let legacy_path = crate::helpers::settings::config_root()
        .map(|r| r.join("size_cache.json"))
        .ok();
    let Some(path) = legacy_path else {
        return HashMap::new();
    };
    if !path.is_file() {
        return HashMap::new();
    }
    let Ok(data) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    // Try CachedSize format first, then flat u64 format.
    let migrated: Option<HashMap<PathBuf, CachedSize>> = serde_json::from_str::<
        HashMap<String, LegacyEntry>,
    >(&data)
    .ok()
    .map(|m| m.into_iter().map(|(p, e)| (PathBuf::from(p), CachedSize { size: e.size, dir_mtime: e.dir_mtime })).collect())
    .or_else(|| {
        serde_json::from_str::<HashMap<String, u64>>(&data)
            .ok()
            .map(|m| m.into_iter().map(|(p, s)| (PathBuf::from(p), CachedSize { size: s, dir_mtime: 0 })).collect())
    });
    if let Some(sizes) = migrated {
        // Persist into settings and remove the old file.
        let mut settings = state.settings.blocking_lock();
        settings.folder_sizes = sizes
            .iter()
            .map(|(p, s)| (p.to_string_lossy().to_string(), *s))
            .collect();
        drop(settings);
        let settings = state.settings.blocking_lock();
        let _ = save_settings(app, &settings);
        let _ = fs::remove_file(&path);
        sizes
    } else {
        HashMap::new()
    }
}

// Reads the directory's current mtime (rounded to whole seconds); returns 0
// when the read fails (same as a legacy entry with unknown mtime).
fn dir_mtime_secs(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// Drops entries for folders that no longer exist, then writes the folder
// sizes into `AppState.settings.folder_sizes` and persists settings to disk.
fn save_persisted_sizes(app: &AppHandle, sizes: &HashMap<PathBuf, CachedSize>) {
    // Refresh mtime for each directory before saving — the cached mtime may
    // be stale if the folder changed during the session (the debounced
    // watcher will have triggered a recompute, so the mtime is updated
    // alongside the size).  For folders that haven't changed this is a
    // lightweight stat call.
    let sizes: HashMap<String, CachedSize> = sizes
        .iter()
        .filter(|(path, _)| path.is_dir())
        .map(|(path, entry)| {
            let mtime = dir_mtime_secs(path).max(entry.dir_mtime);
            (path.to_string_lossy().to_string(), CachedSize { size: entry.size, dir_mtime: mtime })
        })
        .collect();
    let state = app.state::<AppState>();
    let mut settings = state.settings.blocking_lock();
    settings.folder_sizes = sizes;
    drop(settings);
    let settings = state.settings.blocking_lock();
    let _ = save_settings(app, &settings);
}

pub fn compute_dir_size(path: &Path) -> u64 {
    compute_dir_size_with_progress(path, &mut |_| {})
}

pub fn compute_dir_size_recursive<F>(
    path: &Path,
    on_progress: &mut F,
    subdirs: &mut HashMap<PathBuf, u64>,
) -> u64
where
    F: FnMut(u64),
{
    let mut total = 0u64;
    let Ok(read_dir) = fs::read_dir(path) else {
        return 0;
    };

    for entry in read_dir.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            let subdir_path = entry.path();
            let subdir_size = compute_dir_size_recursive(&subdir_path, on_progress, subdirs);
            subdirs.insert(subdir_path, subdir_size);
            total += subdir_size;
        } else {
            let len = metadata.len();
            total += len;
            on_progress(len);
        }
    }

    total
}

pub fn compute_dir_size_with_progress<F>(path: &Path, on_progress: &mut F) -> u64
where
    F: FnMut(u64),
{
    let mut subdirs = HashMap::new();
    compute_dir_size_recursive(path, on_progress, &mut subdirs)
}

// What the unified progress panel shows for a folder-size task — the
// folder's own name, falling back to the full path for a drive root (which
// has no file_name).
fn folder_label(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Queues a path for background computation unless it's already queued or in
/// progress. Returns whether it was newly queued.
fn enqueue(state: &AppState, path: PathBuf) -> bool {
    enqueue_job(state, SizeJob { path, tracking: None })
}

/// Same as `enqueue`, but reports the computation through the unified
/// operation-progress event — for computations the user is actually waiting
/// on (a folder opened for the first time, or an explicit recalculate),
/// as opposed to silent background revalidation.
fn enqueue_tracked(app: &AppHandle, state: &AppState, path: PathBuf) -> bool {
    let task_id = next_task_id();
    let label = format!("Calculating size — {}", folder_label(&path));
    let queued = enqueue_job(
        state,
        SizeJob { path, tracking: Some(TrackedJob { task_id, label: label.clone() }) },
    );
    if queued {
        emit_progress(app, task_id, &label, 0, 0, false, None, true);
    }
    queued
}

fn enqueue_job(state: &AppState, job: SizeJob) -> bool {
    let mut pending = state.size_cache.pending.lock().unwrap();
    if !pending.insert(job.path.clone()) {
        return false;
    }
    // Snapshot the path before job is moved into try_send below.
    let path = job.path.clone();
    // Still holding `pending` while trying to send — if the channel is
    // full we atomically back out by removing from `pending`. Otherwise a
    // path stuck in `pending` with no job in the channel would make
    // get_folder_size report Pending forever for that path.
    let sent = state
        .size_cache
        .job_sender
        .lock()
        .unwrap()
        .as_ref()
        .map(|sender| sender.try_send(job).is_ok())
        .unwrap_or(false);
    if !sent {
        pending.remove(&path);
        return false;
    }
    true
}

fn start_watching(state: &AppState, path: &Path) {
    let mut roots = state.size_cache.watched_roots.lock().unwrap();
    if roots.iter().any(|p| p == path) {
        return;
    }
    // Keep at most 50 watched roots to avoid accumulating OS file
    // watcher handles across the whole session. When the cap is
    // reached the oldest watched root is dropped — its cached size
    // stays in the map but won't auto-update on filesystem changes
    // until the user visits that folder again.
    if roots.len() >= 50 {
        let removed = roots.remove(0);
        if let Some(debouncer) = state.size_cache.debouncer.lock().unwrap().as_mut() {
            let _ = debouncer.watcher().unwatch(&removed);
        }
    }
    if let Some(debouncer) = state.size_cache.debouncer.lock().unwrap().as_mut() {
        let _ = debouncer.watcher().watch(path, RecursiveMode::Recursive);
    }
    roots.push(path.to_path_buf());
}

fn spawn_workers(app: AppHandle, receiver: Arc<Mutex<mpsc::Receiver<SizeJob>>>, count: usize) {
    for _ in 0..count {
        let app = app.clone();
        let receiver = Arc::clone(&receiver);
        thread::spawn(move || loop {
            let received = {
                let rx = receiver.lock().unwrap();
                rx.recv()
            };
            let Ok(job) = received else {
                // Sender dropped (app shutting down) — nothing left to do.
                break;
            };

            let path_str = job.path.to_string_lossy().to_string();
            let app_clone = app.clone();
            let path_clone = path_str.clone();

            // Throttle progress events to once every 250ms
            let mut last_emit = std::time::Instant::now();
            let mut current_size = 0u64;
            
            let mut on_progress = |bytes_added: u64| {
                current_size += bytes_added;
                let now = std::time::Instant::now();
                if now.duration_since(last_emit) >= std::time::Duration::from_millis(250) {
                    let _ = app_clone.emit(
                        "folder-size-updated",
                        FolderSizeUpdate {
                            path: path_clone.clone(),
                            size: current_size,
                            done: false,
                        },
                    );
                    last_emit = now;
                }
            };

            let mut subdirs = HashMap::new();
            let size = compute_dir_size_recursive(&job.path, &mut on_progress, &mut subdirs);
            let state = app.state::<AppState>();
            // Snapshot current mtime right after the walk, so the persisted
            // mtime won't be newer than the computed size.
            let mtime = dir_mtime_secs(&job.path);
            {
                let mut cache = state.size_cache.sizes.lock().unwrap();
                cache.insert(job.path.clone(), CachedSize { size, dir_mtime: mtime });
                for (subdir_path, subdir_size) in subdirs {
                    let sub_mtime = dir_mtime_secs(&subdir_path);
                    cache.insert(subdir_path, CachedSize { size: subdir_size, dir_mtime: sub_mtime });
                }
                // Evict oldest entries when the cache exceeds the cap
                // to prevent unbounded growth during long sessions.
                if cache.len() > MAX_CACHED_SIZES {
                    let excess = cache.len() - MAX_CACHED_SIZES;
                    let keys: Vec<PathBuf> = cache.keys().take(excess).cloned().collect();
                    for key in keys {
                        cache.remove(&key);
                    }
                }
            }
            state.size_cache.pending.lock().unwrap().remove(&job.path);
            *state.size_cache.dirty.lock().unwrap() = true;
            start_watching(&state, &job.path);

            let _ = app.emit(
                "folder-size-updated",
                FolderSizeUpdate {
                    path: path_str,
                    size,
                    done: true,
                },
            );
            if let Some(TrackedJob { task_id, label }) = &job.tracking {
                emit_progress(&app, *task_id, label, 0, 0, true, None, true);
                cleanup_task(*task_id);
            }
        });
    }
}

/// Starts the worker pool and the single, process-lifetime debounced
/// watcher. Call once during app setup; `get_folder_size` enqueues specific
/// directories on demand.
pub fn init(app: &AppHandle) {
    let (tx, rx) = mpsc::sync_channel::<SizeJob>(MAX_PENDING_JOBS);
    let receiver = Arc::new(Mutex::new(rx));

    {
        let state = app.state::<AppState>();
        *state.size_cache.sizes.lock().unwrap() = load_persisted_sizes(app);
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
        save_persisted_sizes(&app, &snapshot);
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
pub fn get_folder_size(app: AppHandle, state: tauri::State<'_, AppState>, path: String) -> Result<FolderSizeResponse, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(format!("{} is not a directory", path));
    }

    // A recompute (manual or silent revalidation, below) already has this
    // path in `pending` — report Pending instead of the cached value that's
    // about to be replaced. Checking `pending` rather than removing the
    // entry from `sizes` (as an earlier version of this did) keeps
    // `handle_debounced_events`' contains_key-based dirty-detection intact
    // for any filesystem change that lands while the recompute is in flight.
    if state.size_cache.pending.lock().unwrap().contains(&path_buf) {
        return Ok(FolderSizeResponse::Pending);
    }

    // `.copied()` here drops the sizes MutexGuard immediately instead of
    // holding it through the watched_roots check and enqueue() below.
    let cached = state.size_cache.sizes.lock().unwrap().get(&path_buf).copied();
    if let Some(cached) = cached {
        // Persisted cache entries (loaded on startup) have a known mtime.
        // If the folder's mtime on disk is _still_ the same, the size is
        // valid and we can skip the silent revalidation entirely.
        // Legacy entries with dir_mtime == 0 always trigger a revalidation
        // once, which is harmless — after that they're watched and updated
        // live.
        let mtime_matches = cached.dir_mtime > 0
            && fs::metadata(&path_buf)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64 == cached.dir_mtime)
                .unwrap_or(false);
        if !mtime_matches {
            // Folder changed (or we don't know its mtime from a legacy
            // cache file) — silently revalidate in the background. Return
            // the cached value immediately for a fast first paint; once
            // the recompute finishes this path is watched live.
            let already_watching =
                state.size_cache.watched_roots.lock().unwrap().iter().any(|p| p == &path_buf);
            if !already_watching {
                enqueue(&state, path_buf.clone());
            }
        }
        return Ok(FolderSizeResponse::Ready { size: cached.size });
    }

    // Genuinely uncached — the frontend is about to show a "Calculating…"
    // state for this, so it's worth surfacing in the unified progress panel
    // too, unlike the silent revalidation above.
    enqueue_tracked(&app, &state, path_buf);
    Ok(FolderSizeResponse::Pending)
}

/// Bypasses the cache and forces a fresh recursive computation, for a
/// user-triggered "recalculate" action. Still non-blocking: the fresh value
/// arrives via `folder-size-updated` once the worker pool gets to it.
#[tauri::command]
pub fn recompute_folder_size(app: AppHandle, state: tauri::State<'_, AppState>, path: String) -> Result<FolderSizeResponse, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(format!("{} is not a directory", path));
    }

    // Enqueueing puts the path in `pending`, which is what makes
    // get_folder_size report Pending during the recompute (see above) —
    // without removing it from `sizes`, which handle_debounced_events needs
    // to keep recognizing this folder as one to watch for live changes.
    enqueue_tracked(&app, &state, path_buf);
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
