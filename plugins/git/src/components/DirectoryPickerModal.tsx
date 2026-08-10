import { createSignal, For, Show, onMount } from "solid-js";
import { FolderIcon, CloseIcon, Button } from "./shared";

interface DiskVolume {
  driveLetter: string;
  volumeName: string;
  fileSystem: string;
  totalSpace: number;
  freeSpace: number;
}

interface PhysicalDisk {
  index: number;
  model: string;
  volumes: DiskVolume[];
}

interface QuickAccessEntry {
  label: string;
  path: string;
}

export function DirectoryPickerModal(props: {
  open: boolean;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = createSignal(props.initialPath || "");
  const [items, setItems] = createSignal<{ name: string; is_dir: boolean; path: string }[]>([]);
  const [drives, setDrives] = createSignal<DiskVolume[]>([]);
  const [quickAccess, setQuickAccess] = createSignal<QuickAccessEntry[]>([]);
  const [loading, setLoading] = createSignal(false);

  async function loadDrivesAndQuickAccess() {
    if (!window.TauriCore?.invoke) return;
    try {
      const topo = await window.TauriCore.invoke<PhysicalDisk[]>("get_disk_topology");
      if (Array.isArray(topo)) {
        const vols: DiskVolume[] = [];
        topo.forEach((d) => {
          if (d.volumes) vols.push(...d.volumes);
        });
        setDrives(vols);
        if (!currentPath() && vols.length > 0) {
          loadDir(vols[0].driveLetter || "C:\\");
        }
      }
    } catch {}

    try {
      const qa = await window.TauriCore.invoke<QuickAccessEntry[]>("get_quick_access");
      if (Array.isArray(qa)) {
        setQuickAccess(qa);
        if (!currentPath() && qa.length > 0) {
          loadDir(qa[0].path);
        }
      }
    } catch {}

    if (!currentPath()) {
      loadDir("/home/opc");
    }
  }

  async function loadDir(dirPath: string) {
    if (!dirPath) return;
    setLoading(true);
    setCurrentPath(dirPath);
    try {
      if (window.TauriCore?.invoke) {
        const res = await window.TauriCore.invoke<any[]>("list_directory", {
          path: dirPath,
          sortKey: "name",
          sortDirection: "ascending",
        });
        if (Array.isArray(res)) {
          const dirs = res
            .filter((item) => item.is_dir || item.isDir)
            .map((item) => ({
              name: item.name,
              is_dir: true,
              path: item.path || `${dirPath}/${item.name}`.replace(/\/+/g, "/"),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setItems(dirs);
        }
      }
    } catch (err) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    if (props.open) {
      loadDrivesAndQuickAccess();
      if (props.initialPath) loadDir(props.initialPath);
    }
  });

  function handleNavigateUp() {
    const p = currentPath();
    const parent = p.substring(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
    if (parent) loadDir(parent);
    else if (p.includes(":") && !p.endsWith("\\")) loadDir(`${p.split(":")[0]}:\\`);
    else if (p !== "/") loadDir("/");
  }

  function handleConfirm() {
    props.onSelect(currentPath());
    props.onClose();
  }

  return (
    <Show when={props.open}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.65)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "z-index": 100000,
          padding: "20px",
        }}
        onClick={props.onClose}
      >
        <div
          style={{
            background: "var(--glass-bg, rgba(32, 32, 32, 0.85))",
            border: "var(--glass-border, 1px solid rgba(255, 255, 255, 0.12))",
            "border-radius": "12px",
            width: "680px",
            "max-width": "95vw",
            height: "520px",
            "max-height": "85vh",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
            "box-shadow": "var(--glass-shadow, 0 16px 40px rgba(0, 0, 0, 0.6))",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ padding: "14px 18px", "border-bottom": "var(--glass-border, 1px solid rgba(255,255,255,0.08))", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <FolderIcon size={18} />
              <span style={{ "font-weight": 600, "font-size": "14px", color: "var(--text-primary, var(--text-color))", "text-shadow": "var(--text-shadow)" }}>Select Repository Directory</span>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              style={{ background: "none", border: "none", color: "var(--text-secondary, #888)", cursor: "pointer", padding: "4px", display: "inline-flex", "align-items": "center" }}
            >
              <CloseIcon size={16} />
            </button>
          </div>

          {/* Body: Sidebar + File View */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Disks & Quick Access Sidebar */}
            <div style={{ width: "190px", "border-right": "var(--glass-border, 1px solid rgba(255,255,255,0.08))", background: "var(--acrylic-bg, rgba(0,0,0,0.15))", padding: "12px 8px", display: "flex", "flex-direction": "column", gap: "16px", "overflow-y": "auto", "flex-shrink": 0 }}>
              {/* Disks Section */}
              <Show when={drives().length > 0}>
                <div>
                  <div style={{ "font-size": "11px", "font-weight": 600, color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)", "text-transform": "uppercase", "letter-spacing": "0.5px", "margin-bottom": "6px", padding: "0 6px" }}>
                    Drives & Volumes
                  </div>
                  <For each={drives()}>
                    {(vol) => (
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "8px",
                          padding: "6px 8px",
                          "border-radius": "6px",
                          cursor: "pointer",
                          "font-size": "12px",
                          color: currentPath().startsWith(vol.driveLetter) ? "var(--accent-default, var(--accent-color, #60cdff))" : "var(--text-primary, var(--text-color))",
                          "text-shadow": "var(--text-shadow)",
                          background: currentPath().startsWith(vol.driveLetter) ? "var(--accent-bg-soft, rgba(96,205,255,0.12))" : "transparent",
                          transition: "background 0.15s",
                        }}
                        onClick={() => loadDir(vol.driveLetter)}
                      >
                        💾 <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "font-weight": 500 }}>
                          {vol.volumeName ? `${vol.volumeName} (${vol.driveLetter})` : vol.driveLetter}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Quick Access Section */}
              <Show when={quickAccess().length > 0}>
                <div>
                  <div style={{ "font-size": "11px", "font-weight": 600, color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)", "text-transform": "uppercase", "letter-spacing": "0.5px", "margin-bottom": "6px", padding: "0 6px" }}>
                    Quick Access
                  </div>
                  <For each={quickAccess()}>
                    {(qa) => (
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "8px",
                          padding: "6px 8px",
                          "border-radius": "6px",
                          cursor: "pointer",
                          "font-size": "12px",
                          color: currentPath() === qa.path ? "var(--accent-default, var(--accent-color, #60cdff))" : "var(--text-primary, var(--text-color))",
                          "text-shadow": "var(--text-shadow)",
                          background: currentPath() === qa.path ? "var(--accent-bg-soft, rgba(96,205,255,0.12))" : "transparent",
                          transition: "background 0.15s",
                        }}
                        onClick={() => loadDir(qa.path)}
                      >
                        <FolderIcon size={14} />
                        <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                          {qa.label}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Fallback Root shortcut if no drives detected */}
              <Show when={drives().length === 0 && quickAccess().length === 0}>
                <div>
                  <div style={{ "font-size": "11px", "font-weight": 600, color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)", "text-transform": "uppercase", "margin-bottom": "6px", padding: "0 6px" }}>
                    Shortcuts
                  </div>
                  <div style={{ padding: "6px 8px", cursor: "pointer", "font-size": "12px", color: "var(--text-primary, var(--text-color))", "text-shadow": "var(--text-shadow)" }} onClick={() => loadDir("/")}>📁 Root (/)</div>
                </div>
              </Show>
            </div>

            {/* Directory Explorer Pane */}
            <div style={{ flex: 1, display: "flex", "flex-direction": "column", overflow: "hidden" }}>
              {/* Path Navigation Bar */}
              <div style={{ padding: "10px 14px", background: "var(--control-bg, rgba(0,0,0,0.15))", "border-bottom": "var(--glass-border, 1px solid rgba(255,255,255,0.08))", display: "flex", "align-items": "center", gap: "8px" }}>
                <Button size="sm" onClick={handleNavigateUp}>
                  ↑ Up
                </Button>
                <input
                  type="text"
                  value={currentPath()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") loadDir((e.currentTarget as HTMLInputElement).value);
                  }}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    "font-size": "12px",
                    "font-family": "var(--fluent-font, Space Mono, monospace)",
                    background: "var(--control-bg, var(--text-backplate, rgba(0,0,0,0.35)))",
                    border: "var(--control-border, 1px solid rgba(255,255,255,0.12))",
                    color: "var(--text-primary, var(--text-color))",
                    "text-shadow": "var(--text-shadow)",
                    "border-radius": "4px",
                  }}
                />
              </div>

              {/* Items List */}
              <div style={{ flex: 1, "overflow-y": "auto", padding: "8px 12px" }}>
                <Show when={loading()}>
                  <div style={{ padding: "20px", "text-align": "center", color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)", "font-size": "13px" }}>
                    Loading directories...
                  </div>
                </Show>
                <Show when={!loading() && items().length === 0}>
                  <div style={{ padding: "20px", "text-align": "center", color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)", "font-size": "13px" }}>
                    No subdirectories found in this folder.
                  </div>
                </Show>
                <For each={items()}>
                  {(item) => (
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "10px",
                        padding: "8px 10px",
                        "border-radius": "6px",
                        cursor: "pointer",
                        "font-size": "13px",
                        transition: "background 0.15s",
                        color: "var(--text-primary, var(--text-color))",
                        "text-shadow": "var(--text-shadow)",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--control-hover-bg, rgba(255,255,255,0.1))"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      onDblClick={() => loadDir(item.path)}
                      onClick={() => setCurrentPath(item.path)}
                    >
                      <FolderIcon size={16} />
                      <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {item.name}
                      </span>
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); loadDir(item.path); }}>
                        Enter
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: "12px 18px", "border-top": "var(--glass-border, 1px solid rgba(255,255,255,0.08))", display: "flex", "align-items": "center", "justify-content": "space-between", background: "var(--control-bg, rgba(0,0,0,0.15))" }}>
            <span style={{ "font-size": "11px", color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)", "font-family": "var(--fluent-font, Space Mono, monospace)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "max-width": "360px" }}>
              Selected: {currentPath()}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <Button onClick={props.onClose}>Cancel</Button>
              <Button variant="primary" onClick={handleConfirm}>
                Select Directory
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
