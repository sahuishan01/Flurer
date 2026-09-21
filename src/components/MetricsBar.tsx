// Top-bar system-metrics widgets (see src-tauri/src/metrics). The Rust side
// samples once per interval and emits one `system-metrics` event; this
// component renders one compact widget per user-pinned device (Settings →
// Top bar metrics) and opens a detailed hover panel for the hardware under
// the cursor. Hover interaction reuses createPopover for the same
// viewport-clamping/outside-click mechanics as the search popover, but is
// triggered by pointerenter instead of click; clicking a widget pins its
// panel so it survives pointer-out.
import { createSignal, onCleanup, onMount, For, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { createPopover } from "../lib/popover";
import type { MetricItem, MetricKind } from "../lib/settings";

type SystemMetrics = {
  cpus: { name: string; usage: number; frequencyMhz: number }[];
  cpuOverall: number;
  memory: { total: number; used: number; swapTotal: number; swapUsed: number };
  gpus: { id: string; name: string; usagePercent: number | null; memTotal: number; memUsed: number }[];
  drives: { id: string; label: string; total: number; free: number }[];
  networks: { id: string; name: string; rxBps: number; txBps: number; rxTotal: number; txTotal: number }[];
};

type DeviceInventory = {
  drives: { id: string; label: string }[];
  networks: { id: string; name: string }[];
  gpus: { id: string; name: string; memTotal: number }[];
};

const HOVER_OPEN_DELAY_MS = 250;
const HOVER_CLOSE_DELAY_MS = 180;

function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${units[unit]}`;
}

function formatRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  return `${formatBytes(bps)}/s`;
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

// "C:\" → "C:", "/home/user" → "…/user" — the compact drive label.
function shortDriveId(mountPoint: string): string {
  const trimmed = mountPoint.replace(/[\\/]+$/, "");
  const last = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return /^[A-Za-z]:$/.test(last) ? last : last || mountPoint;
}

type MetricsBarProps = {
  items: MetricItem[];
};

export function MetricsBar(props: MetricsBarProps) {
  const [latest, setLatest] = createSignal<SystemMetrics | null>(null);
  const [devices, setDevices] = createSignal<DeviceInventory | null>(null);
  const [hoverId, setHoverId] = createSignal<string | null>(null);
  const [pinnedId, setPinnedId] = createSignal<string | null>(null);
  const { open, pos, containerRef, panelRef, openAt, close } = createPopover();

  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<SystemMetrics>("system-metrics", (event) => setLatest(event.payload)).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    onCleanup(() => {
      disposed = true;
      unlisten?.();
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
    });
  });

  // Device inventory feeds the hover panels' labels even before the first
  // sample lands (GPU/adapter names especially). Cheap enough to just fetch
  // on mount; only present while the bar is rendered at all.
  onMount(() => {
    invoke<DeviceInventory>("get_metric_devices")
      .then(setDevices)
      .catch((err) => console.error("get_metric_devices failed", err));
  });

  const activeId = () => pinnedId() ?? (open() ? hoverId() : null);

  function enterWidget(item: MetricItem, el: HTMLElement) {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    if (pinnedId()) return; // a pinned panel stays put until unpinned
    openTimer = setTimeout(() => {
      setHoverId(itemKey(item));
      openAt(el);
    }, HOVER_OPEN_DELAY_MS);
  }

  function leaveWidget() {
    clearTimeout(openTimer);
    if (pinnedId()) return;
    closeTimer = setTimeout(() => {
      close();
      setHoverId(null);
    }, HOVER_CLOSE_DELAY_MS);
  }

  function clickWidget(item: MetricItem, el: HTMLElement) {
    const key = itemKey(item);
    if (pinnedId() === key) {
      setPinnedId(null);
      close();
      setHoverId(null);
      return;
    }
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    setPinnedId(key);
    setHoverId(key);
    openAt(el);
  }

  function itemKey(item: MetricItem): string {
    return `${item.kind}:${item.id}`;
  }

  // Detail for the widget currently open (pinned one wins).
  const activeItem = () => props.items.find((item) => itemKey(item) === activeId()) ?? null;

  function gpuIndex(id: string): string {
    return id.toUpperCase();
  }

  function gpuSample(id: string) {
    return latest()?.gpus.find((g) => g.id === id) ?? null;
  }

  function driveSample(id: string) {
    return latest()?.drives.find((d) => d.id === id) ?? null;
  }

  function networkSample(id: string) {
    return latest()?.networks.find((n) => n.id === id) ?? null;
  }

  function deviceName(kind: MetricKind, id: string): string {
    if (kind === "cpu") return "Processor";
    if (kind === "memory") return "Memory";
    if (kind === "gpu") return devices()?.gpus.find((g) => g.id === id)?.name ?? gpuSample(id)?.name ?? id;
    if (kind === "drive") return devices()?.drives.find((d) => d.id === id)?.label ?? id;
    return devices()?.networks.find((n) => n.id === id)?.name ?? id;
  }

  function widgetLabel(item: MetricItem): string {
    switch (item.kind) {
      case "cpu":
        return "CPU";
      case "memory":
        return "MEM";
      case "gpu":
        return gpuIndex(item.id);
      case "drive":
        return shortDriveId(item.id);
      case "network":
        return networkSample(item.id)?.name ?? item.id;
    }
  }

  function widgetValue(item: MetricItem): string | null {
    const metrics = latest();
    if (!metrics) return null;
    switch (item.kind) {
      case "cpu":
        return percent(metrics.cpuOverall);
      case "memory":
        return metrics.memory.total > 0
          ? `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total, 0)}`
          : null;
      case "gpu": {
        const gpu = gpuSample(item.id);
        if (!gpu) return null;
        return gpu.usagePercent === null ? "N/A" : percent(gpu.usagePercent);
      }
      case "drive": {
        const drive = driveSample(item.id);
        if (!drive || drive.total === 0) return null;
        return percent(((drive.total - drive.free) / drive.total) * 100);
      }
      case "network":
        return null; // rendered as up/down rates instead of a single value
    }
  }

  return (
    <Show when={props.items.length > 0}>
      <div class="metrics-bar" ref={containerRef}>
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              class="metric-widget"
              classList={{ active: activeId() === itemKey(item) }}
              aria-label={`${deviceName(item.kind, item.id)} usage`}
              onPointerEnter={(e) => enterWidget(item, e.currentTarget)}
              onPointerLeave={() => leaveWidget()}
              onClick={(e) => clickWidget(item, e.currentTarget)}
            >
              <span class="metric-widget-label">{widgetLabel(item)}</span>
              <Show
                when={item.kind !== "network"}
                fallback={
                  <span class="metric-widget-value metric-widget-rates">
                    <Show when={networkSample(item.id)} keyed fallback={<span class="metric-na">—</span>}>
                      {(net) => (
                        <>
                          <span class="rate-down">↓ {formatRate(net.rxBps)}</span>
                          <span class="rate-up">↑ {formatRate(net.txBps)}</span>
                        </>
                      )}
                    </Show>
                  </span>
                }
              >
                <span class="metric-widget-value">
                  {widgetValue(item) ?? <span class="metric-na">—</span>}
                </span>
              </Show>
            </button>
          )}
        </For>

        <Show when={open() && activeItem()} keyed>
          {(item) => (
            <div
              class="metric-detail-panel"
              style={pos()}
              ref={panelRef}
              onPointerEnter={() => clearTimeout(closeTimer)}
              onPointerLeave={() => (pinnedId() ? undefined : leaveWidget())}
            >
              <div class="metric-detail-title">{deviceName(item.kind, item.id)}</div>
              {(() => {
                const metrics = latest();
                if (!metrics) {
                  return <div class="metric-detail-empty">Waiting for first sample…</div>;
                }
                switch (item.kind) {
                  case "cpu":
                    return (
                      <>
                        <MetricRow label="Overall" value={percent(metrics.cpuOverall)} fill={metrics.cpuOverall} />
                        <For each={metrics.cpus}>
                          {(cpu) => <MetricRow label={cpu.name} value={percent(cpu.usage)} fill={cpu.usage} sub={`${cpu.frequencyMhz} MHz`} />}
                        </For>
                      </>
                    );
                  case "memory": {
                    const mem = metrics.memory;
                    return (
                      <>
                        <MetricRow
                          label="RAM"
                          value={`${formatBytes(mem.used)} / ${formatBytes(mem.total)}`}
                          fill={mem.total > 0 ? (mem.used / mem.total) * 100 : 0}
                        />
                        <MetricRow
                          label="Free"
                          value={formatBytes(Math.max(0, mem.total - mem.used))}
                          fill={0}
                        />
                        <Show when={mem.swapTotal > 0}>
                          <MetricRow
                            label="Swap"
                            value={`${formatBytes(mem.swapUsed)} / ${formatBytes(mem.swapTotal)}`}
                            fill={(mem.swapUsed / mem.swapTotal) * 100}
                          />
                        </Show>
                      </>
                    );
                  }
                  case "gpu": {
                    const gpu = gpuSample(item.id);
                    if (!gpu) return <div class="metric-detail-empty">GPU not reporting.</div>;
                    return (
                      <>
                        <MetricRow
                          label="Utilization"
                          value={gpu.usagePercent === null ? "N/A" : percent(gpu.usagePercent)}
                          fill={gpu.usagePercent ?? 0}
                        />
                        <MetricRow
                          label="VRAM"
                          value={`${formatBytes(gpu.memUsed)} / ${formatBytes(gpu.memTotal)}`}
                          fill={gpu.memTotal > 0 ? (gpu.memUsed / gpu.memTotal) * 100 : 0}
                        />
                      </>
                    );
                  }
                  case "drive": {
                    const drive = driveSample(item.id);
                    if (!drive) return <div class="metric-detail-empty">Drive not present.</div>;
                    const used = Math.max(0, drive.total - drive.free);
                    return (
                      <>
                        <MetricRow
                          label="Used"
                          value={`${formatBytes(used)} / ${formatBytes(drive.total)}`}
                          fill={drive.total > 0 ? (used / drive.total) * 100 : 0}
                        />
                        <MetricRow label="Free" value={formatBytes(drive.free)} fill={0} />
                        <div class="metric-detail-sub">Mount point: {drive.id}</div>
                      </>
                    );
                  }
                  case "network": {
                    const net = networkSample(item.id);
                    if (!net) return <div class="metric-detail-empty">Interface not present.</div>;
                    return (
                      <>
                        <MetricRow label="Download" value={formatRate(net.rxBps)} fill={0} />
                        <MetricRow label="Upload" value={formatRate(net.txBps)} fill={0} />
                        <MetricRow label="Total down" value={formatBytes(net.rxTotal)} fill={0} />
                        <MetricRow label="Total up" value={formatBytes(net.txTotal)} fill={0} />
                      </>
                    );
                  }
                }
              })()}
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}

function MetricRow(props: { label: string; value: string; fill: number; sub?: string }) {
  return (
    <div class="metric-detail-row">
      <div class="metric-detail-row-head">
        <span class="metric-detail-label">{props.label}</span>
        <span class="metric-detail-value">
          {props.value}
          <Show when={props.sub}>
            {" "}
            <span class="metric-detail-sub">({props.sub})</span>
          </Show>
        </span>
      </div>
      <div class="metric-detail-bar">
        <div class="metric-detail-bar-fill" style={{ width: `${Math.max(0, Math.min(100, props.fill))}%` }} />
      </div>
    </div>
  );
}
