//! Wire protocol between `flurer.exe` (unprivileged, the pipe client) and
//! `flurer-watchd` (the elevated Windows service that reads the NTFS USN
//! Journal, the pipe server). Kept in its own crate so neither side has to
//! depend on the other's crate to agree on message shapes.
//!
//! Framing: every message is a 4-byte little-endian length prefix followed
//! by that many bytes of JSON. JSON (not a binary format) is deliberate —
//! change-event volume here is small (per-folder invalidations, not a
//! firehose of raw filesystem events), so the simplicity of reusing
//! `serde_json` — already a dependency on both sides — outweighs the
//! bytes-on-the-wire cost of a hand-rolled binary protocol.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::io::{self, Read, Write};

/// Named pipe path both sides connect to. Windows-only syntax, but this
/// crate itself has no OS-specific code — it's just a string constant plus
/// serde types — so it still builds on any host for editing/testing the
/// protocol logic itself.
pub const PIPE_NAME: &str = r"\\.\pipe\flurer-watchd";

/// A message the service should back off and retry after, distinct from a
/// hard error, communicated verbally rather than via a numeric code since
/// it only ever surfaces in a log line, not branching logic.
pub type Reason = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientMessage {
    /// Sent immediately after connecting, and again after reconnecting
    /// following a dropped pipe: the full set of folders the client
    /// currently has cached and wants change notifications for. Full (not
    /// incremental) so a reconnect after the service restarted doesn't
    /// require either side to have remembered prior state.
    Hello { watch_scope: Vec<String> },
    /// Incremental scope update as folders enter/leave the size cache
    /// during normal use, so the service doesn't have to be told the full
    /// scope on every single change.
    UpdateScope { add: Vec<String>, remove: Vec<String> },
    /// Idle keep-alive; also lets the client detect a dead-but-not-yet-
    /// disconnected pipe faster than waiting for a write to fail.
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerMessage {
    /// Per-volume backend readiness, so the client knows whether to expect
    /// journal-sourced events for a given volume or whether it should keep
    /// relying on its own in-process notify watcher for it meanwhile.
    VolumeStatus { volume: String, status: VolumeStatus },
    /// A change under a watched path. `path` is always one of (or a
    /// descendant of) a path the client previously included in its watch
    /// scope — the service does the FRN-\u2192path resolution and filtering,
    /// the client never sees raw USN records.
    PathChanged { path: String, kind: ChangeKind },
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VolumeStatus {
    /// MFT scan complete, journal poll loop running -- changes on this
    /// volume are being reported.
    JournalReady,
    /// Baseline MFT scan still in progress; the client should keep its own
    /// notify watcher active for paths on this volume until this flips to
    /// `JournalReady`, so no window of missed changes opens up.
    Scanning,
    /// Not NTFS, or the volume handle / journal query failed (e.g. no
    /// USN Journal enabled, or an access-denied the service itself hit
    /// despite running elevated). `reason` is logged by the client, not
    /// parsed. The client permanently keeps using its notify watcher for
    /// this volume's paths.
    Unavailable { reason: Reason },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
    /// Directory structure changed in a way that isn't a safe file-size
    /// delta (rename, move) -- same "fall back to a full walk" treatment
    /// the existing notify-based handler gives these.
    StructureChanged,
}

/// Writes one length-prefixed JSON message. Blocking; callers on the
/// service side run this on a dedicated per-connection thread, and the
/// client runs it on its own pipe-client thread, so blocking here never
/// stalls the size-cache worker pool or the UI.
pub fn write_message<W: Write, T: Serialize>(writer: &mut W, msg: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec(msg).map_err(io::Error::other)?;
    let len = u32::try_from(bytes.len()).map_err(io::Error::other)?;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()
}

/// Reads one length-prefixed JSON message. Returns `Ok(None)` on a clean
/// EOF at a message boundary (the other side closed the pipe), distinct
/// from an error mid-message.
pub fn read_message<R: Read, T: DeserializeOwned>(reader: &mut R) -> io::Result<Option<T>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    // A message this large would only ever come from a corrupt/hostile
    // peer -- both sides only ever send small control/path messages -- so
    // bail rather than allocate an attacker-controlled buffer.
    const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
    if len > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "watch-protocol message exceeds size limit"));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    let msg = serde_json::from_slice(&buf).map_err(io::Error::other)?;
    Ok(Some(msg))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn roundtrips_a_message() {
        let msg = ClientMessage::Hello { watch_scope: vec!["C:\\Users\\me\\Downloads".to_string()] };
        let mut buf = Vec::new();
        write_message(&mut buf, &msg).unwrap();
        let mut cursor = Cursor::new(buf);
        let read: ClientMessage = read_message(&mut cursor).unwrap().unwrap();
        match read {
            ClientMessage::Hello { watch_scope } => assert_eq!(watch_scope, vec!["C:\\Users\\me\\Downloads"]),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn reports_clean_eof_at_boundary() {
        let mut cursor = Cursor::new(Vec::<u8>::new());
        let read: Option<ClientMessage> = read_message(&mut cursor).unwrap();
        assert!(read.is_none());
    }

    #[test]
    fn rejects_oversized_length_prefix() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(u32::MAX).to_le_bytes());
        let mut cursor = Cursor::new(buf);
        let err = read_message::<_, ClientMessage>(&mut cursor).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }
}
