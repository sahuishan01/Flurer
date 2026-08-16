//! Registry of connected pipe clients (normally just one — `flurer.exe` —
//! but the pipe server accepts multiple in case several Flurer windows or a
//! future second process connect) and their current watch scopes, plus the
//! fan-out from a resolved path change to whichever clients asked for it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use watch_protocol::{ChangeKind, ServerMessage, VolumeStatus};

pub type ClientId = u64;

struct ClientEntry {
    sender: Sender<ServerMessage>,
    scope: HashSet<PathBuf>,
}

#[derive(Default)]
struct Inner {
    next_client_id: ClientId,
    clients: HashMap<ClientId, ClientEntry>,
}

#[derive(Clone, Default)]
pub struct SharedState(Arc<Mutex<Inner>>);

impl SharedState {
    pub fn register_client(&self, sender: Sender<ServerMessage>) -> ClientId {
        let mut inner = self.0.lock().unwrap();
        let id = inner.next_client_id;
        inner.next_client_id += 1;
        inner.clients.insert(id, ClientEntry { sender, scope: HashSet::new() });
        id
    }

    pub fn unregister_client(&self, id: ClientId) {
        self.0.lock().unwrap().clients.remove(&id);
    }

    pub fn set_scope(&self, id: ClientId, scope: HashSet<PathBuf>) {
        if let Some(entry) = self.0.lock().unwrap().clients.get_mut(&id) {
            entry.scope = scope;
        }
    }

    pub fn update_scope(&self, id: ClientId, add: Vec<PathBuf>, remove: Vec<PathBuf>) {
        if let Some(entry) = self.0.lock().unwrap().clients.get_mut(&id) {
            for p in remove {
                entry.scope.remove(&p);
            }
            for p in add {
                entry.scope.insert(p);
            }
        }
    }

    pub fn send_to(&self, id: ClientId, msg: ServerMessage) {
        if let Some(entry) = self.0.lock().unwrap().clients.get(&id) {
            let _ = entry.sender.send(msg);
        }
    }

    /// Forwards a changed directory to every client whose scope contains
    /// it or an ancestor of it — a client watching a folder cares about
    /// changes anywhere under it, not just changes to that exact path.
    pub fn broadcast_change(&self, path: &Path, kind: ChangeKind) {
        let inner = self.0.lock().unwrap();
        for entry in inner.clients.values() {
            if entry.scope.iter().any(|root| path.starts_with(root)) {
                let _ = entry.sender.send(ServerMessage::PathChanged { path: path.to_string_lossy().to_string(), kind });
            }
        }
    }

    pub fn broadcast_volume_status(&self, volume: String, status: VolumeStatus) {
        let inner = self.0.lock().unwrap();
        for entry in inner.clients.values() {
            let _ = entry.sender.send(ServerMessage::VolumeStatus { volume: volume.clone(), status: status.clone() });
        }
    }
}
