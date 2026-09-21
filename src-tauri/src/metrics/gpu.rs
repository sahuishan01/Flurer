//! GPU metrics for the top-bar system-metrics widgets. Adapter enumeration
//! (name, LUID, dedicated VRAM) comes from DXGI; utilization and VRAM-in-use
//! come from `D3DKMTQueryStatistics` — the same WDDM statistics source Task
//! Manager's GPU tab uses, so it works for every vendor (NVIDIA/AMD/Intel),
//! not just NVML-capable ones. Windows-only: on other targets `enumerate()`
//! returns an empty list and the metrics bar simply has no GPU devices.
//!
//! D3DKMT lives under `Windows::Wdk::Graphics::Direct3D` in windows-rs (it is
//! the low-level WDDK surface, not part of Win32::Graphics), which is why the
//! Wdk features are enabled in Cargo.toml.

#![cfg(windows)]

use std::collections::HashMap;
use std::time::Instant;

use windows::Wdk::Graphics::Direct3D::{
    D3DKMTCloseAdapter, D3DKMTOpenAdapterFromLuid, D3DKMTQueryStatistics, D3DKMT_CLOSEADAPTER,
    D3DKMT_OPENADAPTERFROMLUID, D3DKMT_QUERYSTATISTICS, D3DKMT_QUERYSTATISTICS_ADAPTER,
    D3DKMT_QUERYSTATISTICS_NODE, D3DKMT_QUERYSTATISTICS_QUERY_NODE, D3DKMT_QUERYSTATISTICS_QUERY_SEGMENT,
    D3DKMT_QUERYSTATISTICS_SEGMENT,
};
use windows::Win32::Foundation::LUID;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_DESC1, DXGI_ADAPTER_FLAG_SOFTWARE,
};

/// One physical adapter as discovered at startup (name + LUID + total VRAM).
pub struct GpuDevice {
    pub id: String,
    pub name: String,
    pub luid: LUID,
    pub mem_total: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSample {
    pub id: String,
    pub name: String,
    /// Busiest-engine utilization percent, `None` when the kernel query
    /// failed (e.g. vendor WDDM driver without node statistics).
    pub usage_percent: Option<f32>,
    pub mem_total: u64,
    pub mem_used: u64,
}

/// Per-adapter state the sampler keeps between ticks: the last
/// system-wide RunningTime per node, so utilization can be computed as a
/// delta. Keyed by node id.
pub type GpuState = HashMap<u32, i64>;

pub fn enumerate() -> Vec<GpuDevice> {
    let factory = match unsafe { CreateDXGIFactory1::<IDXGIFactory1>() } {
        Ok(f) => f,
        Err(e) => {
            log::warn!("GPU metrics: CreateDXGIFactory1 failed: {e}");
            return Vec::new();
        }
    };
    let mut devices = Vec::new();
    for index in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
            continue; // WARP / Basic Render — not real hardware
        }
        devices.push(GpuDevice {
            id: format!("gpu{index}"),
            name: luid_name(&desc),
            luid: desc.AdapterLuid,
            mem_total: desc.DedicatedVideoMemory as u64,
        });
    }
    devices
}

fn luid_name(desc: &DXGI_ADAPTER_DESC1) -> String {
    let len = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
    String::from_utf16_lossy(&desc.Description[..len])
}

/// Samples one adapter. `state` carries the previous tick's node RunningTimes;
/// `wall_100ns` is the wall-clock delta since the previous sample in 100 ns
/// units (RunningTime shares that unit, so utilization = running/wall).
pub fn sample(device: &GpuDevice, state: &mut GpuState, wall_100ns: u64) -> GpuSample {
    let mut sample = GpuSample {
        id: device.id.clone(),
        name: device.name.clone(),
        usage_percent: None,
        mem_total: device.mem_total,
        mem_used: 0,
    };

    // Safety: every D3DKMT call below takes a zeroed-default struct with the
    // interesting fields set; failures fall through to usage_percent: None /
    // mem_used: 0 rather than propagating — a metrics widget must never be
    // able to take the sampler down.
    unsafe {
        let mut open = D3DKMT_OPENADAPTERFROMLUID::default();
        open.AdapterLuid = device.luid;
        if D3DKMTOpenAdapterFromLuid(&mut open).0 < 0 {
            return sample;
        }
        let luid = open.AdapterLuid;
        let h_adapter = open.hAdapter;

        // Node count + segment count, then per-node RunningTime and
        // per-segment BytesResident on non-aperture (dedicated VRAM) segments.
        let mut query = D3DKMT_QUERYSTATISTICS::default();
        query.Type = D3DKMT_QUERYSTATISTICS_ADAPTER;
        query.AdapterLuid = luid;
        let (node_count, segment_count) = if D3DKMTQueryStatistics(&query).0 >= 0 {
            let info = &query.QueryResult.AdapterInformation;
            (info.NodeCount, info.NbSegments)
        } else {
            (0, 0)
        };

        let mut max_fraction: f32 = 0.0;
        for node in 0..node_count {
            let mut query = D3DKMT_QUERYSTATISTICS::default();
            query.Type = D3DKMT_QUERYSTATISTICS_NODE;
            query.AdapterLuid = luid;
            query.Anonymous.QueryNode = D3DKMT_QUERYSTATISTICS_QUERY_NODE { NodeId: node };
            if D3DKMTQueryStatistics(&query).0 < 0 {
                continue;
            }
            let running = query.QueryResult.NodeInformation.SystemInformation.RunningTime;
            if let Some(previous) = state.get(&node) {
                let delta = (running - *previous).max(0) as u64 as f32;
                if wall_100ns > 0 {
                    max_fraction = max_fraction.max((delta / wall_100ns as f32).min(1.0));
                }
            }
            state.insert(node, running);
        }
        if !state.is_empty() {
            sample.usage_percent = Some(max_fraction * 100.0);
        }

        for segment in 0..segment_count {
            let mut query = D3DKMT_QUERYSTATISTICS::default();
            query.Type = D3DKMT_QUERYSTATISTICS_SEGMENT;
            query.AdapterLuid = luid;
            query.Anonymous.QuerySegment = D3DKMT_QUERYSTATISTICS_QUERY_SEGMENT { SegmentId: segment };
            if D3DKMTQueryStatistics(&query).0 < 0 {
                continue;
            }
            let info = &query.QueryResult.SegmentInformation;
            if info.Aperture == 0 {
                sample.mem_used += info.BytesResident;
            }
        }

        let mut close = D3DKMT_CLOSEADAPTER::default();
        close.hAdapter = h_adapter;
        let _ = D3DKMTCloseAdapter(&close);
    }

    sample
}

/// Shared per-tick wall clock so every adapter's delta uses the same base.
pub struct SampleClock {
    last: Option<Instant>,
}

impl SampleClock {
    pub fn new() -> Self {
        Self { last: None }
    }

    /// Returns the wall delta since the previous call, in 100 ns units
    /// (RunningTime's unit), falling back to a sentinel for the first call —
    /// the first tick can't produce a utilization delta.
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
