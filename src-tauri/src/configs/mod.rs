use std::env;

use keyring::Entry;

const KEYRING_SERVICE: &str = "flurer";
const UNSPLASH_KEYRING_ACCOUNT: &str = "unsplash_client_id";

#[derive(Debug, Clone)]
pub struct Config {
    // Dev-only fallback read from a local .env file (via `bun run tauri dev`,
    // which runs from the project root). Real installs have no such file —
    // production users configure the key from Settings instead, which is
    // stored via the OS credential store (see get/set_unsplash_api_key
    // below), not this struct.
    pub unsplash_client_id_fallback: Option<String>,
}

impl Config {
    pub fn load() -> Self {
        dotenv::dotenv().ok();
        Self {
            unsplash_client_id_fallback: env::var("UNSPLASH_CLIENT_ID").ok(),
        }
    }
}

fn unsplash_keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, UNSPLASH_KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

// The OS credential store (Windows Credential Manager) is user- and
// machine-scoped, not tied to this app's version, so a key entered once via
// Settings survives every future version upgrade without needing the
// version-migration logic that the rest of Settings relies on — and unlike
// a plain settings.json field, the OS encrypts it at rest.
fn get_unsplash_api_key() -> Option<String> {
    unsplash_keyring_entry().ok()?.get_password().ok()
}

// Prefers the securely-stored, user-entered key; falls back to the dev .env
// value only when no key has been configured via Settings at all.
pub fn resolve_unsplash_api_key(config: &Config) -> Option<String> {
    get_unsplash_api_key().or_else(|| config.unsplash_client_id_fallback.clone())
}

#[tauri::command]
pub fn has_unsplash_api_key(state: tauri::State<'_, crate::state::AppState>) -> bool {
    resolve_unsplash_api_key(&state.config).is_some()
}

#[tauri::command]
pub fn set_unsplash_api_key(key: String) -> Result<(), String> {
    let entry = unsplash_keyring_entry()?;
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return match entry.delete_credential() {
            Ok(()) => Ok(()),
            // Already absent is not a failure — clearing an unset key is a no-op.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(trimmed).map_err(|e| e.to_string())
}
