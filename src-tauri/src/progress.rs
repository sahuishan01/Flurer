use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, LazyLock, Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// Drives the top-right progress indicator. Any long-running background task
// (file copy/move/delete, folder-size calculation) gets its own id from
// next_task_id() and reports progress through emit_progress as it goes, so
// the frontend can show real movement — or, for indeterminate work with no
// meaningful done/total count, just a running/finished state — instead of a
// single all-or-nothing spinner.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgress {
    pub task_id: u64,
    pub label: String,
    pub done: u64,
    pub total: u64,
    pub finished: bool,
    pub error: Option<String>,
    // True for work with no meaningful done/total count (e.g. a recursive
    // folder-size walk) — the frontend shows a running indicator instead of
    // a percent-complete bar for these.
    pub indeterminate: bool,
}

static NEXT_TASK_ID: AtomicU64 = AtomicU64::new(1);
static CANCELLED: LazyLock<Mutex<Vec<(u64, Arc<AtomicBool>)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

pub fn next_task_id() -> u64 {
    NEXT_TASK_ID.fetch_add(1, Ordering::Relaxed)
}

pub fn register_task() -> (u64, Arc<AtomicBool>) {
    let id = next_task_id();
    let flag = Arc::new(AtomicBool::new(false));
    let mut guard = CANCELLED.lock().unwrap();
    guard.push((id, flag.clone()));
    (id, flag)
}

pub fn cancel_task(task_id: u64) -> bool {
    let guard = CANCELLED.lock().unwrap();
    if let Some((_, flag)) = guard.iter().find(|(id, _)| *id == task_id) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

/// Removes a completed task from the global list so the vector
/// doesn't grow unbounded over the session. Called by every
/// operation (copy, move, delete, folder-size) after it finishes,
/// regardless of success or failure — cancelled tasks are cleaned
/// up the same way since the cancellation flag is no longer needed
/// once the operation has stopped running.
pub fn cleanup_task(task_id: u64) {
    let mut guard = CANCELLED.lock().unwrap();
    guard.retain(|(id, _)| *id != task_id);
}

pub fn is_cancelled(_task_id: u64, flag: &AtomicBool) -> bool {
    flag.load(Ordering::Relaxed)
}

pub fn emit_progress(
    app: &AppHandle,
    task_id: u64,
    label: &str,
    done: u64,
    total: u64,
    finished: bool,
    error: Option<String>,
    indeterminate: bool,
) {
    let _ = app.emit(
        "operation-progress",
        OperationProgress {
            task_id,
            label: label.to_string(),
            done,
            total,
            finished,
            error,
            indeterminate,
        },
    );
}
