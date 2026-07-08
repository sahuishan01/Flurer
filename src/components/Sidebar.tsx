import { createSignal, For, onMount, type JSX } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { DownloadIcon, FileIcon, FilmIcon, FolderIcon, GearIcon, GraphIcon, ImageIcon, MonitorIcon, MusicIcon, VolumeIcon } from "./icons";
import type { MainView } from "../lib/view";
import type { PhysicalDisk, VirtualDisk } from "../lib/graph";
import { formatBytes } from "../lib/fs";

type QuickAccessEntry = {
  label: string;
  path: string;
};

function driveLabel(volume: VirtualDisk): string {
  return volume.volumeName ? `${volume.driveLetter} (${volume.volumeName})` : volume.driveLetter;
}

function usedPercent(volume: VirtualDisk): number {
  if (volume.totalSpace <= 0) return 0;
  return Math.min(100, Math.round(((volume.totalSpace - volume.freeSpace) / volume.totalSpace) * 100));
}

const ICONS: Record<string, () => JSX.Element> = {
  Desktop: () => <MonitorIcon size={15} />,
  Documents: () => <FileIcon size={15} />,
  Downloads: () => <DownloadIcon size={15} />,
  Pictures: () => <ImageIcon size={15} />,
  Music: () => <MusicIcon size={15} />,
  Videos: () => <FilmIcon size={15} />,
};

type SidebarProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
  activeView: MainView;
  onSelectView: (view: MainView) => void;
};

export function Sidebar(props: SidebarProps) {
  const [entries, setEntries] = createSignal<QuickAccessEntry[]>([]);
  const [drives, setDrives] = createSignal<VirtualDisk[]>([]);

  onMount(async () => {
    try {
      const result = await invoke<QuickAccessEntry[]>("get_quick_access");
      setEntries(result);
    } catch (err) {
      console.error("Failed to load quick access entries", err);
    }
  });

  onMount(async () => {
    try {
      const disks = await invoke<PhysicalDisk[]>("get_disk_topology");
      setDrives(disks.flatMap((disk) => disk.volumes));
    } catch (err) {
      console.error("Failed to load drives", err);
    }
  });

  return (
    <nav class="sidebar">
      <div class="sidebar-top">
        <button
          type="button"
          class="sidebar-item"
          classList={{ active: props.activeView === "graph" }}
          onClick={() => props.onSelectView(props.activeView === "graph" ? "explorer" : "graph")}
        >
          <span class="sidebar-icon">
            <GraphIcon size={16} />
          </span>
          Graph
        </button>

        <div class="sidebar-divider" />

        <span class="sidebar-section-label">Drives</span>
        <For each={drives()}>
          {(volume) => (
            <div
              class="sidebar-drive"
              classList={{
                active: props.activeView === "explorer" && props.currentPath === `${volume.driveLetter}\\`,
              }}
            >
              <button
                type="button"
                class="sidebar-item"
                classList={{
                  active: props.activeView === "explorer" && props.currentPath === `${volume.driveLetter}\\`,
                }}
                onClick={() => props.onNavigate(`${volume.driveLetter}\\`)}
              >
                <span class="sidebar-icon">
                  <VolumeIcon size={15} />
                </span>
                {driveLabel(volume)}
              </button>
              <div class="sidebar-drive-usage">
                <div class="sidebar-drive-usage-bar">
                  <div
                    class="sidebar-drive-usage-fill"
                    classList={{ low: usedPercent(volume) >= 90 }}
                    style={{ width: `${usedPercent(volume)}%` }}
                  />
                </div>
                <span class="sidebar-drive-usage-text">
                  {formatBytes(volume.freeSpace)} free of {formatBytes(volume.totalSpace)}
                </span>
              </div>
            </div>
          )}
        </For>

        <div class="sidebar-divider" />

        <For each={entries()}>
          {(entry) => (
            <button
              type="button"
              class="sidebar-item"
              classList={{ active: props.activeView === "explorer" && props.currentPath === entry.path }}
              onClick={() => props.onNavigate(entry.path)}
            >
              <span class="sidebar-icon">{ICONS[entry.label]?.() ?? <FolderIcon size={15} />}</span>
              {entry.label}
            </button>
          )}
        </For>
      </div>

      <div class="sidebar-bottom">
        <button
          type="button"
          class="sidebar-item"
          classList={{ active: props.activeView === "settings" }}
          onClick={() => props.onSelectView("settings")}
        >
          <span class="sidebar-icon">
            <GearIcon size={16} />
          </span>
          Settings
        </button>
      </div>
    </nav>
  );
}
