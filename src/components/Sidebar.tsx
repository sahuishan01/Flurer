import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
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
  customContent?: JSX.Element;
  "data-bg-lightness"?: string;
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
    <div class="sidebar-entry" data-tip={props.path}>
      <button
        type="button"
        class="sidebar-item"
        classList={{ active: props.active }}
        aria-label={baseName(props.path)}
        onClick={() => props.onNavigate(props.path)}
      >
        <span class="sidebar-icon">{props.icon}</span>
        <span class="sidebar-entry-label">{baseName(props.path)}</span>
      </button>
      <button
        type="button"
        class="sidebar-entry-remove"
        aria-label={props.removeLabel}
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const [entries, setEntries] = createSignal<QuickAccessEntry[]>([]);
  const [drives, setDrives] = createSignal<VirtualDisk[]>([]);
  const [tooltip, setTooltip] = createSignal<{ text: string; x: number; y: number } | null>(null);
  let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => clearTimeout(tooltipTimer));

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

  let tipTarget: HTMLElement | null = null;
  let tipPointerX = 0;
  let tipPointerY = 0;

  function scheduleTip(btn: HTMLElement, e: PointerEvent) {
    tipTarget = btn;
    tipPointerX = e.clientX;
    tipPointerY = e.clientY;
    clearTimeout(tooltipTimer);
    const delayStyle = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-tooltip-delay").trim();
    const delay = parseInt(delayStyle) || 500;
    tooltipTimer = setTimeout(() => {
      if (!tipTarget) return;
      setTooltip({ text: tipTarget.dataset.tip || "", x: tipPointerX + 12, y: tipPointerY - 10 });
    }, delay);
  }

  function handleTipMove(e: PointerEvent) {
    const btn = (e.target as Element).closest("[data-tip]") as HTMLElement | null;
    if (btn && btn !== tipTarget) {
      scheduleTip(btn, e);
    } else if (!btn) {
      clearTimeout(tooltipTimer);
      tipTarget = null;
      setTooltip(null);
    } else if (btn === tipTarget && tooltip()) {
      tipPointerX = e.clientX;
      tipPointerY = e.clientY;
      setTooltip((t) => t ? { ...t, x: e.clientX + 12, y: e.clientY - 10 } : null);
    }
  }

  return (
    <>
    <nav
      class="sidebar"
      data-bg-lightness={props["data-bg-lightness"]}
      onPointerMove={handleTipMove}
      onPointerLeave={() => {
        clearTimeout(tooltipTimer);
        tipTarget = null;
        setTooltip(null);
      }}
    >
      <Show when={props.customContent} fallback={
        <>
          <span class="sidebar-section-label">Drives</span>
          <For each={drives()}>
        {(volume) => (
          <button
            type="button"
            class="sidebar-drive"
            classList={{
              active: props.activeView === "explorer" && props.currentPath === `${volume.driveLetter}\\`,
            }}
            aria-label={driveLabel(volume)}
            data-tip={driveLabel(volume)}
            onClick={() => props.onSelectPath(`${volume.driveLetter}\\`)}
          >
            <div
              class="sidebar-item"
              classList={{
                active: props.activeView === "explorer" && props.currentPath === `${volume.driveLetter}\\`,
              }}
            >
              <span class="sidebar-icon">
                <VolumeIcon size={15} />
              </span>
              {driveLabel(volume)}
            </div>
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
          </button>
        )}
      </For>

      <div class="sidebar-divider" />

      <span class="sidebar-section-label">Recents</span>
      <Show when={props.recentPaths.length === 0}>
        <span class="sidebar-empty-label">No recent folders</span>
      </Show>
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

      <span class="sidebar-section-label">Favourites</span>
      <Show when={props.favouritePaths.length === 0}>
        <span class="sidebar-empty-label">No favourites yet</span>
      </Show>
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

      <For each={entries()}>
        {(entry) => (
          <button
            type="button"
            class="sidebar-item"
            classList={{ active: props.activeView === "explorer" && props.currentPath === entry.path }}
            aria-label={entry.path}
            data-tip={entry.path}
            onClick={() => props.onSelectPath(entry.path)}
          >
            <span class="sidebar-icon">{ICONS[entry.label]?.() ?? <FolderIcon size={15} />}</span>
            {entry.label}
          </button>
        )}
      </For>
      </>
      }>
        {props.customContent}
      </Show>
    </nav>

      <Show when={tooltip()}>
        {(t) => (
          <div
            style={{
              position: "fixed",
              left: `${t().x}px`,
              top: `${t().y}px`,
              transform: "translateY(-50%)",
              zIndex: 500,
              padding: "0.3em 0.7em",
              borderRadius: "6px",
              background: "var(--panel-bg)",
              border: "1px solid var(--border-strong)",
              boxShadow: "var(--shadow-md)",
              color: "var(--text-color)",
              fontSize: "13px",
              fontFamily: "var(--font-family)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
            role="tooltip"
          >
            {t().text}
          </div>
        )}
      </Show>
    </>
  );
}
