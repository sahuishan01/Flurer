//! Client side of the named-pipe connection to `flurer-watchd`. Connects
//! (with reconnect/backoff), sends the current watch scope, and forwards
//! `ServerMessage`s into the same cache-invalidation path the local notify
//! watcher uses (`enqueue_watcher_recompute`/`is_cached`), so a
//! journal-sourced change and a notify-sourced change are handled
//! identically once resolved to a path — compare `handle_file_system_event`
//! in the parent module, this is its journal-sourced twin.
//!
//! If the service isn't installed, isn't running, or the pipe simply isn't
//! reachable for any other reason, `connect()` just keeps failing and
//! retrying in the background forever. Every volume behaves exactly as it
//! does today in that case: `start_watching_exact` only skips its local
//! notify watch for volumes explicitly reported as `JournalReady`, so
//! "watchd unreachable" degrades to "recursive notify watch on every
//! browsed root, same as before this feature existed," never to "no live
//! updates at all."

use crate::state::AppState;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use watch_protocol::{ChangeKind, ClientMessage, ServerMessage, VolumeStatus};

pub fn spawn(app: AppHandle) {
    thread::spawn(move || connect_loop(app));
}

fn connect_loop(app: AppHandle) {
    loop {
        if let Ok(stream) = transport::connect() {
            run_connection(&app, stream);
        }
        // Covers both "never managed to connect" (service not installed —
        // the common case on a fresh install before this feature's
        // installer changes have run, or a non-Windows build) and "was
        // connected, then the pipe dropped" (service restarted/crashed).
        // Not logged at warn level for the former case specifically to
        // avoid spamming logs forever on a machine that simply doesn't
        // have watchd; per-volume fallback is silent by design.
        thread::sleep(Duration::from_secs(5));
    }
}

fn run_connection(app: &AppHandle, stream: transport::PipeStream) {
    let write_handle = stream.write_handle();
    let (tx, rx) = mpsc::channel::<ClientMessage>();
    {
        let state = app.state::<AppState>();
        *state.size_cache.watchd_tx.lock().unwrap() = Some(tx.clone());
    }

    // Full current scope on every (re)connect — see the module doc for why
    // this is a full resend rather than relying on prior UpdateScope calls
    // having reached a since-restarted service.
    let _ = tx.send(ClientMessage::Hello { watch_scope: current_watch_scope(app) });

    let writer_thread = thread::spawn(move || {
        let mut w = write_handle;
        for msg in rx {
            if watch_protocol::write_message(&mut w, &msg).is_err() {
                break;
            }
        }
    });

    let mut reader = stream;
    loop {
        match watch_protocol::read_message::<_, ServerMessage>(&mut reader) {
            Ok(Some(ServerMessage::PathChanged { path, kind })) => apply_journal_change(app, path, kind),
            Ok(Some(ServerMessage::VolumeStatus { volume, status })) => apply_volume_status(app, volume, status),
            Ok(Some(ServerMessage::Pong)) => {}
            Ok(None) | Err(_) => break,
        }
    }

    let state = app.state::<AppState>();
    *state.size_cache.watchd_tx.lock().unwrap() = None;
    state.size_cache.journal_ready_volumes.lock().unwrap().clear();
    drop(reader); // closes the pipe, which ends the writer thread's next write
    let _ = writer_thread.join();
}

/// Notifies watchd of a newly-cached or newly-evicted root, if a
/// connection happens to be live. Silently a no-op otherwise — see the
/// module doc: a later reconnect resends the full scope, so a missed
/// update here is never a permanent gap, only a delay until reconnect.
pub fn update_scope(state: &AppState, add: Vec<String>, remove: Vec<String>) {
    if add.is_empty() && remove.is_empty() {
        return;
    }
    if let Some(tx) = state.size_cache.watchd_tx.lock().unwrap().as_ref() {
        let _ = tx.send(ClientMessage::UpdateScope { add, remove });
    }
}

fn current_watch_scope(app: &AppHandle) -> Vec<String> {
    let state = app.state::<AppState>();
    state.size_cache.roots.lock().unwrap().keys().map(|p| p.to_string_lossy().to_string()).collect()
}

fn apply_journal_change(app: &AppHandle, path: String, _kind: ChangeKind) {
    let state = app.state::<AppState>();
    if !state.settings.blocking_lock().live_folder_size_updates {
        return;
    }
    // Same ancestor-chain walk as handle_file_system_event: watchd already
    // resolved the record to the changed *directory* (not a raw file
    // event), so this only needs to walk upward invalidating cached
    // ancestors, not also derive the parent from a file path first.
    let mut current = Some(std::path::PathBuf::from(path));
    while let Some(dir) = current {
        if super::is_cached(&state, &dir) && super::enqueue_watcher_recompute(&state, dir.clone()) {
            log::info!("watchd-sourced recompute queued for {}", dir.display());
        }
        current = dir.parent().map(std::path::Path::to_path_buf);
    }
}

fn apply_volume_status(app: &AppHandle, volume: String, status: VolumeStatus) {
    let state = app.state::<AppState>();
    match status {
        VolumeStatus::JournalReady => {
            state.size_cache.journal_ready_volumes.lock().unwrap().insert(volume.clone());
            // Drop the now-redundant local recursive notify watch for any
            // already-watched root on this volume — watchd is reporting
            // its changes over the pipe now, so keeping both running would
            // just double the OS-level watch overhead this feature exists
            // to reduce.
            let mut watched = state.size_cache.watched_roots.lock().unwrap();
            let mut on_volume = Vec::new();
            watched.retain(|root| {
                if root_volume(root).as_deref() == Some(volume.as_str()) {
                    on_volume.push(root.clone());
                    false
                } else {
                    true
                }
            });
            drop(watched);
            if let Some(watcher) = state.size_cache.debouncer.lock().unwrap().as_mut() {
                for root in on_volume {
                    let _ = watcher.unwatch(&root);
                }
            }
        }
        VolumeStatus::Scanning => {
            // TODO(follow-up): a volume that drops out of JournalReady
            // (service restarted, journal recreated) back to Scanning
            // needs its already-cached roots re-subscribed to the local
            // notify watcher, or they go unwatched until the user
            // revisits them (start_watching runs on cache hit too, so a
            // revisit self-heals it, but an idle app on that volume
            // wouldn't see changes in the meantime). Not implemented in
            // this pass — known gap, not a silent-forever failure mode
            // since revisiting the folder recovers it.
            state.size_cache.journal_ready_volumes.lock().unwrap().remove(&volume);
        }
        VolumeStatus::Unavailable { reason } => {
            log::info!("watchd reports {volume} unavailable for journal-based watching: {reason}");
            state.size_cache.journal_ready_volumes.lock().unwrap().remove(&volume);
        }
    }
}

/// Extracts a Windows drive-letter prefix ("C:") from a path, matching the
/// `volume` string flurer-watchd reports (see its `volumes.rs`). Returns
/// `None` for a path with no drive prefix (shouldn't happen for anything
/// actually cached, but this is a filter, not a panic site).
pub(super) fn root_volume(path: &std::path::Path) -> Option<String> {
    match path.components().next()? {
        std::path::Component::Prefix(prefix) => Some(prefix.as_os_str().to_string_lossy().trim_end_matches('\\').to_string()),
        _ => None,
    }
}

#[cfg(windows)]
mod transport {
    use std::io;
    use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, WriteFile, OPEN_EXISTING};

    /// Owns the pipe handle (closes on drop). Used for reading, on the
    /// connection's main thread.
    pub struct PipeStream(HANDLE);
    unsafe impl Send for PipeStream {}

    impl PipeStream {
        /// A non-owning handle to the same pipe for the writer thread —
        /// see WriteHandle's doc for why this isn't a real `Clone`.
        pub fn write_handle(&self) -> WriteHandle {
            WriteHandle(self.0)
        }
    }

    impl io::Read for PipeStream {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let mut read = 0u32;
            let ok = unsafe { ReadFile(self.0, buf.as_mut_ptr(), buf.len() as u32, &mut read, std::ptr::null_mut()) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(read as usize)
        }
    }

    impl Drop for PipeStream {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    /// Non-owning write-only view of the same HANDLE as its parent
    /// `PipeStream`. Does not close on drop — `PipeStream` owns that.
    /// Same "one thread reads, one thread writes the same synchronous
    /// handle" split as flurer-watchd's pipe_server.rs, and for the same
    /// reason: supported by Windows per-direction, not for two threads
    /// sharing one direction.
    pub struct WriteHandle(HANDLE);
    unsafe impl Send for WriteHandle {}

    impl io::Write for WriteHandle {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let mut written = 0u32;
            let ok = unsafe { WriteFile(self.0, buf.as_ptr(), buf.len() as u32, &mut written, std::ptr::null_mut()) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(written as usize)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    pub fn connect() -> io::Result<PipeStream> {
        let name: Vec<u16> = watch_protocol::PIPE_NAME.encode_utf16().chain(std::iter::once(0)).collect();
        let handle = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ | GENERIC_WRITE, 0, std::ptr::null_mut(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        Ok(PipeStream(handle))
    }
}

#[cfg(not(windows))]
mod transport {
    use std::io;

    // The USN Journal (and therefore flurer-watchd) is Windows-only — see
    // the design doc. A non-Windows build of the main app has nothing to
    // connect to; every volume simply keeps using the local notify
    // watcher, unconditionally, forever. This stub exists purely so
    // watchd_client.rs's connect_loop compiles and behaves consistently
    // (endless harmless retries) rather than needing its own cfg branch.
    pub struct PipeStream;
    impl io::Read for PipeStream {
        fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::Unsupported))
        }
    }
    pub struct WriteHandle;
    impl io::Write for WriteHandle {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::Unsupported))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl PipeStream {
        pub fn write_handle(&self) -> WriteHandle {
            WriteHandle
        }
    }

    pub fn connect() -> io::Result<PipeStream> {
        Err(io::Error::from(io::ErrorKind::Unsupported))
    }
}
