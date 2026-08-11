mod ops;

use std::{
    cmp::Ordering,
    fs,
    path::Path,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

pub use ops::*;

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app.dialog().file().blocking_pick_folder();
    Ok(path.map(|path| path.to_string_lossy().to_string()))
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

/// A directory listing plus a count of items that were present but couldn't
/// be read at all. Reported rather than silently dropped: quietly showing an
/// incomplete folder is how people lose track of files.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<DirEntry>,
    pub unreadable: usize,
}

/// Turns an io::Error on the directory itself into something a person can
/// act on. Raw OS strings ("Access is denied. (os error 5)") say nothing
/// about which folder failed or why it's refusing.
fn describe_dir_error(path: &str, error: &std::io::Error) -> String {
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
) -> Result<DirListing, String> {
    let read_dir = fs::read_dir(&path).map_err(|e| describe_dir_error(&path, &e))?;

    let mut entries = Vec::new();
    let mut unreadable = 0usize;
    for entry in read_dir {
        // One unreadable child must not sink the whole listing. This used
        // to propagate with `?`, so a single protected item — C:\Program
        // Files\WindowsApps is ACL'd to TrustedInstaller, and system
        // junctions have to be opened to be followed — replaced the entire
        // folder with "Access is denied. (os error 5)". Explorer lists what
        // it can; so do we.
        let Ok(entry) = entry else {
            unreadable += 1;
            continue;
        };
        // file_type() comes from the directory scan itself and needs no
        // access to the item; metadata() may have to open it, which is the
        // call that actually fails on protected entries.
        let Ok(file_type) = entry.file_type() else {
            unreadable += 1;
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
        match (a.is_dir, b.is_dir) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => ordering,
        }
    });

    Ok(DirListing { entries, unreadable })
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
        list_directory(dir.to_string_lossy().to_string(), SortKey::Name, SortDirection::Ascending)
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
