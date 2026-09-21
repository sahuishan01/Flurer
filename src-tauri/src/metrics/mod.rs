//! Top-bar system-metrics sampler. One background thread samples CPU
//! (per-core), memory/swap, drives, and network interfaces via `sysinfo`,
//! plus GPU utilization/VRAM via D3DKMT on Windows (see gpu.rs), and emits a
//! single `system-metrics` event per tick. The frontend's MetricsBar widgets
//! filter this stream down to whatever devices the user pinned in Settings.
//!
//! The thread always runs (same idiom as sizecache's autosave) but exits the
//! cheap path immediately when the feature is off: no sysinfo refresh, no
//! event. `configure()` is called from `set_settings` on every settings save,
//! so the enabled flag and interval are read through atomics each tick.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::state::TopBarMetrics;

#[cfg(windows)]
pub mod gpu;
// Non-Windows targets get an empty GPU surface: no adapters, no utilization,
// so the sampler and SystemMetrics keep the same shape everywhere.
#[cfg(not(windows))]
pub mod gpu {
    use serde::Serialize;

    use std::collections::HashMap;
    use std::time::Instant;

    pub type GpuState = HashMap<u32, i64>;

    #[derive(Debug, Clone)]
    pub struct GpuDevice {
        pub id: String,
        pub name: String,
        pub mem_total: u64,
    }

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GpuSample {
        pub id: String,
        pub name: String,
        pub usage_percent: Option<f32>,
        pub mem_total: u64,
        pub mem_used: u64,
    }

    pub fn enumerate() -> Vec<GpuDevice> {
        Vec::new()
    }

    pub fn sample(device: &GpuDevice, _state: &mut GpuState, _wall_100ns: u64) -> GpuSample {
        GpuSample {
            id: device.id.clone(),
            name: device.name.clone(),
            usage_percent: None,
            mem_total: device.mem_total,
            mem_used: 0,
        }
    }

    pub struct SampleClock {
        last: Option<Instant>,
    }

    impl SampleClock {
        pub fn new() -> Self {
            Self { last: None }
        }

        pub fn tick(&mut self) -> u64 {
            let now = Instant::now();
            let delta = match self.last {
                Some(last) => now.duration_since(last).as_nanos() as u64 / 100,
                None => 0,
            };
            self.last = Some(now);
            delta
        }
    }
}

const MIN_INTERVAL_MS: u64 = 1000;

static ENABLED: AtomicBool = AtomicBool::new(false);
static INTERVAL_MS: AtomicU64 = AtomicU64::new(2000);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuSample {
    pub name: String,
    pub usage: f32,
    pub frequency_mhz: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySample {
    pub total: u64,
    pub used: u64,
    pub swap_total: u64,
    pub swap_used: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveSample {
    /// Mount point — stable per-drive id used by the settings checkboxes.
    pub id: String,
    pub label: String,
    pub total: u64,
    pub free: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSample {
    pub id: String,
    pub name: String,
    pub rx_bps: u64,
    pub tx_bps: u64,
    pub rx_total: u64,
    pub tx_total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpus: Vec<CpuSample>,
    pub cpu_overall: f32,
    pub memory: MemorySample,
    pub gpus: Vec<gpu::GpuSample>,
    pub drives: Vec<DriveSample>,
    pub networks: Vec<NetworkSample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInventory {
    pub drives: Vec<DriveSample>,
    pub networks: Vec<NetworkSample>,
    pub gpus: Vec<GpuDeviceInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuDeviceInfo {
    pub id: String,
    pub name: String,
    pub mem_total: u64,
}

/// Called once from lib.rs setup — spawns the sampler thread.
pub fn init(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || sampler(app));
}

/// Mirrors the user's top_bar_metrics setting into the sampler's atomics.
/// Cheap enough to call on every set_settings save.
pub fn configure(settings: &TopBarMetrics) {
    ENABLED.store(settings.enabled, Ordering::Relaxed);
    INTERVAL_MS.store((settings.interval_seconds.max(1) as u64).saturating_mul(1000), Ordering::Relaxed);
}

fn sampler(app: AppHandle) {
    let mut sys = sysinfo::System::new();
    let mut networks = sysinfo::Networks::new();
    let mut disks = sysinfo::Disks::new();
    let mut gpu_devices = gpu::enumerate();
    // (adapter id → per-node RunningTime from the previous tick)
    let mut gpu_states: Vec<(String, std::collections::HashMap<u32, i64>)> =
        gpu_devices.iter().map(|d| (d.id.clone(), std::collections::HashMap::new())).collect();
    let mut clock = gpu::SampleClock::new();
    let mut networks_seeded = false;

    loop {
        let interval = INTERVAL_MS.load(Ordering::Relaxed);
        let enabled = ENABLED.load(Ordering::Relaxed);
        // Sleep first: a toggle-off must not leave a stale sample behind, and
        // the first tick after enabling comes one interval later — fine for a
        // live widget.
        thread::sleep(Duration::from_millis(interval.max(MIN_INTERVAL_MS)));
        if !enabled {
            continue;
        }

        sys.refresh_cpu_usage();
        sys.refresh_memory();
        if networks_seeded {
            networks.refresh(true);
        } else {
            // First refresh only establishes the baseline counters — rates
            // would otherwise be computed since process start and show a
            // huge one-shot spike.
            networks.refresh(true);
            networks_seeded = true;
            continue;
        }
        disks.refresh(true);

        let cpus: Vec<CpuSample> = sys
            .cpus()
            .iter()
            .map(|cpu| CpuSample {
                name: cpu.name().to_string(),
                usage: cpu.cpu_usage(),
                frequency_mhz: cpu.frequency(),
            })
            .collect();
        let cpu_overall = sys.global_cpu_usage();

        let gpus = if gpu_devices.is_empty() {
            // Re-enumerate occasionally? Not worth it: adapters rarely appear
            // at runtime, and the settings panel can trigger a fresh listing
            // via get_metric_devices. Keep the tick allocation-free.
            Vec::new()
        } else {
            let wall_100ns = clock.tick();
            let mut samples = Vec::with_capacity(gpu_devices.len());
            for (index, device) in gpu_devices.iter().enumerate() {
                let state = &mut gpu_states[index].1;
                samples.push(gpu::sample(device, state, wall_100ns));
            }
            samples
        };

        let drives: Vec<DriveSample> = disks
            .list()
            .iter()
            .map(|disk| {
                let mount = disk.mount_point().to_string_lossy().into_owned();
                DriveSample {
                    id: mount.clone(),
                    label: disk.name().to_string_lossy().into_owned(),
                    total: disk.total_space(),
                    free: disk.available_space(),
                }
            })
            .collect();

        let nets: Vec<NetworkSample> = networks
            .iter()
            .map(|(name, data)| NetworkSample {
                id: name.clone(),
                name: name.clone(),
                rx_bps: data.received(),
                tx_bps: data.transmitted(),
                rx_total: data.total_received(),
                tx_total: data.total_transmitted(),
            })
            .collect();

        let payload = SystemMetrics {
            cpus,
            cpu_overall,
            memory: MemorySample {
                total: sys.total_memory(),
                used: sys.used_memory(),
                swap_total: sys.total_swap(),
                swap_used: sys.used_swap(),
            },
            gpus,
            drives,
            networks: nets,
        };
        if let Err(e) = app.emit("system-metrics", &payload) {
            log::warn!("failed to emit system-metrics: {e}");
        }
    }
}

/// Device listing for the Settings UI: what can be checked into
/// top_bar_metrics.items. CPU and memory are singletons and not listed.
#[tauri::command]
pub fn get_metric_devices() -> DeviceInventory {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let drives: Vec<DriveSample> = disks
        .list()
        .iter()
        .map(|disk| {
            let mount = disk.mount_point().to_string_lossy().into_owned();
            DriveSample {
                id: mount.clone(),
                label: disk.name().to_string_lossy().into_owned(),
                total: disk.total_space(),
                free: disk.available_space(),
            }
        })
        .collect();
    let networks: Vec<NetworkSample> = sysinfo::Networks::new_with_refreshed_list()
        .iter()
        .map(|(name, data)| NetworkSample {
            id: name.clone(),
            name: name.clone(),
            rx_bps: data.received(),
            tx_bps: data.transmitted(),
            rx_total: data.total_received(),
            tx_total: data.total_transmitted(),
        })
        .collect();
    let gpus: Vec<GpuDeviceInfo> = gpu::enumerate()
        .into_iter()
        .map(|d| GpuDeviceInfo { id: d.id, name: d.name, mem_total: d.mem_total })
        .collect();
    DeviceInventory { drives, networks, gpus }
}
