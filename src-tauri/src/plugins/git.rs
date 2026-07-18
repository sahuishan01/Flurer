use serde::{Deserialize, Serialize};
use std::process::Command;

fn git(args: &[&str], repo_path: &str) -> Result<String, String> {
    Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))
        .and_then(|out| {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Err(if stderr.is_empty() { "git command failed".to_string() } else { stderr })
            }
        })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub ahead: i32,
    pub behind: i32,
    pub has_remote: bool,
    pub changes: Vec<GitChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub status: String,   // "M", "A", "D", "R", "??", etc.
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

#[tauri::command]
pub async fn git_repo_status(repo_path: String) -> Result<GitStatus, String> {
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &repo_path)?;

    // Check if remote exists
    let has_remote = git(&["rev-parse", "--abbrev-ref", "@{upstream}"], &repo_path).is_ok();

    let (ahead, behind) = if has_remote {
        match git(&["rev-list", "--count", "--left-right", "HEAD...@{upstream}"], &repo_path) {
            Ok(out) => {
                let parts: Vec<&str> = out.split('\t').collect();
                let ahead = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
                let behind = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
                (ahead, behind)
            }
            Err(_) => (0, 0),
        }
    } else {
        (0, 0)
    };

    // Parse status --porcelain
    let status_out = git(&["status", "--porcelain"], &repo_path).unwrap_or_default();
    let mut changes = Vec::new();
    for line in status_out.lines() {
        if line.len() < 4 { continue; }
        let (xy, path) = line.split_at(2);
        let xy = xy.trim();
        let staged = xy.chars().next().map_or(false, |c| c != ' ' && c != '?');
        let status = if xy == "??" { "?" } else { xy.trim().chars().last().map_or("?", |c| c.to_string().leak()) };
        changes.push(GitChange {
            path: path.trim().to_string(),
            status: xy.to_string(),
            staged,
        });
    }

    Ok(GitStatus { branch, ahead, behind, has_remote, changes })
}

#[tauri::command]
pub async fn git_branches(repo_path: String) -> Result<Vec<GitBranch>, String> {
    let out = git(&["branch"], &repo_path)?;
    Ok(out.lines().map(|line| {
        let current = line.starts_with('*');
        let name = if current { &line[2..] } else { line.trim() };
        GitBranch { name: name.to_string(), current }
    }).collect())
}

#[tauri::command]
pub async fn git_log(repo_path: String, max_count: u32) -> Result<Vec<GitCommit>, String> {
    let out = git(&[
        "log",
        &format!("--max-count={}", max_count),
        "--format=%H||%s||%an||%ct",
    ], &repo_path)?;

    Ok(out.lines().filter_map(|line| {
        let parts: Vec<&str> = line.splitn(4, "||").collect();
        if parts.len() < 4 { return None; }
        Some(GitCommit {
            hash: parts[0].to_string(),
            message: parts[1].to_string(),
            author: parts[2].to_string(),
            timestamp: parts[3].parse().unwrap_or(0),
        })
    }).collect())
}

#[tauri::command]
pub async fn git_stage(repo_path: String, file_path: String) -> Result<(), String> {
    git(&["add", &file_path], &repo_path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(repo_path: String, file_path: String) -> Result<(), String> {
    git(&["restore", "--staged", &file_path], &repo_path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_commit(repo_path: String, message: String) -> Result<(), String> {
    git(&["commit", "-m", &message], &repo_path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(repo_path: String) -> Result<String, String> {
    git(&["push"], &repo_path)
}

#[tauri::command]
pub async fn git_pull(repo_path: String) -> Result<String, String> {
    git(&["pull"], &repo_path)
}

#[tauri::command]
pub async fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    git(&["checkout", &branch], &repo_path)?;
    Ok(())
}
