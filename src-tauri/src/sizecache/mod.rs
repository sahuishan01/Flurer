use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use indexmap::IndexMap;
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
/// Soft cap on cached sizes for folders the user has actually visited.
/// These are the entries that get persisted across restarts, so this is
/// effectively "how many folders can Flurer remember the size of forever".
/// Generous on purpose: the whole point is that a folder the user has
/// looked at once never shows "Calculating…" again.
const MAX_CACHED_ROOTS: usize = 10_000;
/// Separate, larger, memory-only cap for sizes discovered as a *byproduct*
/// of walking some ancestor. A single walk of a real drive folder can
/// discover tens of thousands of nested directories, which is exactly why
/// these can't share a budget with visited folders: when both lived in one
/// 2000-entry map, one walk of a large tree evicted every folder the user
/// had ever visited (including, because the walked root is inserted before
/// its subdirectories, the very folder that walk was for). Switching drives
/// then found an empty cache and recomputed everything from scratch.
const MAX_CACHED_SUBDIRS: usize = 50_000;
/// Cap on simultaneously-watched folders — bounds OS file-watcher handle
/// usage. Raised from an original 50 for the same reason as
/// MAX_CACHED_ROOTS: Flurer now stays resident (tray + optional launch at
/// startup) instead of only watching for as long as one window session
/// lasts, so it's worth affording more live folders before the oldest
/// watch gets dropped in favor of a newer one.
const MAX_WATCHED_ROOTS: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSizeUpdate {
    pub path: String,
    pub size: u64,
    pub done: bool,
    pub error: Option<String>,
}

/// `get_folder_size` never blocks on the recursive walk itself — it returns
/// `Ready` immediately from cache, or kicks off background work and returns
/// `Pending` so the frontend can show a "syncing" state until the real value
/// arrives via the `folder-size-updated` event.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FolderSizeResponse {
    Ready { size: u64, error: Option<String> },
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
    /// True when one or more entries could not be read during the walk.
    #[serde(default)]
    pub incomplete: bool,
}

#[derive(Default)]
pub struct SizeCacheState {
    // Folders the user has actually asked about (opened a listing
    // containing them, or hit Recalculate on). Persisted across restarts
    // and evicted least-recently-*used* first, not least-recently-inserted:
    // every cache hit promotes the entry back to the newest position, so a
    // folder the user keeps coming back to is never the one dropped.
    //
    // IndexMap, not HashMap: eviction assumes "the first N keys iterated
    // are the oldest N" — true for IndexMap (it preserves insertion order),
    // NOT true for HashMap, whose iteration order is unspecified and
    // effectively random per-process.
    roots: Mutex<IndexMap<PathBuf, CachedSize>>,
    // Sizes learned incidentally while walking some ancestor. Kept because
    // they make navigating *into* an already-walked folder instant, but
    // memory-only and evicted independently — a big walk must never be able
    // to push out the entries in `roots` (see MAX_CACHED_SUBDIRS).
    subdirs: Mutex<IndexMap<PathBuf, CachedSize>>,
    // Paths queued or currently being computed by a worker thread, so a
    // folder already in flight isn't walked twice. The value is the
    // progress-panel task to report the result under, or None for
    // background work the user never explicitly waited on (silent cache
    // revalidation, watcher-triggered recomputes) — those stay invisible
    // rather than flooding the panel on every filesystem change under a
    // watched folder. Tracking lives here rather than on the job itself so
    // an explicit Recalculate can attach itself to a walk that is already
    // running.
    pending: Mutex<HashMap<PathBuf, Option<TrackedJob>>>,
    watched_roots: Mutex<Vec<PathBuf>>,
    // The pending map deduplicates paths, so an unbounded sender can accept
    // every visible folder from a large drive without silently dropping jobs
    // when the two workers are busy.
    job_sender: Mutex<Option<mpsc::Sender<SizeJob>>>,
    // Holding the debouncer keeps its background thread and OS watch handles
    // alive; dropping it silently stops all watching.
    debouncer: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
    // Set whenever `roots` changes; the autosave thread clears it after
    // persisting, so an idle app doesn't rewrite the cache file every tick.
    dirty: Mutex<bool>,
}

// The on-disk cache format. An ordered Vec rather than a map because the
// eviction policy is LRU and that ordering has to survive a restart — a
// JSON object gives no ordering guarantee, so persisting a map silently
// randomised which folders got dropped first on the next run.
#[derive(Serialize, Deserialize)]
struct PersistedEntry {
    path: String,
    size: u64,
    #[serde(default)]
    dir_mtime: i64,
    #[serde(default)]
    incomplete: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct PersistedCache {
    #[serde(default)]
    entries: Vec<PersistedEntry>,
}

// Ordered cache file. Deliberately a different filename from the old
// unordered `size_cache.json` so the two formats can never be confused for
// each other; the legacy file is read once for migration and then deleted.
fn cache_file_path() -> Option<PathBuf> {
    crate::helpers::settings::config_root().ok().map(|r| r.join("size_cache_v2.json"))
}

/// Loads persisted folder sizes, newest-last (LRU order preserved).
///
/// Tries, in order: the current ordered cache file; `settings.folder_sizes`
/// (where the cache briefly lived, and which we migrate out of and clear so
/// the settings file stops carrying thousands of cache entries that get
/// rewritten every few seconds); the original unordered `size_cache.json`.
fn load_persisted_sizes(app: &AppHandle) -> IndexMap<PathBuf, CachedSize> {
    if let Some(path) = cache_file_path() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<PersistedCache>(&data) {
                if !parsed.entries.is_empty() {
                    return parsed
                        .entries
                        .into_iter()
                        .map(|e| (PathBuf::from(e.path), CachedSize {
                            size: e.size,
                            dir_mtime: e.dir_mtime,
                            incomplete: e.incomplete,
                        }))
                        .collect();
                }
            }
        }
    }

    let state = app.state::<AppState>();
    let mut settings = state.settings.blocking_lock();
    if !settings.folder_sizes.is_empty() {
        let migrated: IndexMap<PathBuf, CachedSize> = settings
            .folder_sizes
            .iter()
            .map(|(p, s)| (PathBuf::from(p), *s))
            .collect();
        settings.folder_sizes.clear();
        let _ = save_settings(app, &settings);
        return migrated;
    }
    drop(settings);

    // Oldest format: a flat `{path: {size, dir_mtime}}` (or `{path: size}`)
    // map in size_cache.json.
    #[derive(Deserialize)]
    struct LegacyEntry {
        size: u64,
        #[serde(default)]
        dir_mtime: i64,
    }
    let Some(path) = crate::helpers::settings::config_root().ok().map(|r| r.join("size_cache.json")) else {
        return IndexMap::new();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return IndexMap::new();
    };
    let migrated: Option<IndexMap<PathBuf, CachedSize>> =
        serde_json::from_str::<HashMap<String, LegacyEntry>>(&data)
            .ok()
            .map(|m| {
                m.into_iter()
                    .map(|(p, e)| (PathBuf::from(p), CachedSize {
                        size: e.size,
                        dir_mtime: e.dir_mtime,
                        incomplete: false,
                    }))
                    .collect()
            })
            .or_else(|| {
                serde_json::from_str::<HashMap<String, u64>>(&data)
                    .ok()
                    .map(|m| {
                        m.into_iter()
                            .map(|(p, s)| (PathBuf::from(p), CachedSize {
                                size: s,
                                dir_mtime: 0,
                                incomplete: false,
                            }))
                            .collect()
                    })
            });
    let _ = fs::remove_file(&path);
    migrated.unwrap_or_default()
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

/// Whether a cached size should be silently re-walked, given the folder's
/// mtime now and the one recorded when the size was computed (both in
/// epoch seconds, 0 meaning "unreadable"/"never recorded").
///
/// Requires a *readable* current mtime rather than just testing for a
/// mismatch. Treating unreadable (0) as a mismatch meant a folder we can't
/// stat was re-walked on every listing, forever — and each of those
/// invisible walks then swallowed the user's Recalculate clicks, because a
/// path already in flight used to reject further requests outright. A
/// legacy entry with no recorded mtime still revalidates once (0 differs
/// from any real mtime) and the walk records a real one, settling it.
fn needs_revalidation(current_mtime: i64, cached_mtime: i64) -> bool {
    current_mtime > 0 && current_mtime != cached_mtime
}

// Removes the oldest entries once `cache` exceeds `max`, down to exactly
// `max`. Relies on IndexMap's insertion-order iteration — `drain` on an
// index range removes that slice and shifts the rest down, which both
// targets the actually-oldest entries (a plain HashMap's iteration order
// is unspecified) and preserves that order for the entries that remain
// (IndexMap's own `.remove()` is `swap_remove` under the hood, which would
// silently re-scramble order on every single call and undo the fix the
// next time this ran).
fn evict_oldest<V>(cache: &mut IndexMap<PathBuf, V>, max: usize) {
    if cache.len() > max {
        let excess = cache.len() - max;
        cache.drain(0..excess);
    }
}

// Whether a cached path is known to be gone for good, as opposed to merely
// unreachable right now. A missing path on a drive that isn't currently
// mounted (an unplugged USB disk, a disconnected network share) must be
// kept: dropping it meant every removable drive was re-walked from zero the
// next time it was plugged in, which is one of the ways switching between
// drives kept triggering full recomputes.
fn is_permanently_gone(path: &Path) -> bool {
    if path.is_dir() {
        return false;
    }
    match path.ancestors().last() {
        // Drive/filesystem root is present but the folder isn't — really deleted.
        Some(root) => root.exists(),
        None => false,
    }
}

/// Looks a path up across both tiers, promoting the hit to the
/// most-recently-used position so eviction drops genuinely cold entries
/// rather than merely old ones. A hit found in the subdirectory tier is
/// moved into the root tier: the user just asked about it directly, so from
/// now on it deserves to be persisted and protected from walk churn.
fn lookup_cached(state: &AppState, path: &Path) -> Option<CachedSize> {
    {
        let mut roots = state.size_cache.roots.lock().unwrap();
        if let Some(entry) = touch(&mut roots, path) {
            return Some(entry);
        }
    }
    let promoted = {
        let mut subdirs = state.size_cache.subdirs.lock().unwrap();
        subdirs.shift_remove(path)?
    };
    // A folder promoted out of the volatile tier is newly persistable, so
    // make sure the next autosave actually writes it out.
    record_root(state, path.to_path_buf(), promoted);
    *state.size_cache.dirty.lock().unwrap() = true;
    Some(promoted)
}

/// Inserts (or refreshes) `path` at the most-recently-used end of `cache`,
/// then trims to `max`. Split out from the state-holding wrappers so the
/// LRU behaviour is unit-testable without an AppState.
fn insert_mru<V>(cache: &mut IndexMap<PathBuf, V>, path: PathBuf, entry: V, max: usize) {
    // shift_remove before insert so a refreshed entry lands at the newest
    // position instead of keeping its old one — IndexMap's plain `insert`
    // leaves an existing key's index untouched.
    cache.shift_remove(&path);
    cache.insert(path, entry);
    if cache.len() > max {
        // Trim in one batch down to a low-water mark rather than evicting a
        // single entry per insert. Draining from the front shifts every
        // surviving entry down, so evicting one-at-a-time while sitting at
        // the cap makes each insert O(len) — which, during a walk that
        // discovers tens of thousands of directories, is the difference
        // between a cache and a bottleneck. Batching amortises it to O(1).
        evict_oldest(cache, max * 9 / 10);
    }
}

/// Moves an existing key to the most-recently-used position and returns it.
fn touch<V: Copy>(cache: &mut IndexMap<PathBuf, V>, path: &Path) -> Option<V> {
    let index = cache.get_index_of(path)?;
    let entry = cache[index];
    let last = cache.len() - 1;
    cache.move_index(index, last);
    Some(entry)
}

/// Inserts (or refreshes) an entry in the persisted root tier.
fn record_root(state: &AppState, path: PathBuf, entry: CachedSize) {
    let mut roots = state.size_cache.roots.lock().unwrap();
    insert_mru(&mut roots, path, entry, MAX_CACHED_ROOTS);
}

/// Records a size discovered while walking an ancestor. Never demotes a
/// path that's already a visited root — that entry is the authoritative,
/// persisted one, so it's refreshed in place instead.
fn record_subdir(state: &AppState, path: PathBuf, entry: CachedSize) {
    {
        let mut roots = state.size_cache.roots.lock().unwrap();
        if let Some(existing) = roots.get_mut(&path) {
            *existing = entry;
            return;
        }
    }
    let mut subdirs = state.size_cache.subdirs.lock().unwrap();
    insert_mru(&mut subdirs, path, entry, MAX_CACHED_SUBDIRS);
}

/// Whether either tier knows about this path — used to decide which cached
/// ancestors a filesystem event invalidates.
fn is_cached(state: &AppState, path: &Path) -> bool {
    state.size_cache.roots.lock().unwrap().contains_key(path)
        || state.size_cache.subdirs.lock().unwrap().contains_key(path)
}

// Recursive watches can cover the folder where Flurer stores its own settings,
// wallpaper and size-cache files. Those writes are expected and must not
// invalidate a user folder: doing so creates an autosave -> watcher -> walk
// feedback loop that keeps the workers busy after all real work is finished.
fn is_path_under(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

fn is_internal_app_path(path: &Path) -> bool {
    crate::helpers::settings::config_root()
        .ok()
        .is_some_and(|root| is_path_under(path, &root))
}

// Drops entries for folders that are genuinely deleted, then writes the
// cache to its own file. Deliberately not part of settings.json: this is
// derived data that changes every few seconds and can run to thousands of
// entries, and folding it into the user's settings file meant every
// autosave rewrote all their preferences too.
fn save_persisted_sizes(_app: &AppHandle, sizes: &IndexMap<PathBuf, CachedSize>) {
    let Some(path) = cache_file_path() else {
        return;
    };
    let payload = PersistedCache {
        entries: sizes
            .iter()
            .filter(|(path, _)| !is_permanently_gone(path))
            .map(|(path, entry)| PersistedEntry {
                path: path.to_string_lossy().to_string(),
                size: entry.size,
                // Persist the mtime the size was actually computed at.
                // This used to be `max(current mtime, recorded mtime)`,
                // which stamped a *newer* mtime onto an older size and so
                // marked stale entries as still-valid on the next launch.
                dir_mtime: entry.dir_mtime,
                incomplete: entry.incomplete,
            })
            .collect(),
    };
    let Ok(bytes) = serde_json::to_vec(&payload) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = crate::helpers::settings::atomic_write(&path, &bytes);
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
    let mut unreadable = 0;
    compute_dir_size_recursive_reported(path, on_progress, subdirs, &mut unreadable)
}

fn compute_dir_size_recursive_reported<F>(
    path: &Path,
    on_progress: &mut F,
    subdirs: &mut HashMap<PathBuf, u64>,
    unreadable: &mut u64,
) -> u64
where
    F: FnMut(u64),
{
    let mut total = 0u64;
    let Ok(read_dir) = fs::read_dir(path) else {
        *unreadable += 1;
        return 0;
    };

    for entry in read_dir {
        let Ok(entry) = entry else {
            *unreadable += 1;
            continue;
        };
        // Do not follow links/reparse points during a recursive walk. Windows
        // junctions commonly point back into an ancestor (especially on
        // secondary drives), which otherwise turns a size calculation into
        // an endless recursion.
        let Ok(file_type) = entry.file_type() else {
            *unreadable += 1;
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            *unreadable += 1;
            continue;
        };
        if metadata.is_dir() {
            let subdir_path = entry.path();
            let subdir_size = compute_dir_size_recursive_reported(&subdir_path, on_progress, subdirs, unreadable);
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
/// progress. The pending map deduplicates repeated listings and recalculates.
fn enqueue(state: &AppState, path: PathBuf) -> bool {
    matches!(enqueue_job(state, path, None), EnqueueResult::Queued)
}

/// Same as `enqueue`, but reports the computation through the unified
/// operation-progress event — for computations the user is actually waiting
/// on (a folder opened for the first time, or an explicit recalculate),
/// as opposed to silent background revalidation.
fn enqueue_tracked(app: &AppHandle, state: &AppState, path: PathBuf) -> Result<(), String> {
    let task_id = next_task_id();
    let label = format!("Calculating size — {}", folder_label(&path));
    let log_path = path.clone();
    match enqueue_job(state, path, Some(TrackedJob { task_id, label: label.clone() })) {
        EnqueueResult::Queued | EnqueueResult::Adopted => {
            emit_progress(app, task_id, &label, 0, 0, false, None, true);
            Ok(())
        }
        EnqueueResult::AlreadyPending => Ok(()),
        EnqueueResult::Rejected => {
            log::error!("folder size worker unavailable while queueing {}", log_path.display());
            Err("Folder size worker is unavailable".to_string())
        }
    }
}

enum EnqueueResult {
    Queued,
    Adopted,
    AlreadyPending,
    Rejected,
}

/// Distinguishes new work, adoption of an existing silent walk, duplicates,
/// and a closed worker channel so callers never report Pending for a job that
/// was not actually accepted.
fn enqueue_job(state: &AppState, path: PathBuf, tracking: Option<TrackedJob>) -> EnqueueResult {
    let mut pending = state.size_cache.pending.lock().unwrap();

    if let Some(slot) = pending.get_mut(&path) {
        // Already queued or being walked right now. Refusing outright is
        // what made Recalculate look broken: a folder whose size was being
        // silently revalidated in the background swallowed the click with
        // no new walk *and* no progress row, so only the first of several
        // Recalculates appeared to do anything. Instead, adopt the
        // caller's tracking onto the in-flight job — the work the user
        // asked for is already happening, it just wasn't visible.
        if slot.is_none() && tracking.is_some() {
            *slot = tracking;
            return EnqueueResult::Adopted;
        }
        return EnqueueResult::AlreadyPending;
    }

    pending.insert(path.clone(), tracking);
    // Still holding `pending` while trying to send — if the worker channel
    // has been closed, atomically back out so the path cannot report Pending
    // forever without a corresponding job.
    let sent = state
        .size_cache
        .job_sender
        .lock()
        .unwrap()
        .as_ref()
        .map(|sender| sender.send(SizeJob { path: path.clone() }).is_ok())
        .unwrap_or(false);
    if !sent {
        pending.remove(&path);
        return EnqueueResult::Rejected;
    }
    EnqueueResult::Queued
}

/// Registers a recursive watch covering `path`.
///
/// Watches the *parent* rather than `path` itself, because a recursive
/// watch on the parent already covers every sibling. Listing one folder
/// asks for the size of all of its children, so watching each child
/// individually burned one OS watch handle per row and blew through
/// MAX_WATCHED_ROOTS after a handful of navigations — evicting watches for
/// folders the user was still looking at. One watch per *visited* folder
/// covers the same ground. Drive roots have no parent and are watched
/// directly.
fn start_watching(state: &AppState, path: &Path) {
    let scope = path.parent().unwrap_or(path);
    start_watching_exact(state, scope);
}

fn start_watching_exact(state: &AppState, path: &Path) {
    let mut roots = state.size_cache.watched_roots.lock().unwrap();
    if roots.iter().any(|p| p == path) {
        return;
    }
    // When the cap is reached the oldest watched root is dropped — its
    // cached size stays in the map but won't auto-update on filesystem
    // changes until the user visits that folder again.
    if roots.len() >= MAX_WATCHED_ROOTS {
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

            // Throttle progress events to once every 250ms, but emit the
            // first update immediately so the user sees a running total
            // right away instead of a blank "Calculating" for several
            // hundred milliseconds on large folders.
            let mut last_emit = std::time::Instant::now();
            let mut current_size = 0u64;
            let mut first = true;
            
            let mut on_progress = |bytes_added: u64| {
                current_size += bytes_added;
                if first {
                    first = false;
                    let _ = app_clone.emit(
                        "folder-size-updated",
                        FolderSizeUpdate {
                            path: path_clone.clone(),
                            size: current_size,
                            done: false,
                            error: None,
                        },
                    );
                    last_emit = std::time::Instant::now();
                    return;
                }
                let now = std::time::Instant::now();
                if now.duration_since(last_emit) >= std::time::Duration::from_millis(250) {
                    let _ = app_clone.emit(
                        "folder-size-updated",
                        FolderSizeUpdate {
                            path: path_clone.clone(),
                            size: current_size,
                            done: false,
                            error: None,
                        },
                    );
                    last_emit = now;
                }
            };

            let mut subdirs = HashMap::new();
            let mut unreadable = 0;
            let size = compute_dir_size_recursive_reported(&job.path, &mut on_progress, &mut subdirs, &mut unreadable);
            if unreadable > 0 {
                log::warn!(
                    "folder size for {} completed with {} unreadable item(s); result may be incomplete",
                    job.path.display(),
                    unreadable,
                );
            }
            let state = app.state::<AppState>();
            // Snapshot current mtime right after the walk, so the persisted
            // mtime won't be newer than the computed size.
            let mtime = dir_mtime_secs(&job.path);
            // Subdirectories first, then the walked folder itself, so the
            // folder this job was actually for ends up as the newest — and
            // therefore last-evicted — entry rather than the first.
            for (subdir_path, subdir_size) in subdirs {
                let sub_mtime = dir_mtime_secs(&subdir_path);
                record_subdir(&state, subdir_path, CachedSize {
                    size: subdir_size,
                    dir_mtime: sub_mtime,
                    incomplete: false,
                });
            }
            record_root(&state, job.path.clone(), CachedSize {
                size,
                dir_mtime: mtime,
                incomplete: unreadable > 0,
            });
            // Whoever asked for this walk may have attached tracking after
            // it started, so read it back here rather than trusting what
            // the job carried when it was queued.
            let tracking = state.size_cache.pending.lock().unwrap().remove(&job.path).flatten();
            *state.size_cache.dirty.lock().unwrap() = true;
            start_watching(&state, &job.path);

            let _ = app.emit(
                "folder-size-updated",
                FolderSizeUpdate {
                    path: path_str,
                    size,
                    done: true,
                    error: (unreadable > 0).then(|| {
                        format!(
                            "Could not read {unreadable} item(s) under {}; the calculated size may be incomplete",
                            job.path.display()
                        )
                    }),
                },
            );
            if let Some(TrackedJob { task_id, label }) = tracking {
                emit_progress(&app, task_id, &label, 0, 0, true, None, true);
                cleanup_task(task_id);
            }
        });
    }
}

/// Starts the worker pool and the single, process-lifetime debounced
/// watcher. Call once during app setup; `get_folder_size` enqueues specific
/// directories on demand.
pub fn init(app: &AppHandle) {
    let (tx, rx) = mpsc::channel::<SizeJob>();
    let receiver = Arc::new(Mutex::new(rx));

    {
        let state = app.state::<AppState>();
        *state.size_cache.roots.lock().unwrap() = load_persisted_sizes(app);
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
        let snapshot = state.size_cache.roots.lock().unwrap().clone();
        save_persisted_sizes(&app, &snapshot);
    });
}

/// Writes the cache out immediately, regardless of the autosave timer.
/// Called on app exit so sizes computed in the last few seconds of a
/// session aren't lost — losing them meant those folders recalculated on
/// the next launch even though they'd already been walked.
pub fn flush(app: &AppHandle) {
    let state = app.state::<AppState>();
    let snapshot = state.size_cache.roots.lock().unwrap().clone();
    save_persisted_sizes(app, &snapshot);
    *state.size_cache.dirty.lock().unwrap() = false;
}

fn handle_debounced_events(app: &AppHandle, events: Vec<notify_debouncer_mini::DebouncedEvent>) {
    let state = app.state::<AppState>();

    // A change deep inside a folder invalidates every cached ancestor up to
    // the watched root, not just the root itself — only recompute the ones
    // we've actually cached (i.e. the user has actually looked at).
    let mut dirty: Vec<PathBuf> = Vec::new();
    for event in &events {
        if is_internal_app_path(&event.path) {
            continue;
        }
        let mut current = event.path.parent().map(Path::to_path_buf);
        while let Some(dir) = current {
            if !dirty.contains(&dir) && is_cached(&state, &dir) {
                dirty.push(dir.clone());
            }
            current = dir.parent().map(Path::to_path_buf);
        }
    }

    for dir in dirty {
        enqueue(&state, dir);
    }
}

#[tauri::command]
pub fn get_folder_size(app: AppHandle, state: tauri::State<'_, AppState>, path: String) -> Result<FolderSizeResponse, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        log::warn!("folder size requested for non-directory or inaccessible path: {}", path);
        return Err(format!("{} is not a directory", path));
    }
    if let Err(error) = fs::read_dir(&path_buf) {
        log::warn!("folder size cannot read {}: {}", path_buf.display(), error);
        return Err(format!("Cannot read {}: {}", path_buf.display(), error));
    }

    // A recompute (manual or silent revalidation, below) already has this
    // path in `pending` — report Pending instead of the cached value that's
    // about to be replaced. Checking `pending` rather than removing the
    // entry from the cache (as an earlier version of this did) keeps
    // `handle_debounced_events`' contains_key-based dirty-detection intact
    // for any filesystem change that lands while the recompute is in flight.
    if state.size_cache.pending.lock().unwrap().contains_key(&path_buf) {
        return Ok(FolderSizeResponse::Pending);
    }

    // Promotes the hit to most-recently-used (and into the persisted tier
    // if it was only known as a walk byproduct), so the folders the user
    // keeps returning to are the last ones eviction ever considers.
    if let Some(cached) = lookup_cached(&state, &path_buf) {
        // Start watching on a cache *hit* too, not just after a walk.
        // Previously a folder restored from the persisted cache was only
        // watched once something forced a recompute, so the cheap path
        // (mtime unchanged) left it un-watched and changes went unnoticed
        // until the next launch.
        start_watching(&state, &path_buf);

        // Note mtime only detects changes to the folder's *direct*
        // children; a directory's mtime doesn't move when something nested
        // deeper changes. That gap is covered by the recursive watcher
        // above while Flurer is running (which, being tray-resident with
        // optional launch-at-startup, is most of the time). Edits made
        // while it's closed are picked up on the next explicit Recalculate.
        if needs_revalidation(dir_mtime_secs(&path_buf), cached.dir_mtime) {
            // Folder changed since we last walked it — silently revalidate
            // in the background. Return the cached value immediately so the
            // row never falls back to "Calculating…" for a size we know.
            enqueue(&state, path_buf.clone());
        }
        if cached.incomplete {
            log::warn!("returning previously incomplete folder size for {}", path_buf.display());
        }
        return Ok(FolderSizeResponse::Ready {
            size: cached.size,
            error: cached.incomplete.then(|| {
                format!("Some items under {} could not be read; the calculated size may be incomplete", path_buf.display())
            }),
        });
    }

    // Genuinely uncached — the frontend is about to show a "Calculating…"
    // state for this, so it's worth surfacing in the unified progress panel
    // too, unlike the silent revalidation above.
    enqueue_tracked(&app, &state, path_buf)?;
    Ok(FolderSizeResponse::Pending)
}

/// Bypasses the cache and forces a fresh recursive computation, for a
/// user-triggered "recalculate" action. Still non-blocking: the fresh value
/// arrives via `folder-size-updated` once the worker pool gets to it.
#[tauri::command]
pub fn recompute_folder_size(app: AppHandle, state: tauri::State<'_, AppState>, path: String) -> Result<FolderSizeResponse, String> {
    let path_buf = PathBuf::from(&path);
    log::info!("folder size recalculation requested: {}", path_buf.display());
    if !path_buf.is_dir() {
        log::warn!("folder size recalculation requested for non-directory or inaccessible path: {}", path);
        return Err(format!("{} is not a directory", path));
    }
    if let Err(error) = fs::read_dir(&path_buf) {
        log::warn!("folder size recalculation cannot read {}: {}", path_buf.display(), error);
        return Err(format!("Cannot read {}: {}", path_buf.display(), error));
    }

    // Enqueueing puts the path in `pending`, which is what makes
    // get_folder_size report Pending during the recompute (see above) —
    // without removing it from `sizes`, which handle_debounced_events needs
    // to keep recognizing this folder as one to watch for live changes.
    enqueue_tracked(&app, &state, path_buf)?;
    Ok(FolderSizeResponse::Pending)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use tempfile::tempdir;

    #[test]
    fn evict_oldest_removes_lowest_index_entries_first() {
        let mut cache: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        for i in 0..5 {
            cache.insert(PathBuf::from(format!("/path{i}")), CachedSize { size: i, dir_mtime: 0, incomplete: false });
        }

        evict_oldest(&mut cache, 3);

        assert_eq!(cache.len(), 3);
        assert!(!cache.contains_key(&PathBuf::from("/path0")));
        assert!(!cache.contains_key(&PathBuf::from("/path1")));
        let keys: Vec<&PathBuf> = cache.keys().collect();
        assert_eq!(keys, vec![&PathBuf::from("/path2"), &PathBuf::from("/path3"), &PathBuf::from("/path4")]);
    }

    #[test]
    fn evict_oldest_survives_many_rounds_in_correct_order() {
        // The scenario the original HashMap-based version got wrong: many
        // insert-then-maybe-evict cycles over a long session (exactly what
        // a long-running, tray-resident Flurer process does now) need every
        // round to evict the entries that are actually oldest, not an
        // arbitrary unspecified subset.
        let mut cache: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        for i in 0..50u64 {
            cache.insert(PathBuf::from(format!("/path{i}")), CachedSize { size: i, dir_mtime: 0, incomplete: false });
            evict_oldest(&mut cache, 5);
        }
        let keys: Vec<PathBuf> = cache.keys().cloned().collect();
        assert_eq!(
            keys,
            (45..50u64).map(|i| PathBuf::from(format!("/path{i}"))).collect::<Vec<_>>()
        );
    }

    fn entry(size: u64) -> CachedSize {
        CachedSize { size, dir_mtime: 42, incomplete: false }
    }

    #[test]
    fn revalidation_is_skipped_when_nothing_changed() {
        assert!(!needs_revalidation(1000, 1000));
    }

    #[test]
    fn revalidation_runs_once_for_a_changed_or_legacy_folder() {
        assert!(needs_revalidation(1001, 1000), "folder changed");
        assert!(needs_revalidation(1000, 0), "legacy entry with no recorded mtime");
        // ...and the walk records the real mtime, so it settles instead of
        // repeating on every listing.
        assert!(!needs_revalidation(1000, 1000));
    }

    #[test]
    fn an_unreadable_mtime_does_not_spin() {
        // The regression: 0 was treated as a mismatch, so a folder we can't
        // stat was re-walked on every single listing, and those invisible
        // walks swallowed the user's Recalculate clicks.
        assert!(!needs_revalidation(0, 1000));
        assert!(!needs_revalidation(0, 0));
    }

    #[test]
    fn insert_mru_moves_refreshed_entries_to_the_newest_position() {
        let mut cache: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        for i in 0..3u64 {
            insert_mru(&mut cache, PathBuf::from(format!("/p{i}")), entry(i), 10);
        }
        // Refreshing /p0 must make it newest, not leave it at index 0 —
        // IndexMap::insert alone would keep the original slot.
        insert_mru(&mut cache, PathBuf::from("/p0"), entry(99), 10);
        let keys: Vec<PathBuf> = cache.keys().cloned().collect();
        assert_eq!(keys, vec![PathBuf::from("/p1"), PathBuf::from("/p2"), PathBuf::from("/p0")]);
        assert_eq!(cache[&PathBuf::from("/p0")].size, 99);
    }

    #[test]
    fn touch_protects_a_reused_entry_from_eviction() {
        let mut cache: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        for i in 0..10u64 {
            insert_mru(&mut cache, PathBuf::from(format!("/p{i}")), entry(i), 10);
        }
        assert_eq!(touch(&mut cache, Path::new("/p0")).map(|e| e.size), Some(0));
        // Now that /p0 has been used, the next eviction must drop the
        // genuinely coldest entries (/p1 onwards) rather than the
        // oldest-inserted one.
        insert_mru(&mut cache, PathBuf::from("/p10"), entry(10), 10);
        assert!(cache.contains_key(&PathBuf::from("/p0")), "recently used entry survived");
        assert!(!cache.contains_key(&PathBuf::from("/p1")), "coldest entry evicted first");
    }

    #[test]
    fn touch_reports_a_miss_without_inserting() {
        let mut cache: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        assert!(touch(&mut cache, Path::new("/nope")).is_none());
        assert!(cache.is_empty());
    }

    #[test]
    fn a_large_walk_cannot_evict_visited_folders() {
        // The regression this tier split exists for: one map shared by
        // visited folders and walk byproducts meant walking a big tree on
        // one drive evicted every folder cached from another, so switching
        // drives re-walked everything from scratch.
        let mut roots: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        let mut subdirs: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        insert_mru(&mut roots, PathBuf::from(r"C:\Users"), entry(1), MAX_CACHED_ROOTS);

        for i in 0..(MAX_CACHED_SUBDIRS as u64 + 5_000) {
            insert_mru(&mut subdirs, PathBuf::from(format!(r"D:\big\sub{i}")), entry(i), MAX_CACHED_SUBDIRS);
        }
        insert_mru(&mut roots, PathBuf::from(r"D:\big"), entry(999), MAX_CACHED_ROOTS);

        assert!(subdirs.len() <= MAX_CACHED_SUBDIRS, "subdir tier trims itself");
        assert!(roots.contains_key(&PathBuf::from(r"C:\Users")), "other drive's cache survived");
        assert!(roots.contains_key(&PathBuf::from(r"D:\big")), "the walked folder survived its own walk");
    }

    #[test]
    fn persisted_cache_round_trips_in_lru_order() {
        let mut roots: IndexMap<PathBuf, CachedSize> = IndexMap::new();
        for i in 0..4u64 {
            insert_mru(&mut roots, PathBuf::from(format!("/o{i}")), entry(i), MAX_CACHED_ROOTS);
        }
        touch(&mut roots, Path::new("/o0"));

        let payload = PersistedCache {
            entries: roots
                .iter()
                .map(|(path, e)| PersistedEntry {
                    path: path.to_string_lossy().to_string(),
                    size: e.size,
                    dir_mtime: e.dir_mtime,
                    incomplete: e.incomplete,
                })
                .collect(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        let restored: PersistedCache = serde_json::from_str(&json).unwrap();
        let keys: Vec<String> = restored.entries.iter().map(|e| e.path.clone()).collect();
        assert_eq!(keys, vec!["/o1", "/o2", "/o3", "/o0"], "LRU order survives a restart");
    }

    #[test]
    fn legacy_cache_file_is_not_mistaken_for_the_new_format() {
        // The old flat `{path: {...}}` map must fail to produce v2 entries
        // so load_persisted_sizes falls through to the migration path
        // instead of silently starting from an empty cache.
        let legacy = r#"{"/a":{"size":10,"dir_mtime":3}}"#;
        let parsed = serde_json::from_str::<PersistedCache>(legacy);
        assert!(parsed.map(|c| c.entries.is_empty()).unwrap_or(true));
    }

    #[test]
    fn missing_folder_under_a_live_root_is_permanently_gone() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("deleted");
        assert!(is_permanently_gone(&missing));
        assert!(!is_permanently_gone(dir.path()));
    }

    #[test]
    fn watch_scope_is_the_parent_so_siblings_share_one_watch() {
        // Listing a folder asks for every child's size; watching each child
        // individually burned one OS handle per row.
        let a = PathBuf::from(r"C:\Users\me\a");
        let b = PathBuf::from(r"C:\Users\me\b");
        assert_eq!(a.parent(), b.parent());
    }

    #[test]
    fn app_owned_paths_are_detected_inside_the_config_root() {
        let root = Path::new("/home/user/.config/flurer");
        assert!(is_path_under(&root.join("size_cache_v2.json"), root));
        assert!(is_path_under(&root.join("settings.json"), root));
        assert!(!is_path_under(Path::new("/home/user/Documents/report.txt"), root));
    }

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
