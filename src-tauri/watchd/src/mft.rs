//! Scans a volume's Master File Table (MFT) via repeated FSCTL_ENUM_USN_DATA
//! calls to build a full FRN (file reference number) -> (parent FRN, name)
//! table, then resolves any FRN to a full path by walking parent links up
//! to the volume root. This is the "index everything up front" approach
//! chosen for the eager, all-fixed-drives-at-startup design, rather than
//! lazily resolving only folders Flurer has cached.
//!
//! NOTE: struct/constant names below (MFT_ENUM_DATA_V0, USN_RECORD_V2,
//! FSCTL_ENUM_USN_DATA and its field layout) are written from the
//! documented Win32 API shapes and have not been compiled against
//! windows-sys in this environment (Linux, no Windows target available).
//! Verify exact module paths and field names against the windows-sys 0.59
//! docs on the first Windows-side build — see the design doc's testing
//! section for why CI here couldn't catch that.

use std::collections::HashMap;
use std::ffi::c_void;
use std::io;
use std::path::PathBuf;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::Ioctl::{FSCTL_ENUM_USN_DATA, MFT_ENUM_DATA_V0, USN_RECORD_V2};
use windows_sys::Win32::System::IO::DeviceIoControl;

const ERROR_HANDLE_EOF: i32 = 38;

pub struct MftTable {
    entries: HashMap<u64, (u64, String)>,
    root_frn: u64,
}

impl MftTable {
    pub fn new(root_frn: u64) -> Self {
        Self { entries: HashMap::new(), root_frn }
    }

    /// Walks parent links from `frn` up to the volume root, building the
    /// full path. Returns `None` if `frn` isn't in the table (deleted
    /// between the scan/last update and this lookup — the caller drops
    /// the record, since a deleted path's size doesn't matter) or if a
    /// cycle/dangling parent is hit (a corrupt/inconsistent snapshot —
    /// treated the same as "can't resolve," never an infinite loop).
    pub fn resolve_path(&self, volume_root: &std::path::Path, frn: u64) -> Option<PathBuf> {
        let mut parts = Vec::new();
        let mut current = frn;
        let mut steps = 0usize;
        const MAX_DEPTH: usize = 4096;
        while current != self.root_frn {
            if steps > MAX_DEPTH {
                return None;
            }
            steps += 1;
            let (parent, name) = self.entries.get(&current)?;
            parts.push(name.clone());
            current = *parent;
        }
        let mut path = volume_root.to_path_buf();
        for part in parts.into_iter().rev() {
            path.push(part);
        }
        Some(path)
    }

    pub fn apply_create(&mut self, frn: u64, parent_frn: u64, name: String) {
        self.entries.insert(frn, (parent_frn, name));
    }

    pub fn apply_remove(&mut self, frn: u64) {
        self.entries.remove(&frn);
    }

    pub fn apply_rename(&mut self, frn: u64, new_parent_frn: u64, new_name: String) {
        self.entries.insert(frn, (new_parent_frn, new_name));
    }
}

/// Enumerates the entire MFT of an open volume handle via repeated
/// FSCTL_ENUM_USN_DATA calls, each continuing from the previous call's
/// resume point (the standard pattern for this control code: it fills the
/// output buffer with as many records as fit, prefixed by the FRN to
/// resume from, and the caller loops until no more data comes back).
pub fn scan_volume(volume_handle: HANDLE, root_frn: u64) -> io::Result<MftTable> {
    let mut table = MftTable::new(root_frn);
    let mut input = MFT_ENUM_DATA_V0 { StartFileReferenceNumber: 0, LowUsn: 0, HighUsn: i64::MAX };
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        let mut bytes_returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                volume_handle,
                FSCTL_ENUM_USN_DATA,
                &mut input as *mut _ as *mut c_void,
                std::mem::size_of::<MFT_ENUM_DATA_V0>() as u32,
                buffer.as_mut_ptr() as *mut c_void,
                buffer.len() as u32,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() == Some(ERROR_HANDLE_EOF) {
                break; // normal termination: no more records
            }
            return Err(err);
        }
        if bytes_returned <= 8 {
            break; // only the next-start-FRN came back, no records
        }

        let next_start = u64::from_ne_bytes(buffer[0..8].try_into().unwrap());
        let mut offset = 8usize;
        while offset < bytes_returned as usize {
            let record = unsafe { &*(buffer.as_ptr().add(offset) as *const USN_RECORD_V2) };
            if record.RecordLength == 0 {
                break; // malformed/end padding — stop parsing this buffer
            }
            let name_ptr = unsafe { buffer.as_ptr().add(offset).add(record.FileNameOffset as usize) };
            let name_slice = unsafe { std::slice::from_raw_parts(name_ptr as *const u16, record.FileNameLength as usize / 2) };
            let name = String::from_utf16_lossy(name_slice);
            table.apply_create(record.FileReferenceNumber, record.ParentFileReferenceNumber, name);
            offset += record.RecordLength as usize;
        }

        if next_start == input.StartFileReferenceNumber {
            break; // no forward progress reported — stop rather than spin
        }
        input.StartFileReferenceNumber = next_start;
    }

    Ok(table)
}
