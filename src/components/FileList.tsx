import { createEffect, createMemo, createSignal, For, onCleanup, onMount, untrack } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Modal } from "./Modal";
import { ClipboardIcon, CopyIcon, FileIcon, FolderIcon, FolderPlusIcon, PencilIcon, RefreshIcon, ScissorsIcon, TrashIcon } from "./icons";
import {
  formatBytes,
  parentDir,
  type BatchResult,
  type ClipboardState,
  type DirEntry,
  type FolderSizeResponse,
  type SortDirection,
  type SortKey,
} from "../lib/fs";

type FileListProps = {
  path: string;
  onNavigate: (path: string) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortChange: (key: SortKey) => void;
  clipboard: ClipboardState;
  onClipboardChange: (clipboard: ClipboardState) => void;
  searchQuery: string;
  searchRecursive: boolean;
};

type ContextMenuState = { x: number; y: number; targetPath: string | null };

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

  // Folder sizes are computed lazily in the background by the Rust size
  // cache (never blocking the listing itself) and pushed here as they
  // resolve, keyed by absolute path so entries from different folders
  // (e.g. search results) don't collide.
  const [folderSizes, setFolderSizes] = createSignal<Map<string, number | "pending">>(new Map());

  function isSearching(): boolean {
    return props.searchQuery.trim().length > 0;
  }

  async function refresh() {
    try {
      const result = isSearching()
        ? await invoke<DirEntry[]>("search_directory", {
            root: props.path,
            query: props.searchQuery.trim(),
            recursive: props.searchRecursive,
          })
        : await invoke<DirEntry[]>("list_directory", {
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
    props.searchQuery;
    props.searchRecursive;
    refresh();
  });

  createEffect(() => {
    props.path;
    setSelected(new Set<string>());
    setLastClickedIndex(null);
  });

  // Kick off (or resume) background size computation for every folder row as
  // soon as it's listed, rather than waiting for the user to hover/select it.
  createEffect(() => {
    const list = entries();
    const known = untrack(folderSizes);
    for (const entry of list) {
      if (entry.isDir && !known.has(entry.path)) fetchFolderSize(entry.path);
    }
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    listen<{ path: string; size: number }>("folder-size-updated", (event) => {
      applyFolderSize(event.payload.path, event.payload.size);
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => unlisten?.());
  });

  async function fetchFolderSize(path: string) {
    try {
      const response = await invoke<FolderSizeResponse>("get_folder_size", { path });
      if (response.status === "ready") applyFolderSize(path, response.size);
      else markFolderPending(path);
    } catch (err) {
      console.error("Failed to compute folder size for", path, err);
    }
  }

  // Bypasses the cache and forces a fresh recursive walk; the resolved size
  // arrives the same way as any other computation, via folder-size-updated.
  async function recalculateFolderSize(path: string) {
    markFolderPending(path);
    try {
      await invoke<FolderSizeResponse>("recompute_folder_size", { path });
    } catch (err) {
      console.error("Failed to recompute folder size for", path, err);
    }
  }

  function markFolderPending(path: string) {
    setFolderSizes((prev) => new Map(prev).set(path, "pending"));
  }

  function applyFolderSize(path: string, size: number) {
    setFolderSizes((prev) => new Map(prev).set(path, size));
  }

  function sizeCellText(entry: DirEntry): string {
    if (!entry.isDir) return formatBytes(entry.size);
    const state = folderSizes().get(entry.path);
    if (state === "pending") return "Calculating…";
    if (typeof state === "number") return formatBytes(state);
    return "";
  }

  // A directory's raw filesystem size (what the backend sorts by) is
  // meaningless on NTFS — every folder reports roughly the same tiny value,
  // so sorting by it does nothing. Re-sort here using the real recursive
  // sizes this component already computes in the background, keeping
  // folders before files and leaving still-unresolved folders in place
  // (stable) until their size arrives.
  function sortBySize(list: DirEntry[], sizeOf: (entry: DirEntry) => number | undefined): DirEntry[] {
    return list
      .map((entry, index) => ({ entry, index, size: sizeOf(entry) }))
      .sort((a, b) => {
        if (a.size === undefined || b.size === undefined) return a.index - b.index;
        const diff = a.size - b.size;
        return props.sortDirection === "ascending" ? diff : -diff;
      })
      .map((e) => e.entry);
  }

  const sortedEntries = createMemo(() => {
    const list = entries();
    if (props.sortKey !== "size") return list;

    const sizes = folderSizes();
    const dirs = sortBySize(
      list.filter((e) => e.isDir),
      (entry) => {
        const state = sizes.get(entry.path);
        return typeof state === "number" ? state : undefined;
      },
    );
    const files = sortBySize(
      list.filter((e) => !e.isDir),
      (entry) => entry.size,
    );
    return [...dirs, ...files];
  });

  function handleRowClick(e: MouseEvent, entry: DirEntry, index: number) {
    if (e.shiftKey && lastClickedIndex() !== null) {
      const start = Math.min(lastClickedIndex()!, index);
      const end = Math.max(lastClickedIndex()!, index);
      const range = sortedEntries()
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
        { label: "New folder", icon: <FolderPlusIcon size={15} />, onSelect: startNewFolder },
        { label: "Paste", icon: <ClipboardIcon size={15} />, onSelect: pasteClipboard, disabled: !canPaste },
      ];
    }

    const hasSelection = selected().size > 0;
    const targetEntry = entries().find((e) => e.path === menu.targetPath);
    return [
      {
        label: "Copy",
        icon: <CopyIcon size={15} />,
        onSelect: () => props.onClipboardChange({ mode: "copy", paths: [...selected()] }),
        disabled: !hasSelection,
      },
      {
        label: "Cut",
        icon: <ScissorsIcon size={15} />,
        onSelect: () => props.onClipboardChange({ mode: "cut", paths: [...selected()] }),
        disabled: !hasSelection,
      },
      { label: "Paste", icon: <ClipboardIcon size={15} />, onSelect: pasteClipboard, disabled: !canPaste },
      {
        label: "Rename",
        icon: <PencilIcon size={15} />,
        onSelect: () => startRename(menu.targetPath!),
        disabled: selected().size !== 1,
      },
      ...(targetEntry?.isDir
        ? [
            {
              label: "Recalculate",
              icon: <RefreshIcon size={15} />,
              onSelect: () => recalculateFolderSize(menu.targetPath!),
            },
          ]
        : []),
      {
        label: "Delete",
        icon: <TrashIcon size={15} />,
        onSelect: () => requestDelete([...selected()]),
        disabled: !hasSelection,
        danger: true,
      },
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
            {isSearching() && <th>Location</th>}
          </tr>
        </thead>
        <tbody>
          <For each={sortedEntries()}>
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
                <td class="file-name-cell">
                  {entry.isDir ? <FolderIcon size={15} /> : <FileIcon size={15} />}
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
                <td>{sizeCellText(entry)}</td>
                <td>{formatModified(entry.modified)}</td>
                {isSearching() && <td class="file-location">{parentDir(entry.path)}</td>}
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
              <TrashIcon size={14} /> Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
