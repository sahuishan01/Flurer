import { createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import type { DirEntry } from "../lib/fs";
import type { PhysicalDisk, VirtualDisk } from "../lib/graph";
import { ClockIcon, DiskIcon, EnterIcon, FolderIcon, StarIcon } from "./icons";

type QuickAccessEntry = {
  label: string;
  path: string;
};

/**
 * In-app "choose a folder" browser, for flows that want a Flurer-styled
 * pick rather than the native OS dialog (see `pick_folder`, which is still
 * the right tool for one-off, out-of-app picks like importing a zip).
 *
 * Ported from flurer-plugin-git's DirectoryPickerModal, which built this by
 * calling `list_directory` directly rather than any dedicated picker API —
 * there wasn't one in Flurer core, so this component *is* that shared piece
 * now, reusing the same commands (list_directory, get_disk_topology,
 * get_quick_access) FileList and Sidebar already call.
 */
export function DirectoryPickerModal(props: {
  title: string;
  initialPath?: string;
  recentPaths: string[];
  favouritePaths: string[];
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = createSignal(props.initialPath || "");
  const [subdirs, setSubdirs] = createSignal<DirEntry[]>([]);
  const [drives, setDrives] = createSignal<VirtualDisk[]>([]);
  const [quickAccess, setQuickAccess] = createSignal<QuickAccessEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  async function loadDir(path: string) {
    if (!path) return;
    setLoading(true);
    setCurrentPath(path);
    setError("");
    try {
      const listing = await invoke<{ entries: DirEntry[] }>("list_directory", {
        path,
        sortKey: "name",
        sortDirection: "ascending",
        groupFoldersFirst: true,
      });
      setSubdirs(listing.entries.filter((entry) => entry.isDir));
    } catch (err) {
      setError(String(err));
      setSubdirs([]);
    } finally {
      setLoading(false);
    }
  }

  onMount(async () => {
    try {
      setQuickAccess(await invoke<QuickAccessEntry[]>("get_quick_access"));
    } catch {
      // Quick access is a convenience shortcut list, not essential to
      // picking a folder — an empty sidebar section is a fine fallback.
    }
    try {
      const disks = await invoke<PhysicalDisk[]>("get_disk_topology");
      setDrives(disks.flatMap((disk) => disk.volumes));
    } catch {
      // Same reasoning as quick access above.
    }
    const start = props.initialPath || quickAccess()[0]?.path || drives()[0]?.driveLetter || "C:\\";
    loadDir(start);
  });

  function navigateUp() {
    const current = currentPath().replace(/[/\\]+$/, "");
    const separatorIndex = Math.max(current.lastIndexOf("/"), current.lastIndexOf("\\"));
    if (separatorIndex < 0) return;
    // Preserve a Windows drive root ("C:") rather than truncating it down
    // to an empty/invalid path.
    if (separatorIndex === 2 && current[1] === ":") {
      loadDir(`${current.slice(0, 2)}\\`);
      return;
    }
    const parent = current.slice(0, separatorIndex);
    if (parent) loadDir(parent);
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div class="dir-picker">
        <Show when={error()}>
          <p class="file-list-error selectable-text">{error()}</p>
        </Show>
        <div class="dir-picker-body">
          <div class="dir-picker-sidebar">
            <Show when={drives().length > 0}>
              <div class="dir-picker-sidebar-section">
                <h4>Drives</h4>
                <For each={drives()}>
                  {(drive) => (
                    <button type="button" class="dir-picker-sidebar-item" onClick={() => loadDir(drive.driveLetter)}>
                      <DiskIcon size={14} />
                      <span>{drive.volumeName ? `${drive.volumeName} (${drive.driveLetter})` : drive.driveLetter}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={quickAccess().length > 0}>
              <div class="dir-picker-sidebar-section">
                <h4>Quick access</h4>
                <For each={quickAccess()}>
                  {(entry) => (
                    <button type="button" class="dir-picker-sidebar-item" onClick={() => loadDir(entry.path)}>
                      <FolderIcon size={14} />
                      <span>{entry.label}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={props.favouritePaths.length > 0}>
              <div class="dir-picker-sidebar-section">
                <h4>Favourites</h4>
                <For each={props.favouritePaths}>
                  {(path) => (
                    <button type="button" class="dir-picker-sidebar-item" title={path} onClick={() => loadDir(path)}>
                      <StarIcon size={14} filled />
                      <span>{path}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={props.recentPaths.length > 0}>
              <div class="dir-picker-sidebar-section">
                <h4>Recent</h4>
                <For each={props.recentPaths}>
                  {(path) => (
                    <button type="button" class="dir-picker-sidebar-item" title={path} onClick={() => loadDir(path)}>
                      <ClockIcon size={14} />
                      <span>{path}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="dir-picker-main">
            <div class="dir-picker-path-bar">
              <button type="button" onClick={navigateUp}>
                Up
              </button>
              <input
                type="text"
                value={currentPath()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") loadDir((e.currentTarget as HTMLInputElement).value);
                }}
              />
            </div>
            <div class="dir-picker-list">
              <Show when={loading()}>
                <p class="dir-picker-hint">Loading…</p>
              </Show>
              <Show when={!loading() && subdirs().length === 0}>
                <p class="dir-picker-hint">No subfolders here.</p>
              </Show>
              <For each={subdirs()}>
                {(entry) => (
                  <div class="dir-picker-row" onDblClick={() => loadDir(entry.path)}>
                    <FolderIcon size={15} />
                    <span class="dir-picker-row-name">{entry.name}</span>
                    <button type="button" class="icon-btn" aria-label={`Open ${entry.name}`} onClick={() => loadDir(entry.path)}>
                      <EnterIcon size={13} />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
        <div class="dir-picker-footer">
          <span class="dir-picker-selected selectable-text" title={currentPath()}>
            {currentPath()}
          </span>
          <div class="dir-picker-actions">
            <button type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!currentPath()}
              onClick={() => {
                props.onSelect(currentPath());
                props.onClose();
              }}
            >
              Select folder
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
