//! Enumerates fixed drives, opens a volume handle for each, and for NTFS
//! ones runs the "MFT scan, then poll the USN journal" pipeline
//! (mft.rs/journal.rs) on a dedicated thread per volume.
//!
//! Non-NTFS volumes (exFAT/FAT32 removable drives, network shares) report
//! `VolumeStatus::Unavailable` and are intentionally left unhandled here:
//! `flurer.exe` already has a working per-folder notify watcher
//! (`GenericNotifyBackend`) it falls back to for those, so duplicating
//! that logic in this service would be redundant, not a missing feature.
//!
//! TODO(future alternative backends): if a filesystem-specific backend is
//! ever worth building instead of leaning on `GenericNotifyBackend` — e.g.
//! SMB change notifications for network shares, or a polling strategy
//! tuned to exFAT/FAT32's coarser timestamp resolution — it slots in
//! exactly where the NTFS branch is chosen below, keyed off the same
//! `GetVolumeInformationW` filesystem-name string.

use crate::state::SharedState;
use std::io;
use std::path::PathBuf;
use std::thread;
use watch_protocol::VolumeStatus;
use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

/// The root directory of an NTFS volume is always MFT record 5 — a
/// documented, stable constant, not something discovered per-volume.
const NTFS_ROOT_FRN: u64 = 5;

/// `GetDriveTypeW`'s "fixed drive" return value. Not exposed by this
/// version of windows-sys under `Storage::FileSystem` (build error:
/// "no `DRIVE_FIXED` in `Win32::Storage::FileSystem`") despite being where
/// the Win32 docs place it, so defined locally — this is one of the
/// documented, ABI-stable `GetDriveTypeW` return codes
/// (UNKNOWN=0, NO_ROOT_DIR=1, REMOVABLE=2, FIXED=3, REMOTE=4, CDROM=5,
/// RAMDISK=6), not something that varies by Windows version.
const DRIVE_FIXED: u32 = 3;

pub fn spawn_watchers(shared: SharedState) {
    thread::spawn(move || {
        for drive_letter in fixed_drive_letters() {
            let shared = shared.clone();
            thread::spawn(move || watch_volume(drive_letter, shared));
        }
    });
}

fn fixed_drive_letters() -> Vec<char> {
    let mask = unsafe { GetLogicalDrives() };
    (b'A'..=b'Z')
        .filter(|&b| mask & (1 << (b - b'A')) != 0)
        .filter(|&b| {
            let path = to_wide(&format!("{}:\\", b as char));
            unsafe { GetDriveTypeW(path.as_ptr()) == DRIVE_FIXED }
        })
        .map(|b| b as char)
        .collect()
}

fn is_ntfs(drive_letter: char) -> bool {
    let root = to_wide(&format!("{drive_letter}:\\"));
    let mut fs_name = [0u16; 32];
    let ok = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    };
    if ok == 0 {
        return false;
    }
    String::from_utf16_lossy(&fs_name).trim_end_matches('\0') == "NTFS"
}

fn open_volume_handle(drive_letter: char) -> io::Result<HANDLE> {
    let path = to_wide(&format!(r"\\.\{drive_letter}:"));
    let handle = unsafe {
        CreateFileW(path.as_ptr(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null_mut(), OPEN_EXISTING, 0, std::ptr::null_mut())
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(handle)
}

fn watch_volume(drive_letter: char, shared: SharedState) {
    let volume = format!("{drive_letter}:");
    if !is_ntfs(drive_letter) {
        shared.broadcast_volume_status(volume, VolumeStatus::Unavailable { reason: "not an NTFS volume".into() });
        return;
    }

    let handle = match open_volume_handle(drive_letter) {
        Ok(h) => h,
        Err(e) => {
            log::warn!("failed to open volume handle for {volume}: {e}");
            shared.broadcast_volume_status(volume, VolumeStatus::Unavailable { reason: e.to_string() });
            return;
        }
    };

    shared.broadcast_volume_status(volume.clone(), VolumeStatus::Scanning);

    let root: PathBuf = format!(r"{drive_letter}:\").into();

    let mft = match crate::mft::scan_volume(handle, NTFS_ROOT_FRN) {
        Ok(table) => table,
        Err(e) => {
            log::warn!("MFT scan failed for {volume}: {e}");
            shared.broadcast_volume_status(volume, VolumeStatus::Unavailable { reason: e.to_string() });
            unsafe { CloseHandle(handle) };
            return;
        }
    };

    let journal = match crate::journal::query_journal(handle) {
        Ok(j) => j,
        Err(e) => {
            log::warn!("USN journal query failed for {volume}: {e}");
            shared.broadcast_volume_status(volume, VolumeStatus::Unavailable { reason: e.to_string() });
            unsafe { CloseHandle(handle) };
            return;
        }
    };

    shared.broadcast_volume_status(volume.clone(), VolumeStatus::JournalReady);
    // Blocks this thread for the volume's lifetime. TODO(follow-up):
    // poll_loop returning (e.g. journal ID changed underneath us) should
    // trigger a fresh MFT scan + re-query here in a retry loop instead of
    // silently leaving this volume without further updates — known gap,
    // not implemented in this pass.
    crate::journal::poll_loop(handle, &root, journal, mft, &shared);
    unsafe { CloseHandle(handle) };
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
