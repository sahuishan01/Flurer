mod ops;

use std::{
    cmp::Ordering,
    fs,
    path::Path,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub use ops::*;

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app.dialog().file().blocking_pick_folder();
    Ok(path.map(|path| path.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    #[default]
    Name,
    Size,
    Modified,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    #[default]
    Ascending,
    Descending,
}

/// One item a directory listing couldn't read, with a human-readable reason
/// — surfaced so "N items couldn't be read" can be expanded into something
/// actionable instead of just a count.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadableEntry {
    pub name: String,
    pub reason: String,
}

// Bounds the response size for a folder with thousands of unreadable
// children (e.g. an ACL'd system tree) — the count in `unreadable` already
// covers the full total, this only caps how many get named individually.
const MAX_UNREADABLE_ENTRIES: usize = 200;

/// A directory listing plus a count of items that were present but couldn't
/// be read at all. Reported rather than silently dropped: quietly showing an
/// incomplete folder is how people lose track of files.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<DirEntry>,
    pub unreadable: usize,
    #[serde(default)]
    pub unreadable_entries: Vec<UnreadableEntry>,
}

/// Turns an io::Error on the directory itself into something a person can
/// act on. Raw OS strings ("Access is denied. (os error 5)") say nothing
/// about which folder failed or why it's refusing. `pub(crate)` so the
/// folder-size walker (sizecache) can give the same explanation for the
/// same underlying error instead of a raw io::Error string.
pub(crate) fn describe_dir_error(path: &str, error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => format!(
            "Access denied — Windows is blocking access to {path}. \
             This is usually a system-protected folder (WindowsApps and similar) \
             that needs elevated permissions to open."
        ),
        std::io::ErrorKind::NotFound => format!("{path} no longer exists."),
        _ => format!("Couldn't open {path}: {error}"),
    }
}

#[tauri::command]
pub fn list_directory(
    path: String,
    sort_key: SortKey,
    sort_direction: SortDirection,
    group_folders_first: bool,
) -> Result<DirListing, String> {
    let mut listing = read_dir_listing(&path)?;
    sort_entries(&mut listing.entries, sort_key, sort_direction, group_folders_first);
    Ok(listing)
}

/// The read half of a listing: walks the directory and collects entries plus
/// whatever couldn't be read, with no ordering applied. Split out from
/// list_directory so the streaming variant can reuse the exact same
/// per-entry handling — divergence here would mean a folder listed
/// differently depending on how big it happened to be.
fn read_dir_listing(path: &str) -> Result<DirListing, String> {
    let read_dir = fs::read_dir(path).map_err(|e| describe_dir_error(path, &e))?;

    let mut entries = Vec::new();
    let mut unreadable = 0usize;
    let mut unreadable_entries = Vec::new();
    for entry in read_dir {
        // One unreadable child must not sink the whole listing. This used
        // to propagate with `?`, so a single protected item — C:\Program
        // Files\WindowsApps is ACL'd to TrustedInstaller, and system
        // junctions have to be opened to be followed — replaced the entire
        // folder with "Access is denied. (os error 5)". Explorer lists what
        // it can; so do we.
        let Ok(entry) = entry else {
            unreadable += 1;
            if unreadable_entries.len() < MAX_UNREADABLE_ENTRIES {
                unreadable_entries.push(UnreadableEntry {
                    name: "(unknown entry)".to_string(),
                    reason: "Directory entry itself could not be read".to_string(),
                });
            }
            continue;
        };
        // file_type() comes from the directory scan itself and needs no
        // access to the item; metadata() may have to open it, which is the
        // call that actually fails on protected entries.
        let Ok(file_type) = entry.file_type() else {
            unreadable += 1;
            if unreadable_entries.len() < MAX_UNREADABLE_ENTRIES {
                unreadable_entries.push(UnreadableEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    reason: "Access denied — couldn't determine file type".to_string(),
                });
            }
            continue;
        };
        let metadata = entry.metadata().ok();
        let is_dir = match &metadata {
            Some(metadata) => metadata.is_dir(),
            // Couldn't follow it. The scan's own type is right for a plain
            // directory; for a reparse point we couldn't resolve, probe the
            // path so junctions still render as folders rather than files.
            None => file_type.is_dir() || (file_type.is_symlink() && entry.path().is_dir()),
        };
        let modified = metadata
            .as_ref()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
            size: metadata.as_ref().map(|metadata| metadata.len()).unwrap_or(0),
            modified,
        });
    }

    Ok(DirListing { entries, unreadable, unreadable_entries })
}

fn sort_entries(
    entries: &mut [DirEntry],
    sort_key: SortKey,
    sort_direction: SortDirection,
    group_folders_first: bool,
) {
    entries.sort_by(|a, b| {
        let ordering = match sort_key {
            SortKey::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            SortKey::Size => a.size.cmp(&b.size),
            SortKey::Modified => a.modified.cmp(&b.modified),
        };
        let ordering = match sort_direction {
            SortDirection::Ascending => ordering,
            SortDirection::Descending => ordering.reverse(),
        };
        if !group_folders_first {
            return ordering;
        }
        match (a.is_dir, b.is_dir) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => ordering,
        }
    });
}

/// How many entries go out per `directory-chunk` event. Small enough that
/// the first chunk lands almost immediately, large enough that a 100k-entry
/// folder doesn't turn into thousands of IPC round trips.
const STREAM_CHUNK_SIZE: usize = 500;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryChunk {
    key: String,
    path: String,
    /// Monotonic per request, so the frontend can drop an out-of-order or
    /// duplicated chunk rather than rendering the folder twice.
    seq: usize,
    entries: Vec<DirEntry>,
    /// True on the last chunk only. The unreadable counts ride along with
    /// it, since they aren't known until the whole directory has been read.
    done: bool,
    unreadable: usize,
    unreadable_entries: Vec<UnreadableEntry>,
    /// Set instead of entries when the directory couldn't be opened at all.
    error: Option<String>,
}

/// Lists a directory by emitting `directory-chunk` events instead of
/// returning one payload.
///
/// Chunks are emitted **after** sorting, not in read order. Streaming raw
/// read order would let rows land in the wrong place and then jump when the
/// sort finally ran — worse than waiting. What this actually buys is
/// twofold: the read runs on its own thread instead of blocking the main
/// thread the way a synchronous command does, and the result crosses the IPC
/// boundary in slices rather than as one enormous JSON string that has to be
/// serialized, copied and parsed before anything at all can be painted.
#[tauri::command]
pub fn list_directory_streamed(
    app: AppHandle,
    key: String,
    path: String,
    sort_key: SortKey,
    sort_direction: SortDirection,
    group_folders_first: bool,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let emit = |chunk: DirectoryChunk| {
            let _ = app.emit("directory-chunk", chunk);
        };
        let empty_chunk = |seq: usize, done: bool| DirectoryChunk {
            key: key.clone(),
            path: path.clone(),
            seq,
            entries: Vec::new(),
            done,
            unreadable: 0,
            unreadable_entries: Vec::new(),
            error: None,
        };

        let mut listing = match read_dir_listing(&path) {
            Ok(listing) => listing,
            Err(error) => {
                // A failure is still a completed request: the frontend is
                // waiting on `done` to stop showing the previous folder.
                emit(DirectoryChunk { error: Some(error), ..empty_chunk(0, true) });
                return;
            }
        };
        sort_entries(&mut listing.entries, sort_key, sort_direction, group_folders_first);

        let unreadable = listing.unreadable;
        let unreadable_entries = listing.unreadable_entries;
        let total_chunks = listing.entries.len().div_ceil(STREAM_CHUNK_SIZE).max(1);
        let mut seq = 0;
        let mut remaining = listing.entries;
        // Drained from the front in place so the entries are moved into each
        // chunk rather than cloned — the whole point is not copying a huge
        // listing more times than necessary.
        while seq < total_chunks {
            let take = remaining.len().min(STREAM_CHUNK_SIZE);
            let rest = remaining.split_off(take);
            let is_last = seq + 1 == total_chunks;
            emit(DirectoryChunk {
                key: key.clone(),
                path: path.clone(),
                seq,
                entries: remaining,
                done: is_last,
                unreadable: if is_last { unreadable } else { 0 },
                unreadable_entries: if is_last { unreadable_entries.clone() } else { Vec::new() },
                error: None,
            });
            remaining = rest;
            seq += 1;
        }
    });
    Ok(())
}

const SEARCH_RESULT_LIMIT: usize = 500;

#[tauri::command]
pub fn search_directory(root: String, query: String, recursive: bool) -> Result<Vec<DirEntry>, String> {
    let root_path = std::path::PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("{} is not a directory", root));
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    search_recursive(&root_path, &query_lower, recursive, &mut results);
    Ok(results)
}

fn search_recursive(dir: &Path, query_lower: &str, recursive: bool, results: &mut Vec<DirEntry>) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    for entry in read_dir.flatten() {
        if results.len() >= SEARCH_RESULT_LIMIT {
            return;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();

        if name.to_lowercase().contains(query_lower) {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs());

            results.push(DirEntry {
                name: name.clone(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified,
            });
        }

        if recursive && metadata.is_dir() {
            search_recursive(&entry.path(), query_lower, recursive, results);
        }
    }
}

/// One content-search hit — a file whose contents matched, with the first
/// matching line's number and text. Only one match per file is kept, same
/// as a typical quick-search tool; a file with many matching lines still
/// produces a single row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMatch {
    pub entry: DirEntry,
    pub line_number: u32,
    pub snippet: String,
}

// Extensions that are essentially never useful to read as text — binaries,
// archives, and common media. Skipping them by extension avoids opening
// (and, for large binaries, reading megabytes of) files that can never
// contain a text match, without needing a byte-sniffing "is this binary"
// helper.
const CONTENT_SEARCH_DENY_EXTENSIONS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib", "class",
    "zip", "7z", "rar", "tar", "gz", "bz2", "xz", "iso",
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg", "tiff",
    "mp3", "mp4", "wav", "flac", "ogg", "avi", "mkv", "mov", "webm",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "ttf", "otf", "woff", "woff2",
    "db", "sqlite", "sqlite3",
];

// Files larger than this are skipped without being read — a quick content
// search shouldn't stall on multi-gigabyte logs or datasets.
const CONTENT_SEARCH_MAX_SIZE: u64 = 5 * 1024 * 1024;

fn is_content_search_denied(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            CONTENT_SEARCH_DENY_EXTENSIONS
                .iter()
                .any(|denied| denied.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn search_content(root: String, query: String, recursive: bool) -> Result<Vec<ContentMatch>, String> {
    let root_path = std::path::PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("{} is not a directory", root));
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    search_content_recursive(&root_path, &query_lower, recursive, &mut results);
    Ok(results)
}

fn search_content_recursive(dir: &Path, query_lower: &str, recursive: bool, results: &mut Vec<ContentMatch>) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    for entry in read_dir.flatten() {
        if results.len() >= SEARCH_RESULT_LIMIT {
            return;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            if recursive {
                search_content_recursive(&entry.path(), query_lower, recursive, results);
            }
            continue;
        }

        if metadata.len() > CONTENT_SEARCH_MAX_SIZE || is_content_search_denied(&entry.path()) {
            continue;
        }

        let Ok(contents) = fs::read_to_string(entry.path()) else {
            continue;
        };

        let found = contents
            .lines()
            .enumerate()
            .find(|(_, line)| line.to_lowercase().contains(query_lower));

        let Some((line_index, line)) = found else {
            continue;
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());

        results.push(ContentMatch {
            entry: DirEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir: false,
                size: metadata.len(),
                modified,
            },
            line_number: line_index as u32 + 1,
            snippet: line.to_string(),
        });
    }
}

#[tauri::command]
pub fn list_graph_children(path: String) -> Result<Vec<DirEntry>, String> {
    let read_dir = fs::read_dir(&path).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAccessEntry {
    pub label: String,
    pub path: String,
}

#[tauri::command]
pub fn get_quick_access() -> Vec<QuickAccessEntry> {
    let candidates: [(&str, Option<std::path::PathBuf>); 6] = [
        ("Desktop", dirs::desktop_dir()),
        ("Documents", dirs::document_dir()),
        ("Downloads", dirs::download_dir()),
        ("Pictures", dirs::picture_dir()),
        ("Music", dirs::audio_dir()),
        ("Videos", dirs::video_dir()),
    ];

    candidates
        .into_iter()
        .filter_map(|(label, path)| {
            path.map(|p| QuickAccessEntry {
                label: label.to_string(),
                path: p.to_string_lossy().to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn list(dir: &Path) -> Result<DirListing, String> {
        list_directory(dir.to_string_lossy().to_string(), SortKey::Name, SortDirection::Ascending, true)
    }

    #[test]
    fn an_entry_that_cannot_be_resolved_does_not_sink_the_listing() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("readable.txt"), b"hello").unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/nonexistent/target", dir.path().join("broken")).unwrap();

        let listing = list(dir.path()).expect("one bad child must not fail the whole listing");
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"readable.txt"), "{names:?}");
        assert!(names.contains(&"subdir"), "{names:?}");
        #[cfg(unix)]
        {
            assert!(names.contains(&"broken"), "unresolvable entry still listed: {names:?}");
            let broken = listing.entries.iter().find(|e| e.name == "broken").unwrap();
            assert!(!broken.is_dir, "a link to nothing is not a directory");
        }
        assert_eq!(listing.unreadable, 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_directory_we_cannot_enumerate_still_reports_an_actionable_error() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let locked = dir.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

        // Only the directory itself being unreadable surfaces to the user,
        // and it must name the folder rather than leaking "os error 13".
        if let Err(message) = list(&locked) {
            assert!(message.contains("Access denied"), "{message}");
            assert!(message.contains(&locked.to_string_lossy().to_string()), "{message}");
            assert!(!message.contains("os error"), "raw OS string leaked: {message}");
        }
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn a_missing_directory_says_so_plainly() {
        let err = list(Path::new("/definitely/not/here")).unwrap_err();
        assert!(err.contains("no longer exists"), "{err}");
    }

    #[test]
    fn listing_reports_directories_first_with_real_metadata() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), vec![0u8; 7]).unwrap();
        fs::create_dir(dir.path().join("zzz")).unwrap();

        let listing = list(dir.path()).unwrap();
        assert_eq!(listing.entries[0].name, "zzz");
        assert!(listing.entries[0].is_dir);
        assert_eq!(listing.entries[1].name, "a.txt");
        assert_eq!(listing.entries[1].size, 7);
        assert!(listing.entries[1].modified.is_some());
    }

    #[test]
    fn search_directory_matches_case_insensitive_substring_non_recursive() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("Report.txt"), "a").unwrap();
        fs::write(dir.path().join("notes.md"), "b").unwrap();
        fs::create_dir(dir.path().join("reports")).unwrap();

        let results = search_directory(dir.path().to_string_lossy().to_string(), "report".to_string(), false).unwrap();

        let names: Vec<&str> = results.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"Report.txt"));
        assert!(names.contains(&"reports"));
    }

    #[test]
    fn search_directory_non_recursive_skips_nested_matches() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("target.txt"), "a").unwrap();

        let results =
            search_directory(dir.path().to_string_lossy().to_string(), "target".to_string(), false).unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_directory_recursive_finds_nested_matches() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("target.txt"), "a").unwrap();

        let results =
            search_directory(dir.path().to_string_lossy().to_string(), "target".to_string(), true).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "target.txt");
    }

    #[test]
    fn search_directory_rejects_non_directory_root() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "a").unwrap();

        let result = search_directory(file.to_string_lossy().to_string(), "a".to_string(), false);
        assert!(result.is_err());
    }

    #[test]
    fn search_content_matches_case_insensitive_substring_non_recursive() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "line one\nline TODO here\nline three").unwrap();
        fs::write(dir.path().join("other.txt"), "nothing relevant").unwrap();

        let results =
            search_content(dir.path().to_string_lossy().to_string(), "todo".to_string(), false).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entry.name, "notes.txt");
        assert_eq!(results[0].line_number, 2);
        assert_eq!(results[0].snippet, "line TODO here");
    }

    #[test]
    fn search_content_non_recursive_skips_nested_matches() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("notes.txt"), "TODO here").unwrap();

        let results =
            search_content(dir.path().to_string_lossy().to_string(), "todo".to_string(), false).unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_content_recursive_finds_nested_matches() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("notes.txt"), "TODO here").unwrap();

        let results =
            search_content(dir.path().to_string_lossy().to_string(), "todo".to_string(), true).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entry.name, "notes.txt");
    }

    #[test]
    fn search_content_skips_deny_listed_extensions() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("image.png"), "TODO here").unwrap();

        let results =
            search_content(dir.path().to_string_lossy().to_string(), "todo".to_string(), false).unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_content_skips_files_over_size_cap() {
        let dir = tempdir().unwrap();
        let big = "a".repeat(CONTENT_SEARCH_MAX_SIZE as usize + 1) + "TODO";
        fs::write(dir.path().join("big.txt"), big).unwrap();

        let results =
            search_content(dir.path().to_string_lossy().to_string(), "todo".to_string(), false).unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn list_directory_interleaves_dirs_and_files_when_grouping_is_off() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("z_folder")).unwrap();
        fs::write(dir.path().join("m_file.txt"), "content").unwrap();
        fs::create_dir(dir.path().join("a_folder")).unwrap();

        let grouped =
            list_directory(dir.path().to_string_lossy().to_string(), SortKey::Name, SortDirection::Ascending, true)
                .unwrap();
        let names: Vec<&str> = grouped.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a_folder", "z_folder", "m_file.txt"], "folders sort before files when grouped");

        let ungrouped =
            list_directory(dir.path().to_string_lossy().to_string(), SortKey::Name, SortDirection::Ascending, false)
                .unwrap();
        let names: Vec<&str> = ungrouped.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a_folder", "m_file.txt", "z_folder"], "plain name order when grouping is off");
    }

    #[test]
    fn list_graph_children_includes_files_and_dirs_dirs_first() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("b_folder")).unwrap();
        fs::create_dir(dir.path().join("a_folder")).unwrap();
        fs::write(dir.path().join("a_file.txt"), "content").unwrap();

        let entries = list_graph_children(dir.path().to_string_lossy().to_string()).unwrap();

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a_folder", "b_folder", "a_file.txt"]);
        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert!(!entries[2].is_dir);
        assert_eq!(entries[2].size, 7);
    }

    #[test]
    fn quick_access_resolves_known_windows_folders() {
        let entries = get_quick_access();

        let labels: Vec<&str> = entries.iter().map(|e| e.label.as_str()).collect();
        assert!(labels.contains(&"Documents"), "expected Documents in {:?}", labels);
        assert!(labels.contains(&"Desktop"), "expected Desktop in {:?}", labels);

        for entry in &entries {
            assert!(
                std::path::Path::new(&entry.path).is_dir(),
                "{} path {} should exist and be a directory",
                entry.label,
                entry.path
            );
        }
    }
}
