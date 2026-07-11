import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  FilmIcon,
  FolderIcon,
  ImageIcon,
  MonitorIcon,
  MusicIcon,
  StarIcon,
  VolumeIcon,
} from "./icons";
import type { MainView } from "../lib/view";
import type { PhysicalDisk, VirtualDisk } from "../lib/graph";
import { baseName, formatBytes } from "../lib/fs";

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
  // Every clickable place in the sidebar (drives, recents, favourites, quick
  // access) goes through this one callback rather than a plain "navigate to
  // Explorer" — while already in graph mode it focuses that path there
  // instead of switching away; see App.tsx's selectSidebarPath.
  onSelectPath: (path: string) => void;
  activeView: MainView;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
  recentPaths: string[];
  onRemoveRecent: (path: string) => void;
};

type SidebarEntryProps = {
  path: string;
  icon: JSX.Element;
  active: boolean;
  onNavigate: (path: string) => void;
  onRemove: () => void;
  removeLabel: string;
};

function SidebarEntry(props: SidebarEntryProps) {
  return (
    <div class="sidebar-entry">
      <button
        type="button"
        class="sidebar-item"
        classList={{ active: props.active }}
        title={props.path}
        onClick={() => props.onNavigate(props.path)}
      >
        <span class="sidebar-icon">{props.icon}</span>
        <span class="sidebar-entry-label">{baseName(props.path)}</span>
      </button>
      <button
        type="button"
        class="sidebar-entry-remove"
        title={props.removeLabel}
        aria-label={props.removeLabel}
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}

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
              onClick={() => props.onSelectPath(`${volume.driveLetter}\\`)}
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

      <Show when={props.recentPaths.length > 0}>
        <span class="sidebar-section-label">Recents</span>
        <For each={props.recentPaths}>
          {(path) => (
            <SidebarEntry
              path={path}
              icon={<ClockIcon size={15} />}
              active={props.activeView === "explorer" && props.currentPath === path}
              onNavigate={props.onSelectPath}
              onRemove={() => props.onRemoveRecent(path)}
              removeLabel="Remove from Recents"
            />
          )}
        </For>
        <div class="sidebar-divider" />
      </Show>

      <Show when={props.favouritePaths.length > 0}>
        <span class="sidebar-section-label">Favourites</span>
        <For each={props.favouritePaths}>
          {(path) => (
            <SidebarEntry
              path={path}
              icon={<StarIcon size={15} filled />}
              active={props.activeView === "explorer" && props.currentPath === path}
              onNavigate={props.onSelectPath}
              onRemove={() => props.onToggleFavourite(path)}
              removeLabel="Remove from Favourites"
            />
          )}
        </For>
        <div class="sidebar-divider" />
      </Show>

      <For each={entries()}>
        {(entry) => (
          <button
            type="button"
            class="sidebar-item"
            classList={{ active: props.activeView === "explorer" && props.currentPath === entry.path }}
            onClick={() => props.onSelectPath(entry.path)}
          >
            <span class="sidebar-icon">{ICONS[entry.label]?.() ?? <FolderIcon size={15} />}</span>
            {entry.label}
          </button>
        )}
      </For>
    </nav>
  );
}
