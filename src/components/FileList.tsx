import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Modal } from "./Modal";
import type { BatchResult, ClipboardState, DirEntry, SortDirection, SortKey } from "../lib/fs";

type FileListProps = {
  path: string;
  onNavigate: (path: string) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortChange: (key: SortKey) => void;
  clipboard: ClipboardState;
  onClipboardChange: (clipboard: ClipboardState) => void;
};

type ContextMenuState = { x: number; y: number; targetPath: string | null };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatModified(modified: number | null): string {
  if (modified === null) return "";
  return new Date(modified * 1000).toLocaleString();
}

function sortIndicator(active: boolean, direction: SortDirection): string {
  if (!active) return "";
  return direction === "ascending" ? " ▲" : " ▼";
}

export function FileList(props: FileListProps) {
  const [entries, setEntries] = createSignal<DirEntry[]>([]);
  const [error, setError] = createSignal("");
  const [opError, setOpError] = createSignal("");

  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = createSignal<number | null>(null);

  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [deleteTargets, setDeleteTargets] = createSignal<string[] | null>(null);

  async function refresh() {
    try {
      const result = await invoke<DirEntry[]>("list_directory", {
        path: props.path,
        sortKey: props.sortKey,
        sortDirection: props.sortDirection,
      });
      setError("");
      setEntries(result);
    } catch (err) {
      setError(String(err));
    }
  }

  createEffect(() => {
    props.path;
    props.sortKey;
    props.sortDirection;
    refresh();
  });

  createEffect(() => {
    props.path;
    setSelected(new Set<string>());
    setLastClickedIndex(null);
  });

  function handleRowClick(e: MouseEvent, entry: DirEntry, index: number) {
    if (e.shiftKey && lastClickedIndex() !== null) {
      const start = Math.min(lastClickedIndex()!, index);
      const end = Math.max(lastClickedIndex()!, index);
      const range = entries()
        .slice(start, end + 1)
        .map((en) => en.path);
      setSelected(new Set(range));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setLastClickedIndex(index);
    } else {
      setSelected(new Set([entry.path]));
      setLastClickedIndex(index);
    }
  }

  function handleRowContextMenu(e: MouseEvent, entry: DirEntry) {
    if (!selected().has(entry.path)) {
      setSelected(new Set([entry.path]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, targetPath: entry.path });
  }

  function handleBackgroundContextMenu(e: MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, targetPath: null });
  }

  function startRename(path: string) {
    const entry = entries().find((e) => e.path === path);
    if (!entry) return;
    setRenamingPath(path);
    setRenameValue(entry.name);
  }

  async function commitRename() {
    const path = renamingPath();
    if (!path) return;
    const newName = renameValue().trim();
    setRenamingPath(null);
    if (!newName) return;

    const entry = entries().find((e) => e.path === path);
    if (entry && entry.name === newName) return;

    setOpError("");
    try {
      await invoke<string>("rename_item", { path, newName });
      refresh();
    } catch (err) {
      setOpError(String(err));
    }
  }

  function cancelRename() {
    setRenamingPath(null);
  }

  async function startNewFolder() {
    setOpError("");
    const existingNames = new Set(entries().map((e) => e.name));
    let name = "New folder";
    let suffix = 2;
    while (existingNames.has(name)) {
      name = `New folder (${suffix})`;
      suffix++;
    }

    try {
      const newPath = await invoke<string>("create_folder", { parentDir: props.path, name });
      await refresh();
      setRenamingPath(newPath);
      setRenameValue(name);
    } catch (err) {
      setOpError(String(err));
    }
  }

  function requestDelete(paths: string[]) {
    if (paths.length === 0) return;
    setDeleteTargets(paths);
  }

  async function confirmDelete() {
    const paths = deleteTargets();
    setDeleteTargets(null);
    if (!paths) return;

    setOpError("");
    try {
      const result = await invoke<BatchResult>("delete_items", { paths });
      if (result.failed.length > 0) {
        setOpError(result.failed.map((f) => `${f.path}: ${f.error}`).join("; "));
      }
      setSelected(new Set<string>());
      refresh();
    } catch (err) {
      setOpError(String(err));
    }
  }

  async function pasteClipboard() {
    const clip = props.clipboard;
    if (!clip) return;

    setOpError("");
    try {
      const command = clip.mode === "copy" ? "copy_items" : "move_items";
      const result = await invoke<BatchResult>(command, {
        sources: clip.paths,
        destinationDir: props.path,
      });
      if (result.failed.length > 0) {
        setOpError(result.failed.map((f) => `${f.path}: ${f.error}`).join("; "));
      }
      if (clip.mode === "cut") {
        const remaining = clip.paths.filter((p) => !result.succeeded.includes(p));
        props.onClipboardChange(remaining.length > 0 ? { mode: "cut", paths: remaining } : null);
      }
      refresh();
    } catch (err) {
      setOpError(String(err));
    }
  }

  function contextMenuItems(): ContextMenuItem[] {
    const menu = contextMenu();
    if (!menu) return [];
    const canPaste = props.clipboard !== null;

    if (menu.targetPath === null) {
      return [
        { label: "New Folder", onSelect: startNewFolder },
        { label: "Paste", onSelect: pasteClipboard, disabled: !canPaste },
      ];
    }

    const hasSelection = selected().size > 0;
    return [
      {
        label: "Copy",
        onSelect: () => props.onClipboardChange({ mode: "copy", paths: [...selected()] }),
        disabled: !hasSelection,
      },
      {
        label: "Cut",
        onSelect: () => props.onClipboardChange({ mode: "cut", paths: [...selected()] }),
        disabled: !hasSelection,
      },
      { label: "Paste", onSelect: pasteClipboard, disabled: !canPaste },
      { label: "Rename", onSelect: () => startRename(menu.targetPath!), disabled: selected().size !== 1 },
      { label: "Delete", onSelect: () => requestDelete([...selected()]), disabled: !hasSelection, danger: true },
    ];
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(document.activeElement)) return;

    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Delete") {
      e.preventDefault();
      requestDelete([...selected()]);
    } else if (e.key === "F2") {
      e.preventDefault();
      if (selected().size === 1) startRename([...selected()][0]);
    } else if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      if (selected().size > 0) props.onClipboardChange({ mode: "copy", paths: [...selected()] });
    } else if (mod && e.key.toLowerCase() === "x") {
      e.preventDefault();
      if (selected().size > 0) props.onClipboardChange({ mode: "cut", paths: [...selected()] });
    } else if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteClipboard();
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(entries().map((en) => en.path)));
    }
  }

  onMount(() => document.addEventListener("keydown", handleKeyDown));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  return (
    <div class="file-list" onContextMenu={handleBackgroundContextMenu}>
      {error() && <p class="file-list-error">{error()}</p>}
      {opError() && <p class="file-list-error">{opError()}</p>}
      <table class="file-table">
        <thead>
          <tr>
            <th class="sortable" onClick={() => props.onSortChange("name")}>
              Name{sortIndicator(props.sortKey === "name", props.sortDirection)}
            </th>
            <th class="sortable" onClick={() => props.onSortChange("size")}>
              Size{sortIndicator(props.sortKey === "size", props.sortDirection)}
            </th>
            <th class="sortable" onClick={() => props.onSortChange("modified")}>
              Modified{sortIndicator(props.sortKey === "modified", props.sortDirection)}
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={entries()}>
            {(entry, index) => (
              <tr
                class="file-row"
                classList={{
                  "file-row-dir": entry.isDir,
                  "file-row-selected": selected().has(entry.path),
                  "file-row-cut": props.clipboard?.mode === "cut" && props.clipboard.paths.includes(entry.path),
                }}
                onClick={(e) => handleRowClick(e, entry, index())}
                onDblClick={() => entry.isDir && props.onNavigate(entry.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRowContextMenu(e, entry);
                }}
              >
                <td>
                  {entry.isDir ? "📁" : "📄"}{" "}
                  {renamingPath() === entry.path ? (
                    <input
                      class="rename-input"
                      value={renameValue()}
                      autofocus
                      onInput={(e) => setRenameValue(e.currentTarget.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={() => commitRename()}
                    />
                  ) : (
                    entry.name
                  )}
                </td>
                <td>{entry.isDir ? "" : formatSize(entry.size)}</td>
                <td>{formatModified(entry.modified)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      {contextMenu() && (
        <ContextMenu
          x={contextMenu()!.x}
          y={contextMenu()!.y}
          items={contextMenuItems()}
          onDismiss={() => setContextMenu(null)}
        />
      )}

      {deleteTargets() && (
        <Modal title="Delete items?" onClose={() => setDeleteTargets(null)}>
          <p>
            {deleteTargets()!.length} item{deleteTargets()!.length > 1 ? "s" : ""} will be moved to the Recycle Bin.
          </p>
          <div class="modal-actions">
            <button type="button" onClick={() => setDeleteTargets(null)}>
              Cancel
            </button>
            <button type="button" class="danger" onClick={confirmDelete}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
