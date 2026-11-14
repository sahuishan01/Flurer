use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use tauri::{AppHandle, State};

use crate::state::{AppState, Settings};

// All app state/config lives here rather than the platform app-data dir, and
// is namespaced by version so a future breaking settings-schema change can't
// corrupt or silently truncate an older install's file — each version gets
// its own settings.json.
pub fn config_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".config").join("flurer"))
}

fn version_dir(root: &Path, version: &str) -> PathBuf {
    root.join(version)
}

// Shared across versions (not namespaced like settings.json) since it's just
// a cache of the last-shown background image, not a preference that needs
// migration — every download overwrites this same file.
pub fn wallpaper_cache_path() -> Result<PathBuf, String> {
    let root = config_root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.join("wallpaper.jpg"))
}

// Tracks when wallpaper.jpg was last replaced, shared by every running
// instance of the app — lets each instance decide whether a scheduled
// refresh is actually due instead of always fetching on its own timer, so
// multiple windows/processes converge on the same background.
pub fn wallpaper_metadata_path() -> Result<PathBuf, String> {
    let root = config_root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.join("wallpaper_meta.json"))
}

// Same reasoning as wallpaper_cache_path — a cache of computed folder sizes,
// not a versioned preference, so it survives version upgrades unmigrated
// and is just overwritten in place as it's updated.
pub fn size_cache_path() -> Result<PathBuf, String> {
    let root = config_root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.join("size_cache.json"))
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

// Writes `bytes` to `path` atomically via a uniquely-named temp sibling
// (process id + a counter) plus rename. Several of these cache files
// (wallpaper.jpg, wallpaper_meta.json, size_cache.json) are shared by every
// running instance of the app; a fixed temp filename would let concurrent
// writers race on the same temp path and corrupt or clobber each other's
// write, whereas each writer here gets its own temp file and only the
// (atomic, same-volume) rename ever touches the shared final path.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("tmp");
    let temp = path.with_extension(format!("{ext}.{}-{counter}.tmp", std::process::id()));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path)
}

pub(crate) fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = config_root()?;
    let dir = version_dir(&root, &app.package_info().version.to_string());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Copies the unelevated profile's settings (and cached wallpaper) into the
/// elevated process's profile before `load_settings` runs.
///
/// The elevated instance is deliberately run with root's HOME: writing into
/// the user's `~/.config/flurer` as root would leave root-owned files behind
/// that the next normal (unelevated) launch could no longer save. Seeding a
/// copy gives the admin window the same theme, tabs, and window geometry
/// without touching the user's files, while changes made while elevated stay
/// in root's profile.
///
/// Only honored when `pkexec`/`sudo` elevated us (PKEXEC_UID/SUDO_UID is
/// set) and the handed-over file is owned by that same user, so a root
/// invocation cannot be tricked into copying an arbitrary file.
#[cfg(target_os = "linux")]
pub fn seed_elevated_settings_from_cli() {
    use std::os::unix::fs::MetadataExt;

    if unsafe { libc::geteuid() } != 0 {
        return;
    }
    let Some(source) = std::env::args().find_map(|arg| {
        arg.strip_prefix("--seed-settings-from=").map(PathBuf::from)
    }) else {
        return;
    };
    let Ok(metadata) = fs::metadata(&source) else {
        log::warn!("elevated: seed settings file {} is not readable", source.display());
        return;
    };
    let Some(uid) = crate::elevation::invoking_uid() else {
        log::warn!("elevated: no invoking uid; not seeding settings");
        return;
    };
    if metadata.uid() != uid {
        log::warn!("elevated: refusing to seed settings from a file not owned by uid {uid}");
        return;
    }

    let Some(home) = dirs::home_dir() else {
        return;
    };
    let elevated_root = home.join(".config").join("flurer");
    let target_dir = elevated_root.join(env!("CARGO_PKG_VERSION"));
    // Defensive: if HOME did not resolve to a different profile (pkexec
    // normally sets it to /root), seeding would just rewrite the user's own
    // settings as root and cause the ownership problem this avoids.
    if source.parent() == Some(target_dir.as_path()) {
        log::info!("elevated: seed source is the active profile; not copying");
        return;
    }
    if let Err(e) = fs::create_dir_all(&target_dir) {
        log::warn!("elevated: could not create settings dir {}: {e}", target_dir.display());
        return;
    }
    let Ok(contents) = fs::read(&source) else {
        log::warn!("elevated: could not read seed settings {}", source.display());
        return;
    };
    if let Err(e) = atomic_write(&target_dir.join("settings.json"), &contents) {
        log::warn!("elevated: could not write seeded settings: {e}");
        return;
    }

    // The wallpaper cache lives one level above the versioned settings dir.
    if let Some(source_root) = source.parent().and_then(Path::parent) {
        for name in ["wallpaper.jpg", "wallpaper_meta.json"] {
            let from = source_root.join(name);
            if let Ok(contents) = fs::read(&from) {
                let _ = atomic_write(&elevated_root.join(name), &contents);
            }
        }
    }
    log::info!("elevated: seeded settings from {}", source.display());
}

#[cfg(not(target_os = "linux"))]
pub fn seed_elevated_settings_from_cli() {}

// Parses a "0.2.0"-style directory name into a comparable (major, minor,
// patch) tuple. Anything else (a stray non-version folder) yields None and
// is safely ignored by the caller rather than treated as a real version.
fn parse_version(name: &str) -> Option<(u64, u64, u64)> {
    let mut parts = name.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

// Finds the settings.json belonging to the highest version older than
// `current` — so the first launch after bumping e.g. 0.2.0 -> 0.3.0 carries
// forward the previous version's preferences instead of resetting to
// defaults, while a fresh/downgraded install with nothing older just falls
// through to None.
fn find_previous_settings(root: &Path, current_version: (u64, u64, u64)) -> Option<PathBuf> {
    let read_dir = fs::read_dir(root).ok()?;

    let mut best: Option<((u64, u64, u64), PathBuf)> = None;
    for entry in read_dir.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(version) = parse_version(&name) else {
            continue;
        };
        if version >= current_version {
            continue;
        }
        let candidate = entry.path().join("settings.json");
        if !candidate.is_file() {
            continue;
        }
        if best.as_ref().is_none_or(|(best_version, _)| version > *best_version) {
            best = Some((version, candidate));
        }
    }

    best.map(|(_, path)| path)
}

fn read_settings_file(path: &Path) -> Option<Settings> {
    let contents = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            // NotFound is the expected, silent case (first launch, or no
            // prior-version file to migrate from) — anything else (e.g.
            // permissions, a half-written file) is worth a trace since it
            // means we're silently falling back to default settings.
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("failed to read settings file {}: {e}", path.display());
            }
            return None;
        }
    };
    match serde_json::from_str(&contents) {
        Ok(settings) => Some(settings),
        Err(e) => {
            log::warn!("settings file {} is corrupt, falling back to defaults: {e}", path.display());
            None
        }
    }
}

pub fn load_settings(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else {
        return Settings::default();
    };

    if let Some(settings) = read_settings_file(&path) {
        return settings;
    }

    let Some(settings) = config_root()
        .ok()
        .and_then(|root| {
            let current = parse_version(&app.package_info().version.to_string())?;
            find_previous_settings(&root, current)
        })
        .and_then(|previous_path| read_settings_file(&previous_path))
    else {
        return Settings::default();
    };

    // Persist immediately so this version has its own copy going forward and
    // doesn't need to re-migrate on every launch.
    let _ = save_settings(app, &settings);
    settings
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let temp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&temp, data).map_err(|e| {
        log::error!("failed to write settings temp file {}: {e}", temp.display());
        e.to_string()
    })?;
    fs::rename(&temp, &path).map_err(|e| {
        log::error!("failed to commit settings file {}: {e}", path.display());
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings.lock().await.clone())
}

#[tauri::command]
pub async fn set_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<(), String> {
    save_settings(&app, &settings)?;
    let mut guard = state.settings.lock().await;
    // This command fires on every settings save (debounced from the
    // frontend), not just ones that touch the shortcut — reregister() is a
    // no-op when the value didn't actually change, so this doesn't
    // unregister/register on every unrelated setting tweak.
    crate::shortcuts::reregister(&app, &guard.global_shortcut, &settings.global_shortcut);
    crate::tray::resync_autostart_if_changed(
        &app,
        guard.launch_at_startup,
        settings.launch_at_startup,
        guard.launch_as_admin,
        settings.launch_as_admin,
    );
    if guard.live_folder_size_updates != settings.live_folder_size_updates {
        crate::sizecache::invalidate_incremental_tracking(&state);
    }
    // Atomics only — no-op when nothing the sampler cares about changed.
    if guard.top_bar_metrics != settings.top_bar_metrics {
        crate::metrics::configure(&settings.top_bar_metrics);
    }
    *guard = settings;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parse_version_reads_major_minor_patch() {
        assert_eq!(parse_version("0.2.0"), Some((0, 2, 0)));
        assert_eq!(parse_version("12.34.56"), Some((12, 34, 56)));
    }

    #[test]
    fn parse_version_rejects_malformed_names() {
        assert_eq!(parse_version("not-a-version"), None);
        assert_eq!(parse_version("0.2"), None);
        assert_eq!(parse_version("0.2.0.1"), None);
    }

    #[test]
    fn find_previous_settings_picks_highest_older_version() {
        let root = tempdir().unwrap();
        for version in ["0.1.0", "0.2.0", "0.3.0"] {
            let dir = root.path().join(version);
            fs::create_dir(&dir).unwrap();
            fs::write(dir.join("settings.json"), "{}").unwrap();
        }
        // A version bump with no settings.json yet shouldn't be picked either.
        fs::create_dir(root.path().join("0.4.0")).unwrap();

        let found = find_previous_settings(root.path(), (0, 4, 0)).unwrap();
        assert_eq!(found, root.path().join("0.3.0").join("settings.json"));
    }

    #[test]
    fn find_previous_settings_ignores_versions_at_or_above_current() {
        let root = tempdir().unwrap();
        for version in ["0.3.0", "0.4.0"] {
            let dir = root.path().join(version);
            fs::create_dir(&dir).unwrap();
            fs::write(dir.join("settings.json"), "{}").unwrap();
        }

        assert!(find_previous_settings(root.path(), (0, 3, 0)).is_none());
    }

    #[test]
    fn find_previous_settings_returns_none_with_no_older_versions() {
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("0.1.0")).unwrap();

        assert!(find_previous_settings(root.path(), (0, 1, 0)).is_none());
    }
}
