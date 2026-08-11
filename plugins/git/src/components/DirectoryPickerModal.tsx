import { createEffect, createSignal, For, Show } from "solid-js";
import { FolderIcon, CloseIcon, Button } from "./shared";

type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
};

type DirListing = {
  entries: DirEntry[];
  unreadable: number;
};

type DiskVolume = {
  driveLetter: string;
  volumeName: string;
  fileSystem: string;
  totalSpace: number;
  freeSpace: number;
};

type PhysicalDisk = {
  volumes: DiskVolume[];
};

function defaultPath(): string {
  return navigator.platform.toLowerCase().includes("win") ? "C:\\" : "/";
}

function parentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(normalized)) return `${normalized}\\`;
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index < 0) return normalized;
  if (index === 2 && normalized[1] === ":") return normalized.slice(0, index + 1);
  return normalized.slice(0, index) || "/";
}

function formatModified(value: number | null): string {
  return value === null ? "" : new Date(value * 1000).toLocaleString();
}

function driveRoot(letter: string): string {
  if (/^[a-zA-Z]:\\?$/.test(letter)) return `${letter.slice(0, 2)}\\`;
  return letter;
}

export function DirectoryPickerModal(props: {
  open: boolean;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = createSignal(props.initialPath || defaultPath());
  const [selectedPath, setSelectedPath] = createSignal(props.initialPath || defaultPath());
  const [drives, setDrives] = createSignal<DiskVolume[]>([]);
  const [entries, setEntries] = createSignal<DirEntry[]>([]);
  const [unreadable, setUnreadable] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  async function loadDirectory(path: string) {
    if (!window.TauriCore?.invoke) return;
    setLoading(true);
    setError("");
    try {
      const listing = await window.TauriCore.invoke<DirListing>("list_directory", {
        path,
        sortKey: "name",
        sortDirection: "ascending",
      });
      setCurrentPath(path);
      setSelectedPath(path);
      setEntries(listing.entries);
      setUnreadable(listing.unreadable);
    } catch (err) {
      setEntries([]);
      setUnreadable(0);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadDrives(): Promise<DiskVolume[]> {
    try {
      const disks = await window.TauriCore?.invoke<PhysicalDisk[]>("get_disk_topology");
      const volumes = (disks ?? []).flatMap((disk) => disk.volumes ?? []);
      setDrives(volumes);
      return volumes;
    } catch (err) {
      console.error("Failed to load disk volumes for folder picker", err);
      setDrives([]);
      return [];
    }
  }

  createEffect(() => {
    if (!props.open) return;
    void (async () => {
      const volumes = await loadDrives();
      const initial = props.initialPath || driveRoot(volumes[0]?.driveLetter || defaultPath());
      setCurrentPath(initial);
      setSelectedPath(initial);
      await loadDirectory(initial);
    })();
  });

  function selectEntry(entry: DirEntry) {
    if (entry.isDir) setSelectedPath(entry.path);
  }

  function openEntry(entry: DirEntry) {
    if (entry.isDir) loadDirectory(entry.path);
  }

  function goUp() {
    const parent = parentPath(currentPath());
    if (parent !== currentPath()) loadDirectory(parent);
  }

  return (
    <Show when={props.open}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          padding: "20px",
          background: "rgba(0, 0, 0, 0.55)",
          "z-index": 100000,
        }}
        onClick={props.onClose}
      >
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            width: "min(760px, 95vw)",
            height: "min(620px, 88vh)",
            overflow: "hidden",
            background: "var(--surface-bg, rgba(30, 30, 30, 0.94))",
            border: "1px solid var(--border-strong)",
            "border-radius": "var(--radius-md, 8px)",
            "box-shadow": "0 16px 48px rgba(0, 0, 0, 0.45)",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "12px 14px", "border-bottom": "1px solid var(--border-color)" }}>
            <FolderIcon size={17} />
            <strong style={{ flex: 1 }}>Select Repository Folder</strong>
            <button type="button" class="icon-btn" aria-label="Close folder picker" title="Close" onClick={props.onClose}>
              <CloseIcon size={14} />
            </button>
          </div>

          <div style={{ display: "flex", gap: "8px", padding: "10px 14px", "border-bottom": "1px solid var(--border-color)" }}>
            <Button onClick={goUp} disabled={parentPath(currentPath()) === currentPath()}>Up</Button>
            <div style={{ flex: 1, padding: "7px 9px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", background: "var(--control-bg)", border: "1px solid var(--border-color)", "border-radius": "var(--radius-sm)" }} title={currentPath()}>
              {currentPath()}
            </div>
          </div>

          <Show when={drives().length > 0}>
            <div style={{ display: "flex", gap: "6px", padding: "8px 14px", overflow: "auto", "border-bottom": "1px solid var(--border-color)" }}>
              <For each={drives()}>
                {(drive) => {
                  const root = driveRoot(drive.driveLetter);
                  return (
                    <Button
                      variant={currentPath().toLowerCase().startsWith(root.toLowerCase()) ? "primary" : "secondary"}
                      onClick={() => loadDirectory(root)}
                    >
                      {drive.volumeName ? `${drive.volumeName} (${root.slice(0, 2)})` : root.slice(0, 2)}
                    </Button>
                  );
                }}
              </For>
            </div>
          </Show>

          <Show when={error()}>
            <div style={{ padding: "8px 14px", color: "var(--danger)", "border-bottom": "1px solid var(--border-color)" }}>{error()}</div>
          </Show>
          <Show when={unreadable() > 0}>
            <div style={{ padding: "8px 14px", color: "var(--text-secondary)", "border-bottom": "1px solid var(--border-color)" }}>
              {unreadable()} item{unreadable() === 1 ? "" : "s"} could not be read.
            </div>
          </Show>

          <div style={{ flex: 1, overflow: "auto", padding: "0 14px" }}>
            <Show when={!loading()} fallback={<p style={{ padding: "20px", color: "var(--text-secondary)" }}>Loading…</p>}>
              <table class="file-table" style={{ width: "100%" }}>
                <thead>
                  <tr><th>Name</th><th>Modified</th></tr>
                </thead>
                <tbody>
                  <Show when={entries().length > 0} fallback={<tr><td colspan="2" style={{ padding: "24px", "text-align": "center", color: "var(--text-secondary)" }}>This folder is empty</td></tr>}>
                    <For each={entries()}>
                      {(entry) => (
                        <tr
                          class="file-row"
                          classList={{ "file-row-selected": selectedPath() === entry.path, "file-row-dir": entry.isDir }}
                          onClick={() => selectEntry(entry)}
                          onDblClick={() => openEntry(entry)}
                        >
                          <td class="file-name-cell"><Show when={entry.isDir}><FolderIcon size={15} /></Show>{entry.name}</td>
                          <td>{formatModified(entry.modified)}</td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            </Show>
          </div>

          <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", padding: "10px 14px", "border-top": "1px solid var(--border-color)" }}>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => { props.onSelect(selectedPath() || currentPath()); props.onClose(); }}>Select Folder</Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
