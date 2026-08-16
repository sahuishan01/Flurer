//! Queries and polls the NTFS USN Change Journal for one volume:
//! FSCTL_QUERY_USN_JOURNAL gets the journal ID and current USN once;
//! repeated FSCTL_READ_USN_JOURNAL calls then read new records since the
//! last poll, translating each through the volume's `MftTable` into a
//! resolved path change reported to `SharedState`.
//!
//! Same caveat as mft.rs: struct/constant paths are written from
//! documented Win32 API shapes, not yet compiled against windows-sys in
//! this (Linux, non-Windows) environment — verify on first Windows build.

use crate::mft::MftTable;
use crate::state::SharedState;
use std::ffi::c_void;
use std::io;
use std::path::Path;
use std::time::Duration;
use watch_protocol::ChangeKind;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::IO::DeviceIoControl;
use windows_sys::Win32::System::Ioctl::{
    FSCTL_QUERY_USN_JOURNAL, FSCTL_READ_USN_JOURNAL, READ_USN_JOURNAL_DATA_V0, USN_JOURNAL_DATA_V0, USN_RECORD_V2,
    USN_REASON_DATA_EXTEND, USN_REASON_DATA_OVERWRITE, USN_REASON_DATA_TRUNCATION, USN_REASON_FILE_CREATE,
    USN_REASON_FILE_DELETE, USN_REASON_RENAME_NEW_NAME,
};

pub fn query_journal(volume_handle: HANDLE) -> io::Result<USN_JOURNAL_DATA_V0> {
    let mut data: USN_JOURNAL_DATA_V0 = unsafe { std::mem::zeroed() };
    let mut bytes_returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            volume_handle,
            FSCTL_QUERY_USN_JOURNAL,
            std::ptr::null_mut(),
            0,
            &mut data as *mut _ as *mut c_void,
            std::mem::size_of::<USN_JOURNAL_DATA_V0>() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(data)
}

/// Blocks the calling thread for the volume's lifetime, polling for new
/// journal records and reporting resolved directory changes through
/// `shared`. Callers run this on its own thread per volume (see
/// volumes.rs). Returns (rather than looping forever) on an unrecoverable
/// read error — most commonly the journal having been deleted and
/// recreated underneath us (new journal ID) — leaving that volume without
/// further updates; see the TODO in volumes.rs about detecting and
/// restarting from a fresh MFT scan in that case, not implemented here.
pub fn poll_loop(volume_handle: HANDLE, volume_root: &Path, journal: USN_JOURNAL_DATA_V0, mut mft: MftTable, shared: &SharedState) {
    let mut next_usn = journal.NextUsn;
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        let input = READ_USN_JOURNAL_DATA_V0 {
            StartUsn: next_usn,
            ReasonMask: u32::MAX, // all reasons; filtered after resolving below
            ReturnOnlyOnClose: 0,
            Timeout: 0,
            BytesToWaitFor: 0,
            UsnJournalID: journal.UsnJournalID,
        };
        let mut bytes_returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                volume_handle,
                FSCTL_READ_USN_JOURNAL,
                &input as *const _ as *mut c_void,
                std::mem::size_of::<READ_USN_JOURNAL_DATA_V0>() as u32,
                buffer.as_mut_ptr() as *mut c_void,
                buffer.len() as u32,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            log::warn!("USN journal read failed for {}: {}", volume_root.display(), io::Error::last_os_error());
            return;
        }
        if bytes_returned <= 8 {
            // Nothing new yet. FSCTL_READ_USN_JOURNAL has no
            // overlapped/async completion story worth the complexity here,
            // so this polls on a plain interval instead of blocking for a
            // notification; the volume is otherwise idle in this branch,
            // so a 1s poll costs nothing worth CPU-gating the way
            // background compression/replication is (see CLAUDE.md ยง3) —
            // it's an idle wait, not a hot loop.
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }

        next_usn = i64::from_ne_bytes(buffer[0..8].try_into().unwrap());
        let mut offset = 8usize;
        while offset < bytes_returned as usize {
            let record = unsafe { &*(buffer.as_ptr().add(offset) as *const USN_RECORD_V2) };
            if record.RecordLength == 0 {
                break;
            }
            handle_record(record, &mut mft, volume_root, shared);
            offset += record.RecordLength as usize;
        }
    }
}

fn handle_record(record: &USN_RECORD_V2, mft: &mut MftTable, volume_root: &Path, shared: &SharedState) {
    let name_ptr = unsafe { (record as *const USN_RECORD_V2 as *const u8).add(record.FileNameOffset as usize) };
    let name_slice = unsafe { std::slice::from_raw_parts(name_ptr as *const u16, record.FileNameLength as usize / 2) };
    let name = String::from_utf16_lossy(name_slice);

    let reason = record.Reason;
    let kind = if reason & USN_REASON_FILE_CREATE != 0 {
        mft.apply_create(record.FileReferenceNumber, record.ParentFileReferenceNumber, name);
        ChangeKind::Created
    } else if reason & USN_REASON_FILE_DELETE != 0 {
        mft.apply_remove(record.FileReferenceNumber);
        ChangeKind::Removed
    } else if reason & USN_REASON_RENAME_NEW_NAME != 0 {
        mft.apply_rename(record.FileReferenceNumber, record.ParentFileReferenceNumber, name);
        ChangeKind::StructureChanged
    } else if reason & (USN_REASON_DATA_EXTEND | USN_REASON_DATA_OVERWRITE | USN_REASON_DATA_TRUNCATION) != 0 {
        ChangeKind::Modified
    } else {
        // Attribute/access-time-only changes etc. aren't a size change —
        // ignore, mirroring incremental_change_for's filtering in the
        // existing notify-based handler.
        return;
    };

    // Report the *parent* directory as changed — that's what the existing
    // cache invalidation (the parent-chain walk in
    // sizecache::handle_file_system_event) expects, matching today's
    // notify-based semantics exactly so the client-side invalidation logic
    // doesn't need to change at all.
    if let Some(parent_path) = mft.resolve_path(volume_root, record.ParentFileReferenceNumber) {
        shared.broadcast_change(&parent_path, kind);
    }
}
