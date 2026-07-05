mod ops;

use std::{cmp::Ordering, fs, time::UNIX_EPOCH};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubfolderEntry {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn list_subfolders(path: String) -> Result<Vec<SubfolderEntry>, String> {
    let read_dir = fs::read_dir(&path).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_dir() {
            continue;
        }
        entries.push(SubfolderEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
        });
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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
    fn list_subfolders_returns_only_directories_sorted_by_name() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("b_folder")).unwrap();
        fs::create_dir(dir.path().join("a_folder")).unwrap();
        fs::write(dir.path().join("file.txt"), "not a folder").unwrap();

        let entries = list_subfolders(dir.path().to_string_lossy().to_string()).unwrap();

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a_folder", "b_folder"]);
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
