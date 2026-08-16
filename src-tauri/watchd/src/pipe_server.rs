//! Named pipe server: accepts connections from `flurer.exe` (and any other
//! future client), reads `ClientMessage`s to learn/update each client's
//! watch scope, and owns the writer side that `state::SharedState` pushes
//! `ServerMessage`s into as volume watchers resolve changes.
//!
//! One thread per connection for the reader, plus one dedicated writer
//! thread per connection draining a channel — so a slow client can't block
//! change-event delivery to other clients, and writes never interleave
//! with the connection's own read loop on the same handle.

use crate::state::SharedState;
use std::ffi::c_void;
use std::io;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use watch_protocol::{read_message, write_message, ClientMessage, ServerMessage, PIPE_NAME};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_PIPE_CONNECTED, HANDLE, HLOCAL, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
use windows_sys::Win32::Security::{SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR};
// PIPE_ACCESS_DUPLEX is a dwOpenMode flag for CreateNamedPipeW, but shares
// the CreateFile flag namespace, which is why windows-sys places it under
// Storage::FileSystem rather than System::Pipes (build error: "no
// `PIPE_ACCESS_DUPLEX` in `Win32::System::Pipes`" pointed here).
use windows_sys::Win32::Storage::FileSystem::{PIPE_ACCESS_DUPLEX, ReadFile, WriteFile};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_MESSAGE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
};

/// Owns the pipe handle: closes and disconnects it on drop. Used for the
/// reader side of a connection, which lives for the connection's whole
/// lifetime.
struct PipeHandle(HANDLE);
unsafe impl Send for PipeHandle {}

impl io::Read for PipeHandle {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut read = 0u32;
        let ok = unsafe { ReadFile(self.0, buf.as_mut_ptr(), buf.len() as u32, &mut read, std::ptr::null_mut()) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(read as usize)
    }
}

impl Drop for PipeHandle {
    fn drop(&mut self) {
        unsafe {
            DisconnectNamedPipe(self.0);
            CloseHandle(self.0);
        }
    }
}

/// A non-owning view of the same HANDLE, used by the writer thread. Does
/// NOT close the handle on drop — `PipeHandle` (the reader side) owns
/// that, closing it once when the connection's reader loop ends, which
/// also unblocks any write the writer thread had in flight. Two threads
/// each driving one direction (read-only here, write-only there) of the
/// same synchronous HANDLE is supported by Windows; two threads both
/// reading or both writing the same handle concurrently is not, which is
/// why the split is by direction rather than sharing one full-duplex
/// wrapper.
struct WriteOnlyPipeHandle(HANDLE);
unsafe impl Send for WriteOnlyPipeHandle {}

impl io::Write for WriteOnlyPipeHandle {
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

pub fn spawn(shared: SharedState) {
    thread::spawn(move || accept_loop(shared));
}

fn accept_loop(shared: SharedState) {
    loop {
        match create_pipe_instance() {
            Ok(handle) => {
                let connected = unsafe { ConnectNamedPipe(handle.0, std::ptr::null_mut()) };
                if connected == 0 {
                    let err = unsafe { GetLastError() };
                    if err != ERROR_PIPE_CONNECTED {
                        log::warn!("ConnectNamedPipe failed: {err}");
                        continue;
                    }
                }
                let shared = shared.clone();
                thread::spawn(move || handle_client(handle, shared));
            }
            Err(e) => {
                log::error!("failed to create named pipe instance: {e}");
                thread::sleep(Duration::from_secs(1));
            }
        }
    }
}

/// Owns the security descriptor buffer `ConvertStringSecurityDescriptorToSecurityDescriptorW`
/// allocates, freeing it (via `LocalFree`) on drop so every
/// `create_pipe_instance` call — one per pipe instance, i.e. per accepted
/// connection — doesn't leak it. The `SECURITY_ATTRIBUTES` handed to
/// `CreateNamedPipeW` only needs to stay valid for the duration of that
/// call, so a fresh one per call (rather than caching one at startup) is
/// simpler and not a hot path.
struct PipeSecurityDescriptor(*mut c_void);

impl PipeSecurityDescriptor {
    /// SDDL `D:(A;;GRGW;;;IU)` — a DACL with exactly one ACE: generic
    /// read+write granted to the INTERACTIVE well-known SID (any
    /// interactively logged-on user), nothing else. No explicit deny ACE
    /// needed — an ACL that only lists allow-ACEs for specific
    /// principals implicitly denies everyone not listed, including the
    /// pipe's default owner/creator grants that `lpSecurityAttributes:
    /// NULL` would otherwise apply. Combined with
    /// `PIPE_REJECT_REMOTE_CLIENTS` below (belt-and-braces: that flag
    /// stops a remote SMB peer from reaching the pipe at all, independent
    /// of whether the ACL were ever misconfigured).
    const SDDL: &'static str = "D:(A;;GRGW;;;IU)";

    fn build() -> io::Result<Self> {
        let sddl: Vec<u16> = Self::SDDL.encode_utf16().chain(std::iter::once(0)).collect();
        let mut descriptor: *mut SECURITY_DESCRIPTOR = std::ptr::null_mut();
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1, // SDDL_REVISION_1
                &mut descriptor as *mut _ as *mut *mut c_void,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(descriptor as *mut c_void))
    }

    fn as_ptr(&self) -> *mut c_void {
        self.0
    }
}

impl Drop for PipeSecurityDescriptor {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0 as HLOCAL);
        }
    }
}

fn create_pipe_instance() -> io::Result<PipeHandle> {
    let name: Vec<u16> = PIPE_NAME.encode_utf16().chain(std::iter::once(0)).collect();
    let descriptor = PipeSecurityDescriptor::build()?;
    let mut security_attributes =
        SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor.as_ptr(), bInheritHandle: 0 };
    let handle = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            4096,
            4096,
            0,
            &mut security_attributes,
        )
    };
    // `descriptor` must outlive the CreateNamedPipeW call above (it does —
    // dropped here, after) but not the pipe handle itself: Windows copies
    // what it needs out of the security descriptor during pipe creation,
    // it doesn't hold a reference to this buffer for the pipe's lifetime.
    drop(descriptor);
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(PipeHandle(handle))
}

fn handle_client(handle: PipeHandle, shared: SharedState) {
    let (tx, rx) = mpsc::channel::<ServerMessage>();
    let id = shared.register_client(tx);

    let write_side = WriteOnlyPipeHandle(handle.0);
    let writer = thread::spawn(move || {
        let mut w = write_side;
        for msg in rx {
            if write_message(&mut w, &msg).is_err() {
                break;
            }
        }
    });

    let mut reader = handle;
    loop {
        match read_message::<_, ClientMessage>(&mut reader) {
            Ok(Some(ClientMessage::Hello { watch_scope })) => {
                shared.set_scope(id, watch_scope.into_iter().map(std::path::PathBuf::from).collect());
            }
            Ok(Some(ClientMessage::UpdateScope { add, remove })) => {
                shared.update_scope(
                    id,
                    add.into_iter().map(std::path::PathBuf::from).collect(),
                    remove.into_iter().map(std::path::PathBuf::from).collect(),
                );
            }
            Ok(Some(ClientMessage::Ping)) => {
                shared.send_to(id, ServerMessage::Pong);
            }
            Ok(None) => break, // client closed the pipe cleanly
            Err(e) => {
                log::warn!("pipe read error, dropping client {id}: {e}");
                break;
            }
        }
    }

    shared.unregister_client(id);
    // Dropping `reader` here closes/disconnects the pipe handle, which
    // unblocks the writer thread's channel drain (further sends still
    // succeed into the channel, but the next WriteFile will fail and the
    // writer thread exits its loop) and ensures the handle is closed
    // exactly once regardless of which side (client hang-up vs. a read
    // error) ended the connection.
    drop(reader);
    let _ = writer.join();
}
