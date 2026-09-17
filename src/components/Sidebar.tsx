import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
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
  TrashIcon,
  VolumeIcon,
} from "./icons";
import type { MainView } from "../lib/view";
import type { PhysicalDisk, VirtualDisk } from "../lib/graph";
import type { SidebarSectionId } from "../lib/settings";
import { DEFAULT_SIDEBAR_SECTION_ORDER } from "../lib/settings";
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

const SECTION_TITLES: Record<SidebarSectionId, string> = {
  quick: "Quick access",
  drives: "Drives",
  recents: "Recents",
  favourites: "Favourites",
};

type SidebarProps = {
  currentPath: string;
  // Every clickable place in the sidebar (drives, recents, favourites, quick
  // access) goes through this one callback rather than a plain "navigate to
  // Explorer" — while already in graph mode it focuses that path there
  // instead of switching away; see App.tsx's selectSidebarPath.
  onSelectPath: (path: string) => void;
  // Recycle Bin lives in the Quick Access list (see the synthetic entry
  // above the get_quick_access() loop below) rather than a real
  // filesystem path, so it switches mainView directly instead of going
  // through onSelectPath — same call ViewRail's own view buttons make.
  onSelectView: (view: MainView) => void;
  activeView: MainView;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
  folderColors: Record<string, string | undefined>;
  recentPaths: string[];
  onRemoveRecent: (path: string) => void;
  // Persisted drag-reorder state: section order and Quick access entry
  // order (by label). Missing ids/labels fall back to their default spot.
  sectionOrder: SidebarSectionId[];
  onSectionOrderChange: (order: SidebarSectionId[]) => void;
  quickAccessOrder: string[];
  onQuickAccessOrderChange: (order: string[]) => void;
  customContent?: JSX.Element;
  width?: number;
  "data-bg-lightness"?: string;
};

type SidebarEntryProps = {
  path: string;
  icon: JSX.Element;
  active: boolean;
  onNavigate: (path: string) => void;
  onRemove: () => void;
  removeLabel: string;
  colorHex?: string;
};

function SidebarEntry(props: SidebarEntryProps) {
  return (
    <div class="sidebar-entry" data-tip={props.path} data-drop-path={props.path}>
      <button
        type="button"
        class="sidebar-item"
        classList={{ active: props.active }}
        aria-label={baseName(props.path)}
        onClick={() => props.onNavigate(props.path)}
      >
        <span class="sidebar-icon">{props.icon}</span>
        <span class="sidebar-entry-label">{baseName(props.path)}</span>
        <Show when={props.colorHex}>
          {(hex) => (
            <span
              class="folder-color-dot"
              style={{ background: hex() }}
              aria-label="Color tag"
            />
          )}
        </Show>
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

  async function refreshDrives() {
    try {
      const disks = await invoke<PhysicalDisk[]>("get_disk_topology");
      setDrives(disks.flatMap((disk) => disk.volumes));
    } catch (err) {
      console.error("Failed to load drives", err);
    }
  }

  onMount(() => {
    refreshDrives();
    // Windows doesn't give us a WM_DEVICECHANGE event today, so poll for
    // newly-attached/removed drives (e.g. a USB stick plugged in) instead of
    // only ever loading the list once at startup.
    const poll = setInterval(refreshDrives, 3000);
    onCleanup(() => clearInterval(poll));
  });

  let tipTarget: HTMLElement | null = null;
  let tipPointerX = 0;
  let tipPointerY = 0;

  // ---- Drag-to-reorder (sections and Quick access entries) --------------
  //
  // Plain HTML5 drag confined to the sidebar: a distinct MIME marks each
  // payload so these drags can never be confused with file drags (which
  // are native OS drags via tauri-plugin-drag and never fire HTML5
  // dragstart here) or with anything dropping in from outside.
  const SECTION_MIME = "application/x-flurer-sidebar-section";
  const QUICK_MIME = "application/x-flurer-quick-access";
  const [dragOverSection, setDragOverSection] = createSignal<SidebarSectionId | null>(null);
  const [dragOverQuick, setDragOverQuick] = createSignal<string | null>(null);

  const sectionOrder = createMemo<SidebarSectionId[]>(() => {
    const saved = props.sectionOrder;
    const known = [...DEFAULT_SIDEBAR_SECTION_ORDER];
    // Saved entries first (deduped, only known ids), then any missing ones
    // in their default position — so a hand-edited or older settings file
    // still renders a complete sidebar.
    const ordered = saved.filter((id, i) => known.includes(id) && saved.indexOf(id) === i);
    for (const id of known) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  });

  function reorderSections(fromId: string, toId: SidebarSectionId) {
    const order = [...sectionOrder()];
    const from = order.indexOf(fromId as SidebarSectionId);
    const to = order.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    props.onSectionOrderChange(order);
  }

  const quickEntries = createMemo<QuickAccessEntry[]>(() => {
    const rank = new Map(props.quickAccessOrder.map((label, i) => [label, i]));
    if (rank.size === 0) return entries();
    return [...entries()].sort(
      (a, b) => (rank.get(a.label) ?? Infinity) - (rank.get(b.label) ?? Infinity),
    );
  });

  function reorderQuick(fromLabel: string, toLabel: string) {
    if (fromLabel === toLabel) return;
    const current = quickEntries().map((e) => e.label);
    const from = current.indexOf(fromLabel);
    const to = current.indexOf(toLabel);
    if (from < 0 || to < 0) return;
    current.splice(to, 0, current.splice(from, 1)[0]);
    props.onQuickAccessOrderChange(current);
  }

  function sectionDragHandlers(id: SidebarSectionId) {
    return {
      // Dragstart bubbles up from the header span (the grab handle), so
      // setting the payload here covers the whole section.
      onDragStart: (e: DragEvent) => {
        e.dataTransfer?.setData(SECTION_MIME, id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes(SECTION_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverSection(id);
      },
      onDragLeave: () => setDragOverSection((cur) => (cur === id ? null : cur)),
      onDragEnd: () => setDragOverSection(null),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const from = e.dataTransfer?.getData(SECTION_MIME);
        setDragOverSection(null);
        if (from && from !== id) reorderSections(from, id);
      },
    };
  }

  function quickDragHandlers(label: string) {
    return {
      onDragStart: (e: DragEvent) => {
        e.dataTransfer?.setData(QUICK_MIME, label);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes(QUICK_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverQuick(label);
      },
      onDragLeave: () => setDragOverQuick((cur) => (cur === label ? null : cur)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const from = e.dataTransfer?.getData(QUICK_MIME);
        setDragOverQuick(null);
        if (from && from !== label) reorderQuick(from, label);
      },
      onDragEnd: () => setDragOverQuick(null),
    };
  }

  // Each section is one reorderable block: a draggable header (the handle)
  // plus its entries, wrapped by the drop target so the whole section —
  // not just the thin header strip — participates in the reorder drop.
  function renderSection(id: SidebarSectionId): JSX.Element {
    return (
      <div
        class="sidebar-section"
        classList={{ "drag-over": dragOverSection() === id }}
        {...sectionDragHandlers(id)}
      >
        {/* draggable must be explicitly true — a bare `draggable` attribute
            renders as draggable="" which the HTML spec treats as false. */}
        <span class="sidebar-section-label is-grab" draggable={true}>{SECTION_TITLES[id]}</span>
        {id === "drives" && (
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
                data-drop-path={`${volume.driveLetter}\\`}
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
        )}
        {id === "recents" && (
          <>
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
                  colorHex={props.folderColors[path]}
                />
              )}
            </For>
          </>
        )}
        {id === "favourites" && (
          <>
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
                  colorHex={props.folderColors[path]}
                />
              )}
            </For>
          </>
        )}
        {id === "quick" && (
          <>
            {/* Recycle Bin stays pinned at the top of Quick access — it has
                no filesystem path to rank against the OS entries below. */}
            <button
              type="button"
              class="sidebar-item"
              classList={{ active: props.activeView === "trash" }}
              aria-label="Recycle Bin"
              data-tip="Recycle Bin"
              onClick={() => props.onSelectView("trash")}
            >
              <span class="sidebar-icon">
                <TrashIcon size={15} />
              </span>
              Recycle Bin
            </button>
            <For each={quickEntries()}>
              {(entry) => (
                <button
                  type="button"
                  class="sidebar-item"
                  classList={{
                    active: props.activeView === "explorer" && props.currentPath === entry.path,
                    "drag-over": dragOverQuick() === entry.label,
                  }}
                  draggable={true}
                  aria-label={entry.path}
                  data-tip={entry.path}
                  data-drop-path={entry.path}
                  onClick={() => props.onSelectPath(entry.path)}
                  {...quickDragHandlers(entry.label)}
                >
                  <span class="sidebar-icon">{ICONS[entry.label]?.() ?? <FolderIcon size={15} />}</span>
                  {entry.label}
                </button>
              )}
            </For>
          </>
        )}
      </div>
    );
  }

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
      classList={{ "is-narrow": (props.width ?? 220) < 80 }}
      style={{ width: props.width ? `${props.width}px` : undefined }}
      data-bg-lightness={props["data-bg-lightness"]}
      onPointerMove={handleTipMove}
      onPointerLeave={() => {
        clearTimeout(tooltipTimer);
        tipTarget = null;
        setTooltip(null);
      }}
    >
      <Show when={props.customContent} fallback={<For each={sectionOrder()}>{renderSection}</For>}>
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
              "z-index": 500,
              padding: "0.3em 0.7em",
              "border-radius": "6px",
              background: "var(--panel-bg)",
              border: "1px solid var(--border-strong)",
              "box-shadow": "var(--shadow-md)",
              color: "var(--text-color)",
              "font-size": "var(--text-caption)",
              "font-family": "var(--font-family)",
              "white-space": "nowrap",
              "pointer-events": "none",
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
