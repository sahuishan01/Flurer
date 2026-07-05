use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

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

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else {
        fs::copy(src, dst)?;
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

#[tauri::command]
pub fn copy_items(sources: Vec<String>, destination_dir: String) -> Result<BatchResult, String> {
    let dest_dir = PathBuf::from(&destination_dir);
    if !dest_dir.is_dir() {
        return Err(format!("{} is not a directory", destination_dir));
    }

    let mut result = BatchResult::new();
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

        match copy_recursive(&src_path, &dest_path) {
            Ok(()) => result.push_ok(source),
            Err(e) => result.push_err(source, e.to_string()),
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn move_items(sources: Vec<String>, destination_dir: String) -> Result<BatchResult, String> {
    let dest_dir = PathBuf::from(&destination_dir);
    if !dest_dir.is_dir() {
        return Err(format!("{} is not a directory", destination_dir));
    }

    let mut result = BatchResult::new();
    for source in sources {
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

        if fs::rename(&src_path, &dest_path).is_ok() {
            result.push_ok(source);
            continue;
        }

        match copy_recursive(&src_path, &dest_path).and_then(|()| remove_any(&src_path)) {
            Ok(()) => result.push_ok(source),
            Err(e) => result.push_err(source, e.to_string()),
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn delete_items(paths: Vec<String>) -> Result<BatchResult, String> {
    let mut result = BatchResult::new();
    for path in paths {
        match trash::delete(&path) {
            Ok(()) => result.push_ok(path),
            Err(e) => result.push_err(path, e.to_string()),
        }
    }
    Ok(result)
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

        let result = copy_items(
            vec![src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
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

        let result = copy_items(
            vec![src_dir.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
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

        let result = copy_items(
            vec![src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
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

        let result = copy_items(
            vec![src_dir.to_string_lossy().to_string()],
            src_dir.to_string_lossy().to_string(),
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

        let result = move_items(
            vec![src.to_string_lossy().to_string()],
            dest_dir.to_string_lossy().to_string(),
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

        let result = delete_items(vec![file.to_string_lossy().to_string()]).unwrap();

        assert_eq!(result.succeeded.len(), 1);
        assert!(!file.exists());
    }

    #[test]
    fn empty_batch_is_ok_not_error() {
        let dir = tempdir().unwrap();
        let result = copy_items(vec![], dir.path().to_string_lossy().to_string()).unwrap();
        assert!(result.succeeded.is_empty());
        assert!(result.failed.is_empty());
    }
}
