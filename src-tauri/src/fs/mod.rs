mod ops;

use std::{
    cmp::Ordering,
    fs,
    path::Path,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

pub use ops::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    Name,
    Size,
    Modified,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    Ascending,
    Descending,
}

#[tauri::command]
pub fn list_directory(
    path: String,
    sort_key: SortKey,
    sort_direction: SortDirection,
) -> Result<Vec<DirEntry>, String> {
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

    Ok(entries)
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
