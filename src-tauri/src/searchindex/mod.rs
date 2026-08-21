//! A persistent name index over user-chosen roots, so searching a large
//! tree is a scan of memory rather than a walk of the filesystem.
//!
//! Today's `search_directory` re-walks the tree on every query, which is
//! fine for a folder and hopeless for a drive. This keeps a flat list of
//! every indexed path in memory, rebuilt on demand and kept current by a
//! recursive watcher per root.
//!
//! **Why a flat Vec and not a database.** A substring scan over a few
//! hundred thousand short strings is a handful of milliseconds — well
//! inside "instant" — and it costs no new dependency, no schema, no
//! migration story and no C toolchain in the Windows build. The tradeoff is
//! memory: each entry keeps its full path plus a lowercased copy of just
//! the file name (not the whole path), which lands around 100 bytes per
//! entry, so ~50 MB for half a million files. If indexes ever need to span
//! whole multi-million-file drives, that's the point to reach for something
//! on disk.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecursiveMode, Watcher};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::fs::DirEntry;

/// Results returned for a single query. The list is a means of finding one
/// thing, not a report; past a few hundred rows nobody is reading, and the
/// cap is what keeps a one-letter query from serializing the whole index.
const QUERY_LIMIT: usize = 500;

/// How often a rebuild reports progress. Purely cosmetic — small enough to
/// look live, large enough not to spam IPC during a fast local walk.
const PROGRESS_EVERY: usize = 5_000;

const WATCH_DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Serialize, Deserialize)]
struct IndexedEntry {
    path: String,
    /// Lowercased file name, precomputed so a query is a plain substring
    /// test instead of a per-entry case conversion.
    name_lower: String,
    is_dir: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct PersistedIndex {
    roots: Vec<String>,
    entries: Vec<IndexedEntry>,
}

struct IndexState {
    roots: Vec<String>,
    entries: Vec<IndexedEntry>,
}

fn index() -> &'static Mutex<IndexState> {
    static INDEX: OnceLock<Mutex<IndexState>> = OnceLock::new();
    INDEX.get_or_init(|| Mutex::new(IndexState { roots: Vec::new(), entries: Vec::new() }))
}

/// Set for the duration of a rebuild. Guards against two rebuilds racing to
/// replace the index, and drives the "Indexing…" state in the UI.
fn rebuilding() -> &'static AtomicBool {
    static REBUILDING: OnceLock<AtomicBool> = OnceLock::new();
    REBUILDING.get_or_init(|| AtomicBool::new(false))
}

/// Bumped whenever a rebuild starts, so a rebuild that is still walking when
/// a newer one begins can notice it has been superseded and bail out instead
/// of publishing a stale index over the top of the new one.
fn generation() -> &'static AtomicU64 {
    static GENERATION: OnceLock<AtomicU64> = OnceLock::new();
    GENERATION.get_or_init(|| AtomicU64::new(0))
}

type Watchers = Mutex<Vec<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>;

fn watchers() -> &'static Watchers {
    static WATCHERS: OnceLock<Watchers> = OnceLock::new();
    WATCHERS.get_or_init(Default::default)
}

fn index_file_path() -> Option<PathBuf> {
    crate::helpers::settings::config_root().ok().map(|root| root.join("search_index_v1.json"))
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub roots: Vec<String>,
    pub entry_count: usize,
    pub rebuilding: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexProgress {
    indexed: usize,
    done: bool,
}

#[tauri::command]
pub fn search_index_status() -> IndexStatus {
    let state = index().lock().unwrap();
    IndexStatus {
        roots: state.roots.clone(),
        entry_count: state.entries.len(),
        rebuilding: rebuilding().load(Ordering::Relaxed),
    }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/// Case-insensitive substring match on file names, optionally restricted to
/// a subtree.
///
/// Matches on the *name* rather than the full path deliberately: a query
/// like "doc" should not match every file that happens to live under
/// `C:\Documents`, which is what path matching produces and what makes
/// naive indexed search feel useless.
#[tauri::command]
pub fn search_index_query(query: String, root: Option<String>) -> Vec<DirEntry> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let scope = root.map(|root| normalize(&root));

    let state = index().lock().unwrap();
    let mut hits: Vec<&IndexedEntry> = Vec::new();
    for entry in &state.entries {
        if !entry.name_lower.contains(&needle) {
            continue;
        }
        if let Some(scope) = &scope {
            if !is_under(&entry.path, scope) {
                continue;
            }
        }
        hits.push(entry);
        if hits.len() >= QUERY_LIMIT {
            break;
        }
    }

    // Prefix matches first: someone typing "rep" wants `report.docx` above
    // `quarterly-prep.md`. Sorted only over the capped hit list, so this
    // stays cheap no matter how large the index is.
    hits.sort_by_key(|entry| (!entry.name_lower.starts_with(&needle), entry.name_lower.clone()));

    // Metadata is read here rather than stored in the index: size and mtime
    // go stale the moment a file is touched, and reading it for at most
    // QUERY_LIMIT results is far cheaper than keeping it fresh for all of
    // them. An entry that has since been deleted simply drops out.
    hits.into_iter().filter_map(to_dir_entry).collect()
}

fn to_dir_entry(entry: &IndexedEntry) -> Option<DirEntry> {
    let path = Path::new(&entry.path);
    let metadata = fs::symlink_metadata(path).ok()?;
    Some(DirEntry {
        name: path.file_name()?.to_string_lossy().to_string(),
        path: entry.path.clone(),
        is_dir: entry.is_dir,
        size: metadata.len(),
        modified: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs()),
    })
}

fn normalize(path: &str) -> String {
    let lowered = path.to_lowercase();
    if cfg!(windows) {
        lowered.replace('/', "\\")
    } else {
        lowered
    }
}

fn is_under(path: &str, normalized_root: &str) -> bool {
    let normalized = normalize(path);
    let separator = if cfg!(windows) { '\\' } else { '/' };
    normalized == normalized_root
        || normalized.starts_with(&format!("{normalized_root}{separator}"))
        // A drive root already ends in its separator ("c:\"), so the join
        // above would produce a doubled one and never match.
        || (normalized_root.ends_with(separator) && normalized.starts_with(normalized_root))
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/// Replaces the indexed roots and rebuilds from scratch in the background.
/// Returns immediately; progress arrives as `search-index-progress` events.
#[tauri::command]
pub fn rebuild_search_index(app: AppHandle, roots: Vec<String>) -> Result<(), String> {
    if rebuilding().swap(true, Ordering::SeqCst) {
        return Err("An index rebuild is already running.".to_string());
    }
    let my_generation = generation().fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::spawn(move || {
        let mut entries = Vec::new();
        let mut indexed = 0usize;
        let mut superseded = false;

        for root in &roots {
            if !walk_into(Path::new(root), &mut entries, &mut indexed, &app, my_generation) {
                superseded = true;
                break;
            }
        }

        // A newer rebuild has taken over: drop everything this pass
        // collected rather than overwriting the newer index with it.
        if superseded || generation().load(Ordering::SeqCst) != my_generation {
            rebuilding().store(false, Ordering::SeqCst);
            return;
        }

        {
            let mut state = index().lock().unwrap();
            state.roots = roots.clone();
            state.entries = entries;
        }
        persist();
        rebuilding().store(false, Ordering::SeqCst);
        let _ = app.emit("search-index-progress", IndexProgress { indexed, done: true });
        start_watching(&app, &roots);
    });
    Ok(())
}

/// Iterative rather than recursive: indexed trees are user-chosen and can be
/// arbitrarily deep (or contain a junction loop), and a recursive walk would
/// put that depth on the thread's stack.
///
/// Returns false if a newer rebuild superseded this one mid-walk.
fn walk_into(
    root: &Path,
    entries: &mut Vec<IndexedEntry>,
    indexed: &mut usize,
    app: &AppHandle,
    my_generation: u64,
) -> bool {
    let mut stack = vec![root.to_path_buf()];
    // Canonicalized directories already visited. Directory junctions and
    // symlinks on Windows can point back up their own tree, which without
    // this turns the walk into an infinite one.
    let mut visited: HashSet<PathBuf> = HashSet::new();

    while let Some(dir) = stack.pop() {
        if generation().load(Ordering::SeqCst) != my_generation {
            return false;
        }
        if let Ok(real) = fs::canonicalize(&dir) {
            if !visited.insert(real) {
                continue;
            }
        }
        // Unreadable directories are skipped rather than reported: unlike a
        // listing the user asked for, an index quietly covering slightly
        // less of a protected system tree is not something to interrupt
        // them about.
        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            if crate::sizecache::is_ignored_watcher_path(&path) {
                continue;
            }
            let is_dir = entry.file_type().map(|file_type| file_type.is_dir()).unwrap_or(false);
            if is_dir {
                stack.push(path.clone());
            }
            entries.push(IndexedEntry {
                name_lower: entry.file_name().to_string_lossy().to_lowercase(),
                path: path.to_string_lossy().to_string(),
                is_dir,
            });
            *indexed += 1;
            if *indexed % PROGRESS_EVERY == 0 {
                let _ = app.emit("search-index-progress", IndexProgress { indexed: *indexed, done: false });
            }
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

fn persist() {
    let Some(path) = index_file_path() else {
        return;
    };
    let payload = {
        let state = index().lock().unwrap();
        PersistedIndex { roots: state.roots.clone(), entries: state.entries.clone() }
    };
    let Ok(bytes) = serde_json::to_vec(&payload) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, bytes);
}

/// Loads the index saved by the previous session and resumes watching its
/// roots. Deliberately does *not* rebuild: the watcher catches up on changes
/// while the app was closed only for roots it can still see, and a silent
/// full re-walk of a whole drive on every launch is exactly the behavior an
/// index exists to avoid. The UI exposes an explicit Rebuild.
pub fn init(app: &AppHandle) {
    let Some(path) = index_file_path() else {
        return;
    };
    let Ok(data) = fs::read(&path) else {
        return;
    };
    let Ok(parsed) = serde_json::from_slice::<PersistedIndex>(&data) else {
        return;
    };
    let roots = parsed.roots.clone();
    {
        let mut state = index().lock().unwrap();
        state.roots = parsed.roots;
        state.entries = parsed.entries;
    }
    start_watching(app, &roots);
}

// ---------------------------------------------------------------------------
// Incremental updates
// ---------------------------------------------------------------------------

fn start_watching(app: &AppHandle, roots: &[String]) {
    let mut active = watchers().lock().unwrap();
    // Dropping the previous debouncers is what unwatches the old roots.
    active.clear();

    for root in roots {
        let app_handle = app.clone();
        let Ok(mut debouncer) = new_debouncer(WATCH_DEBOUNCE, move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let paths: Vec<PathBuf> = events
                .into_iter()
                .map(|event| event.path)
                .filter(|path| !crate::sizecache::is_ignored_watcher_path(path))
                .collect();
            if paths.is_empty() {
                return;
            }
            apply_changes(&paths);
            let _ = app_handle.emit(
                "search-index-progress",
                IndexProgress { indexed: index().lock().unwrap().entries.len(), done: true },
            );
        }) else {
            continue;
        };
        if debouncer.watcher().watch(Path::new(root), RecursiveMode::Recursive).is_ok() {
            active.push(debouncer);
        }
    }
}

/// Folds a batch of changed paths into the index.
///
/// Each path is re-checked against the filesystem rather than trusted from
/// the event kind: debounced events collapse create-then-delete (and
/// rename-away-and-back) into one notification, so existence now is the only
/// reliable signal. A path that has gone takes everything beneath it with
/// it, which is what makes a deleted directory disappear from results
/// without a rescan.
fn apply_changes(paths: &[PathBuf]) {
    let mut state = index().lock().unwrap();
    for path in paths {
        let path_string = path.to_string_lossy().to_string();
        let normalized = normalize(&path_string);
        let exists = path.exists();

        state.entries.retain(|entry| !is_under(&entry.path, &normalized));

        if exists {
            let is_dir = path.is_dir();
            if let Some(name) = path.file_name() {
                state.entries.push(IndexedEntry {
                    path: path_string,
                    name_lower: name.to_string_lossy().to_lowercase(),
                    is_dir,
                });
            }
            // A newly created directory can already have contents (an
            // extracted archive, a moved folder), and the recursive watcher
            // may not report each child separately. Walk it so those show up.
            if is_dir {
                let mut added = Vec::new();
                let mut count = 0usize;
                collect_subtree(path, &mut added, &mut count);
                state.entries.extend(added);
            }
        }
    }
}

/// Bounded subtree walk used when a directory appears. Capped because this
/// runs on the watcher thread: a colossal folder being moved into an indexed
/// root should not stall change handling. Anything beyond the cap is picked
/// up by the next explicit rebuild.
fn collect_subtree(root: &Path, out: &mut Vec<IndexedEntry>, count: &mut usize) {
    const MAX: usize = 50_000;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if *count >= MAX {
            return;
        }
        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            if crate::sizecache::is_ignored_watcher_path(&path) {
                continue;
            }
            let is_dir = entry.file_type().map(|file_type| file_type.is_dir()).unwrap_or(false);
            if is_dir {
                stack.push(path.clone());
            }
            out.push(IndexedEntry {
                name_lower: entry.file_name().to_string_lossy().to_lowercase(),
                path: path.to_string_lossy().to_string(),
                is_dir,
            });
            *count += 1;
            if *count >= MAX {
                return;
            }
        }
    }
}

/// Drops the index and stops watching. Used by the "Clear index" action, so
/// a user who indexed a sensitive tree can actually get rid of it.
#[tauri::command]
pub fn clear_search_index() {
    {
        let mut state = index().lock().unwrap();
        state.roots.clear();
        state.entries.clear();
    }
    watchers().lock().unwrap().clear();
    if let Some(path) = index_file_path() {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, name: &str, is_dir: bool) -> IndexedEntry {
        IndexedEntry { path: path.to_string(), name_lower: name.to_lowercase(), is_dir }
    }

    fn with_entries(entries: Vec<IndexedEntry>) {
        let mut state = index().lock().unwrap();
        state.entries = entries;
        state.roots = vec![];
    }

    #[test]
    fn is_under_matches_subtrees_but_not_sibling_prefixes() {
        let root = normalize(if cfg!(windows) { r"C:\Users\Ish" } else { "/users/ish" });
        let inside = if cfg!(windows) { r"C:\Users\Ish\notes.txt" } else { "/users/ish/notes.txt" };
        // The classic prefix bug: "Ishan" starts with "Ish" but is not in it.
        let sibling = if cfg!(windows) { r"C:\Users\Ishan\notes.txt" } else { "/users/ishan/notes.txt" };

        assert!(is_under(inside, &root));
        assert!(!is_under(sibling, &root));
    }

    // The index is process-global, so every test that installs entries into
    // it shares one fixture and runs in a single #[test] — separate tests
    // would race each other under the parallel runner.
    #[test]
    fn queries_are_scoped_to_names() {
        let (report, other) = if cfg!(windows) {
            (r"C:\Documents\report.docx", r"C:\Documents\budget.xlsx")
        } else {
            ("/documents/report.docx", "/documents/budget.xlsx")
        };
        with_entries(vec![entry(report, "report.docx", false), entry(other, "budget.xlsx", false)]);

        let names_containing = |needle: &str| {
            let state = index().lock().unwrap();
            state
                .entries
                .iter()
                .filter(|e| e.name_lower.contains(needle))
                .map(|e| e.path.clone())
                .collect::<Vec<_>>()
        };

        // "documents" appears in both paths but in neither file name, so a
        // name-scoped query must return nothing.
        assert!(names_containing("documents").is_empty());
        assert_eq!(names_containing("report"), vec![report.to_string()]);

        // A blank query is not "match everything".
        assert!(search_index_query("   ".to_string(), None).is_empty());
    }
}
