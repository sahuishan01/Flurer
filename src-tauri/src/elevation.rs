//! Platform-specific privilege elevation.
//!
//! "Relaunch as administrator" means different things per OS:
//!
//! - **Windows** uses UAC through PowerShell's `Start-Process -Verb RunAs`,
//!   the same shell path Explorer uses (CreateProcess does not honor a
//!   `requireAdministrator` manifest by itself).
//! - **Linux** uses `pkexec` (polkit), which is the standard desktop
//!   elevation mechanism. The elevated process gets a different, minimal
//!   environment from polkit; the display/session variables a GUI needs are
//!   forwarded explicitly as `--elevated-env=KEY=VALUE` arguments and applied
//!   at the very top of `run()`, before GTK/WebKit initialize.
//!
//! The launch is fire-and-forget in the sense that the original instance
//! exits once the elevated one is up, but on Linux we wait for the elevated
//! process to write a ready marker before exiting — so declining the polkit
//! prompt leaves the current window alive instead of closing Flurer with
//! nothing to replace it.

use std::path::Path;
#[cfg(target_os = "linux")]
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

// Whether this process already runs with an elevated token. Used by the
// "Always run as admin" startup self-elevation so an already-elevated
// instance doesn't loop UAC prompts at itself.
#[cfg(target_os = "windows")]
pub fn is_current_process_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    // OpenProcessToken lives under Threading in windows-sys 0.59, not
    // Security — surprising but per the crate's own module layout.
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

// Starts an elevated copy of `exe` via PowerShell's RunAs verb and WAITS
// for the UAC decision: returns Ok(true) if the elevated process was
// started, Ok(false) if the user declined the prompt (PowerShell exits
// non-zero — the caller should keep running unelevated rather than dying).
// Waiting here is deliberate for the startup path, where setup hasn't
// built any window state yet; the interactive relaunch_as_admin command
// keeps its fire-and-forget spawn instead.
#[cfg(target_os = "windows")]
pub fn elevate_and_wait(
    exe: &Path,
    extra_args: &[String],
    _settings_source: Option<&Path>,
) -> Result<bool, String> {
    // The elevated copy must not race this instance's shutdown: it inherits
    // --takeover-from and waits for our pid to exit before running the
    // single-instance plugin check, otherwise it sees the dying unelevated
    // instance's mutex and exits itself (observed as "no window, no crash").
    let takeover_arg = format!("--takeover-from={}", std::process::id());
    let mut all_args = vec![takeover_arg];
    // CLI launch-path args must be forwarded too: `flurer.exe <path>` with
    // "Always run as admin" on would otherwise open at the default folder —
    // the handoff was observed dropping the path entirely (0.4.200).
    all_args.extend(extra_args.iter().cloned());
    let arg_list = all_args.iter().map(|a| ps_quote(a)).collect::<Vec<_>>().join(",");
    let command = format!(
        "Start-Process -FilePath {} -ArgumentList {} -Verb RunAs",
        ps_quote(&exe.to_string_lossy()),
        arg_list
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &command]);
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);

    let status = cmd
        .status()
        .map_err(|e| format!("Failed to launch elevation request: {e}"))?;
    Ok(status.success())
}

// Both bundle targets' installers request admin rights in their manifest
// (the NSIS one since installMode "both" lets a user pick a per-machine
// install; msiexec always does for a per-machine MSI). Spawning them with
// `Command::spawn()` calls CreateProcess directly, which — unlike
// ShellExecute — does NOT honor a "requireAdministrator" manifest: instead
// of showing the UAC consent prompt, it fails outright with
// ERROR_ELEVATION_REQUIRED (os error 740). Routing through PowerShell's
// `Start-Process -Verb RunAs` uses ShellExecute internally, which is what
// actually triggers the UAC dialog the way double-clicking the installer
// in Explorer would.
//
// Also chains `-Wait` plus a second Start-Process that relaunches the
// currently-running exe once the installer exits — so the user doesn't
// have to notice Flurer closed and go find it again. This whole PowerShell
// invocation is spawned detached (see CREATE_NO_WINDOW below) specifically
// so it survives our own process exiting moments later (see the app.exit
// call above): a child process is NOT killed when its parent exits on
// Windows unless a Job Object says otherwise, and we never set one up.
#[cfg(target_os = "windows")]
pub fn launch_elevated_and_relaunch(path: &str, args: &[&str]) -> std::io::Result<std::process::Child> {
    let mut command = format!("Start-Process -FilePath {}", ps_quote(path));
    if !args.is_empty() {
        let arg_list = args.iter().map(|a| ps_quote(a)).collect::<Vec<_>>().join(",");
        command.push_str(&format!(" -ArgumentList {arg_list}"));
    }
    command.push_str(" -Verb RunAs -Wait");

    match std::env::current_exe() {
        Ok(current_exe) => {
            command.push_str(&format!("; Start-Process -FilePath {}", ps_quote(&current_exe.to_string_lossy())));
        }
        Err(e) => {
            // Non-fatal: the update still installs, it just won't
            // auto-relaunch — log it so a report of "it didn't reopen"
            // has a matching entry in the log file to explain why.
            log::error!("download_and_install_update: could not resolve current_exe, won't auto-relaunch: {e}");
        }
    }

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &command]);

    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn()
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

// Only these variables are forwarded to the elevated process. They are the
// ones a Wayland/X11 GUI needs to reach the session it was started from; an
// allowlist (rather than passing the whole environment) keeps things like
// LD_PRELOAD, LD_LIBRARY_PATH, and PATH from leaking into a root process.
#[cfg(target_os = "linux")]
const ELEVATED_ENV_VARS: &[&str] = &[
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_SESSION_TYPE",
    "XDG_CURRENT_DESKTOP",
    "HYPRLAND_INSTANCE_SIGNATURE",
    "GDK_BACKEND",
    "QT_QPA_PLATFORM",
    "XCURSOR_THEME",
    "XCURSOR_SIZE",
];

#[cfg(target_os = "linux")]
pub fn is_current_process_elevated() -> bool {
    // Root is the only identity that bypasses UNIX permission checks, so
    // euid 0 is exactly the "can read anything" state this feature wants.
    unsafe { libc::geteuid() == 0 }
}

/// Clears the parent-death signal `pkexec` arms on itself before `execv`.
///
/// That attribute survives exec, so without clearing it the elevated Flurer
/// would be SIGTERM'd the instant the unelevated instance exits — exactly
/// what we ask it to do after the ready marker. This must run before the
/// unelevated instance can exit, hence before the file logger (and its
/// warnings) exist; a failure here is silent but cannot be fixed later.
#[cfg(target_os = "linux")]
pub fn prepare_elevated_process() {
    if !is_current_process_elevated() {
        return;
    }
    unsafe {
        libc::prctl(
            libc::PR_SET_PDEATHSIG,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
            0 as libc::c_ulong,
        );
    }
}

#[cfg(not(target_os = "linux"))]
pub fn prepare_elevated_process() {}

/// Restores the real uid to the user who authorized the elevated launch,
/// while leaving the effective uid at 0.
///
/// pkexec makes every uid root. Keeping that would make D-Bus peer
/// credentials, portals, and other session consumers see a root client;
/// setting the real uid back to the invoking user keeps the session wiring
/// attributed to them, and file access still uses euid 0. Runs after the
/// logger exists so a failure (which would leave the process fully root) is
/// at least recorded.
#[cfg(target_os = "linux")]
pub fn restore_real_uid() {
    if !is_current_process_elevated() {
        return;
    }
    if let Some(uid) = invoking_uid() {
        let uid = uid as libc::uid_t;
        if unsafe { libc::setresuid(uid, 0, 0) } != 0 {
            log::warn!(
                "elevated: could not restore real uid {uid}: {}",
                std::io::Error::last_os_error()
            );
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn restore_real_uid() {}

// The uid that asked polkit/sudo to elevate us. Used to refuse copying an
// arbitrary file into the elevated profile and to keep the ready marker
// inside a directory that user can see.
#[cfg(target_os = "linux")]
pub(crate) fn invoking_uid() -> Option<u32> {
    ["PKEXEC_UID", "SUDO_UID"].iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
    })
}

/// Applies the session variables forwarded through `--elevated-env=KEY=VALUE`.
///
/// Must run before GTK/WebKit initialize: `pkexec` clears the environment by
/// design, and those libraries read WAYLAND_DISPLAY/XDG_RUNTIME_DIR once at
/// startup. Only an allowlisted set is accepted, and only in a process that
/// is actually elevated, so a normal (unelevated) launch can't use this to
/// inject anything into its own environment.
#[cfg(target_os = "linux")]
pub fn apply_cli_env() {
    if !is_current_process_elevated() {
        return;
    }
    for arg in std::env::args().skip(1) {
        let Some((key, value)) = parse_elevated_env(&arg) else {
            continue;
        };
        if !ELEVATED_ENV_VARS.contains(&key) {
            log::warn!("elevated: ignoring non-allowlisted env var {key}");
            continue;
        }
        // XDG_RUNTIME_DIR is where the elevated WebKit/GTK will create
        // sockets and cache files as root; only accept a real directory
        // owned by the user who authorized the launch (their /run/user dir).
        if key == "XDG_RUNTIME_DIR" {
            use std::os::unix::fs::MetadataExt;
            let path = Path::new(value);
            let Ok(metadata) = std::fs::metadata(path) else {
                log::warn!("elevated: ignoring unreadable XDG_RUNTIME_DIR {value}");
                continue;
            };
            if !path.is_absolute() || !metadata.is_dir() {
                log::warn!("elevated: ignoring non-directory XDG_RUNTIME_DIR {value}");
                continue;
            }
            if let Some(uid) = invoking_uid() {
                if metadata.uid() != uid {
                    log::warn!("elevated: ignoring XDG_RUNTIME_DIR not owned by uid {uid}");
                    continue;
                }
            }
        }
        std::env::set_var(key, value);
        log::info!("elevated: applying session env {key}");
    }
}

// Split on the FIRST '=' only: values such as D-Bus addresses contain '='.
#[cfg(target_os = "linux")]
fn parse_elevated_env(arg: &str) -> Option<(&str, &str)> {
    arg.strip_prefix("--elevated-env=")?.split_once('=')
}

#[cfg(not(target_os = "linux"))]
pub fn apply_cli_env() {}

/// Writes the file the unelevated instance is waiting for, proving the
/// elevated process got past polkit authentication and started.
///
/// `create_new(true)` (O_CREAT|O_EXCL) means a pre-planted symlink or file
/// can't be truncated; the path is additionally limited to a directory the
/// invoking user owns (their runtime dir) or root's temp dir.
#[cfg(target_os = "linux")]
pub fn write_ready_marker() {
    if !is_current_process_elevated() {
        return;
    }
    let Some(path) = std::env::args().find_map(|arg| {
        arg.strip_prefix("--elevated-ready=").map(PathBuf::from)
    }) else {
        return;
    };
    if !path.is_absolute() {
        log::warn!("elevated: ignoring non-absolute ready marker path {}", path.display());
        return;
    }
    let Some(parent) = path.parent() else {
        return;
    };
    if !marker_parent_is_safe(parent) {
        log::warn!("elevated: refusing to write ready marker outside the invoking user's dir");
        return;
    }

    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
    {
        Ok(mut file) => {
            let _ = writeln!(
                file,
                "pid={} version={}",
                std::process::id(),
                env!("CARGO_PKG_VERSION")
            );
            log::info!("elevated: wrote ready marker {}", path.display());
        }
        Err(e) => log::warn!("elevated: could not write ready marker {}: {e}", path.display()),
    }
}

#[cfg(not(target_os = "linux"))]
pub fn write_ready_marker() {}

#[cfg(target_os = "linux")]
fn marker_parent_is_safe(parent: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(meta) = std::fs::metadata(parent) else {
        return false;
    };
    let temp = std::env::temp_dir();
    match invoking_uid() {
        // The runtime dir belongs to the user we were elevated for. The
        // temp dir is only allowed by exact path (it is root-owned, but
        // O_EXCL makes a pre-planted file harmless).
        Some(uid) => meta.uid() == uid || parent == temp,
        None => parent == temp || parent.starts_with("/run/user"),
    }
}

#[cfg(target_os = "linux")]
fn new_ready_marker_path() -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|dir| dir.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    dir.join(format!("flurer-elevated-{}-{nanos}.ready", std::process::id()))
}

/// The program pkexec should execute.
///
/// Inside an AppImage, `current_exe()` points into the FUSE mount under
/// /tmp/.mount_*. FUSE does not grant root access unless the mount was
/// created with allow_other, so root often cannot even read that path.
/// Re-running the AppImage itself as root sidesteps that: its runtime
/// mounts its own copy and sets up APPDIR/LD_LIBRARY_PATH for the child.
/// The path is shown in the polkit dialog, so an unexpected APPIMAGE value
/// is visible to whoever approves the prompt.
#[cfg(target_os = "linux")]
fn launch_program(exe: &Path) -> PathBuf {
    // Both must agree: APPDIR is the mount the running executable lives in,
    // APPIMAGE is the file that produced it. Checking only APPIMAGE would
    // let a stray environment value redirect an elevated launch to an
    // unrelated executable.
    let (Some(appdir), Some(appimage)) = (
        std::env::var_os("APPDIR").map(PathBuf::from),
        std::env::var_os("APPIMAGE").map(PathBuf::from),
    ) else {
        return exe.to_path_buf();
    };
    if appdir.is_absolute()
        && appimage.is_absolute()
        && exe.starts_with(&appdir)
        && appimage.is_file()
    {
        return appimage;
    }
    exe.to_path_buf()
}

#[cfg(target_os = "linux")]
fn pkexec_path() -> Option<PathBuf> {
    ["/usr/bin/pkexec", "/usr/local/bin/pkexec", "/bin/pkexec"]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .or_else(|| {
            std::env::var_os("PATH").and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|dir| dir.join("pkexec"))
                    .find(|path| path.is_file())
            })
        })
}

#[cfg(target_os = "linux")]
fn elevated_args(marker: &Path, settings_source: Option<&Path>, extra_args: &[String]) -> Vec<String> {
    let mut args = vec![
        // The elevated copy must not race our shutdown: it waits for this
        // pid to disappear before the single-instance plugin claims the
        // name, otherwise it sees the dying instance and exits immediately.
        format!("--takeover-from={}", std::process::id()),
        format!("--elevated-ready={}", marker.display()),
    ];
    if let Some(source) = settings_source {
        args.push(format!("--seed-settings-from={}", source.display()));
    }
    // Forward the session variables polkit strips. Values can contain '='
    // (D-Bus addresses), hence the split-once parse on the receiving side.
    for key in ELEVATED_ENV_VARS {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                args.push(format!("--elevated-env={key}={value}"));
            }
        }
    }
    // On X11 sessions XAUTHORITY is often unset because the cookie lives in
    // ~/.Xauthority. Root's HOME is /root, so without this the X11 fallback
    // would try the wrong file and fail authorization.
    if std::env::var_os("XAUTHORITY").is_none() {
        if let Some(home) = std::env::var_os("HOME") {
            let xauthority = PathBuf::from(home).join(".Xauthority");
            if xauthority.is_file() {
                args.push(format!("--elevated-env=XAUTHORITY={}", xauthority.display()));
            }
        }
    }
    args.extend(extra_args.iter().cloned());
    args
}

#[cfg(target_os = "linux")]
fn spawn_pkexec(exe: &Path, args: &[String]) -> Result<std::process::Child, String> {
    let pkexec = pkexec_path().ok_or_else(|| {
        "Could not find pkexec. Install polkit (Arch: sudo pacman -S polkit) and make sure a polkit authentication agent is running.".to_string()
    })?;
    let mut cmd = std::process::Command::new(pkexec);
    // A GUI app has no controlling terminal, so polkit's own textual agent
    // can never prompt here. Requiring a real (session) agent makes the
    // failure immediate and explainable instead of hanging on stdin.
    cmd.arg("--disable-internal-agent");
    cmd.arg(exe);
    cmd.args(args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    cmd.spawn()
        .map_err(|e| format!("Failed to start pkexec: {e}"))
}

#[cfg(target_os = "linux")]
enum LinuxStart {
    Started,
    Cancelled,
    Failed(String),
}

#[cfg(target_os = "linux")]
fn wait_for_elevated_start(mut child: std::process::Child, marker: &Path) -> LinuxStart {
    use std::time::{Duration, Instant};

    // Long enough for a person to type a password, short enough that a
    // genuinely stuck pkexec doesn't hang the caller forever.
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if marker.is_file() {
            return LinuxStart::Started;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return match status.code() {
                    Some(126) => LinuxStart::Cancelled,
                    Some(127) => LinuxStart::Failed(
                        "Administrator authentication failed. Make sure a polkit authentication agent is running \
                         (on Hyprland/Omarchy the shell normally provides one; otherwise install hyprpolkitagent \
                         or polkit-gnome) and that your user is allowed to authenticate (usually via the wheel group)."
                            .to_string(),
                    ),
                    code => LinuxStart::Failed(format!(
                        "pkexec exited with status {} before Flurer started.",
                        code.map(|c| c.to_string()).unwrap_or_else(|| "signal".to_string())
                    )),
                };
            }
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return LinuxStart::Failed(format!("Failed while waiting for pkexec: {e}"));
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return LinuxStart::Failed(
                "Timed out waiting for the elevated Flurer instance to start.".to_string(),
            );
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(target_os = "linux")]
fn relaunch_linux(app: &tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    if is_current_process_elevated() {
        return Err("Flurer is already running as administrator.".to_string());
    }
    let exe = std::env::current_exe()
        .map_err(|e| format!("Could not resolve current executable: {e}"))?;
    let marker = new_ready_marker_path();
    let _ = std::fs::remove_file(&marker);
    let settings_source = crate::helpers::settings::settings_path(app).ok();
    let extra_args: Vec<String> = path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .into_iter()
        .collect();
    let args = elevated_args(&marker, settings_source.as_deref(), &extra_args);

    let child = spawn_pkexec(&launch_program(&exe), &args)?;
    let result = wait_for_elevated_start(child, &marker);
    let _ = std::fs::remove_file(&marker);
    match result {
        LinuxStart::Started => {
            log::info!("relaunch_as_admin: elevated instance started, exiting current one");
            app.exit(0);
            Ok(())
        }
        LinuxStart::Cancelled => {
            log::info!("relaunch_as_admin: authentication cancelled, keeping current instance alive");
            Err("Administrator authentication was cancelled.".to_string())
        }
        LinuxStart::Failed(message) => {
            log::error!("relaunch_as_admin: {message}");
            Err(message)
        }
    }
}

#[cfg(target_os = "linux")]
pub fn elevate_and_wait(
    exe: &Path,
    extra_args: &[String],
    settings_source: Option<&Path>,
) -> Result<bool, String> {
    if is_current_process_elevated() {
        return Ok(true);
    }
    let marker = new_ready_marker_path();
    let _ = std::fs::remove_file(&marker);
    let args = elevated_args(&marker, settings_source, extra_args);
    let child = spawn_pkexec(&launch_program(exe), &args)?;
    let result = wait_for_elevated_start(child, &marker);
    let _ = std::fs::remove_file(&marker);
    match result {
        LinuxStart::Started => Ok(true),
        LinuxStart::Cancelled => Ok(false),
        LinuxStart::Failed(message) => Err(message),
    }
}

// Linux updates are not wired to the Windows installer flow; report that
// clearly rather than trying to run powershell.
#[cfg(target_os = "linux")]
pub fn launch_elevated_and_relaunch(_path: &str, _args: &[&str]) -> std::io::Result<std::process::Child> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "automatic updates are not supported on Linux",
    ))
}

// ---------------------------------------------------------------------------
// Other platforms
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn is_current_process_elevated() -> bool {
    false
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn elevate_and_wait(
    _exe: &Path,
    _extra_args: &[String],
    _settings_source: Option<&Path>,
) -> Result<bool, String> {
    Err("administrator relaunch is not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn relaunch(_app: &tauri::AppHandle, _path: Option<String>) -> Result<(), String> {
    Err("administrator relaunch is not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn launch_elevated_and_relaunch(_path: &str, _args: &[&str]) -> std::io::Result<std::process::Child> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "automatic updates are not supported on this platform",
    ))
}

// ---------------------------------------------------------------------------
// Shared entry point
// ---------------------------------------------------------------------------

/// Relaunches the running Flurer instance elevated, for reaching folders this
/// process can't otherwise read (system directories and other users' homes).
///
/// The settings flush happens before the process can exit: this command kills
/// the current instance, and the frontend's debounced save may not have fired
/// yet.
#[tauri::command(async)]
pub fn relaunch_as_admin(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    {
        use crate::state::AppState;
        use tauri::Manager;
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(guard) = state.settings.try_lock() {
                if let Err(e) = crate::helpers::settings::save_settings(&app, &guard) {
                    log::error!("relaunch_as_admin: failed to flush settings before exit: {e}");
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = path;
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Could not resolve current executable: {e}"))?;
        let command = format!(
            "Start-Process -FilePath {} -Verb RunAs",
            ps_quote(&current_exe.to_string_lossy())
        );
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &command]);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.spawn() {
            Ok(_) => {
                log::info!("relaunch_as_admin: launched elevated instance, exiting current one");
                app.exit(0);
                Ok(())
            }
            Err(e) => {
                log::error!("relaunch_as_admin: failed to launch elevated instance: {e}");
                Err(format!("Failed to relaunch as administrator: {e}"))
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        relaunch_linux(&app, path)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = path;
        Err("administrator relaunch is not supported on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn elevated_env_values_may_contain_equals() {
        assert_eq!(
            parse_elevated_env("--elevated-env=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus"),
            Some(("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"))
        );
        assert_eq!(parse_elevated_env("--takeover-from=123"), None);
        assert_eq!(parse_elevated_env("--elevated-env=NOEQUALS"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn marker_is_only_allowed_in_a_shareable_directory() {
        let temp = std::env::temp_dir();
        assert!(marker_parent_is_safe(&temp));
        assert!(!marker_parent_is_safe(std::path::Path::new("/etc")));
    }
}
