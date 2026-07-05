use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::configs::Config;

#[derive(Serialize, Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub wallpaper: Option<PathBuf>,
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config: Config,
}
