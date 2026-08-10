import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPath } from "@tauri-apps/plugin-opener";
import { elementAtDropPoint, startRowDrag, transferItems } from "../lib/dnd";
import { BulkRenameDialog } from "./BulkRenameDialog";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Modal } from "./Modal";
import { PreviewPanel } from "./PreviewPanel";
import { PropertiesDialog } from "./PropertiesDialog";
import {
  ClipboardIcon,
  CopyIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  InfoIcon,
  PencilIcon,
  RefreshIcon,
  ScissorsIcon,
  StarIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import {
  baseName,
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
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
  "data-bg-lightness"?: string;
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

type FolderSizeState = "pending" | { size: number; done: boolean };

// Module-level, so it survives FileList unmounting — ExplorerView (and
// therefore FileList) is torn down whenever the user switches to Settings
// or the Storage graph (see the "Views are mounted and unmounted on
// toggle" comment in App.tsx), which used to reset the size map back to
// empty on every remount. The backend's own cache was already fast, but
// starting from an empty Map meant every row briefly rendered as blank/
// pending again while the fresh invoke() calls resolved — visible as sizes
// being "recalculated" even though nothing was actually re-walked. Reading
// straight from this cache on mount skips that round trip entirely for any
// folder already known.
const persistentFolderSizes = new Map<string, FolderSizeState>();

type UndoAction =
  | { type: "rename"; from: string; to: string }
  | { type: "move"; items: { from: string; to: string }[] }
  | { type: "create"; path: string }
  | { type: "bulkRename"; items: { from: string; to: string }[] };

export function FileList(props: FileListProps) {
  const [entries, setEntries] = createSignal<DirEntry[]>([]);
  const [error, setError] = createSignal("");
  const [opError, setOpError] = createSignal("");

  // Delete already has a safety net (Recycle Bin), so undo here is scoped to
  // the operations that don't: rename, move (cut/paste and drag), and the
  // New folder/New file placeholder. Copy is deliberately excluded — it's
  // non-destructive, there's nothing at the original location to restore.
  // Single-slot rather than a full stack: layering "undo the undo" etc. is
  // more state than a file manager toast needs, and matches how most
  // desktop apps' inline undo toasts already behave (Explorer, Gmail).
  const [undoAction, setUndoAction] = createSignal<UndoAction | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  function pushUndo(action: UndoAction) {
    clearTimeout(undoTimer);
    setUndoAction(action);
    undoTimer = setTimeout(() => setUndoAction(null), 8000);
  }

  function undoLabel(action: UndoAction): string {
    if (action.type === "rename") return `Renamed "${baseName(action.from)}"`;
    if (action.type === "create") return `Created "${baseName(action.path)}"`;
    if (action.type === "bulkRename") return `Renamed ${action.items.length} items`;
    return action.items.length > 1 ? `Moved ${action.items.length} items` : `Moved "${baseName(action.items[0].from)}"`;
  }

  async function performUndo() {
    const action = undoAction();
    if (!action) return;
    clearTimeout(undoTimer);
    setUndoAction(null);
    setOpError("");
    try {
      if (action.type === "rename") {
        await invoke<string>("rename_item", { path: action.to, newName: baseName(action.from) });
      } else if (action.type === "create") {
        await invoke<BatchResult>("delete_items", { paths: [action.path] });
      } else if (action.type === "bulkRename") {
        // Each item renamed independently, same as the forward operation —
        // there's no batch rename command to group these into.
        for (const { from, to } of action.items) {
          try {
            await invoke<string>("rename_item", { path: to, newName: baseName(from) });
          } catch (err) {
            setOpError((prev) => (prev ? `${prev}; ${String(err)}` : String(err)));
          }
        }
      } else {
        // Group by original parent so items that came from the same folder
        // move back together in one call — different parents just mean a
        // couple more calls, not a correctness issue.
        const byParent = new Map<string, string[]>();
        for (const { from, to } of action.items) {
          const list = byParent.get(parentDir(from)) ?? [];
          list.push(to);
          byParent.set(parentDir(from), list);
        }
        for (const [parent, sources] of byParent) {
          await invoke<BatchResult>("move_items", { sources, destinationDir: parent });
        }
      }
      refresh();
    } catch (err) {
      setOpError(String(err));
    }
  }

  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = createSignal<number | null>(null);

  // Preview panel: shows automatically whenever exactly one file (not a
  // folder — nothing to preview there) is selected, rather than needing a
  // separate toggle threaded through ExplorerPathBar/App.tsx. Dismissing it
  // only lasts until the selection actually changes to a new single file —
  // reselecting the same file after dismissing keeps it closed, but
  // selecting a different one reopens it, matching how most preview panes
  // (VS Code's, Explorer's) treat "closed" as scoped to the current pick.
  const [previewDismissed, setPreviewDismissed] = createSignal(false);
  const previewPath = createMemo(() => {
    const sel = selected();
    if (sel.size !== 1) return null;
    const [only] = sel;
    const entry = entries().find((e) => e.path === only);
    return entry && !entry.isDir ? entry.path : null;
  });
  createEffect(() => {
    previewPath();
    setPreviewDismissed(false);
  });

  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [deleteTargets, setDeleteTargets] = createSignal<string[] | null>(null);
  const [propertiesTarget, setPropertiesTarget] = createSignal<string | null>(null);
  const [bulkRenameOpen, setBulkRenameOpen] = createSignal(false);

  // Folder sizes are computed lazily in the background by the Rust size
  // cache (never blocking the listing itself) and pushed here as they
  // resolve, keyed by absolute path so entries from different folders
  // (e.g. search results) don't collide.
  const [folderSizes, setFolderSizes] = createSignal<Map<string, FolderSizeState>>(new Map(persistentFolderSizes));

  function isSearching(): boolean {
    return props.searchQuery.trim().length > 0;
  }

  // Directories navigate the explorer itself; files hand off to whatever
  // the OS has registered as the default handler for their type (Notepad
  // for .txt, the browser for .html, …) — the same as double-clicking a
  // file in Windows Explorer. tauri-plugin-opener's openPath shells out to
  // the OS's own "open" verb rather than us maintaining any file-type map.
  async function openEntry(entry: DirEntry) {
    if (entry.isDir) {
      props.onNavigate(entry.path);
      return;
    }
    try {
      await openPath(entry.path);
    } catch (err) {
      setError(String(err));
    }
  }

  async function refresh() {
    setEntries([]);
    const currentPathReq = props.path;
    const currentSearchQueryReq = props.searchQuery;
    const currentSearchRecursiveReq = props.searchRecursive;
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
      if (
        currentPathReq !== props.path ||
        currentSearchQueryReq !== props.searchQuery ||
        currentSearchRecursiveReq !== props.searchRecursive
      ) {
        return;
      }
      setError("");
      setEntries(result);
    } catch (err) {
      if (
        currentPathReq === props.path &&
        currentSearchQueryReq === props.searchQuery &&
        currentSearchRecursiveReq === props.searchRecursive
      ) {
        setError(String(err));
      }
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
  //
  // Entries for folders outside the current listing are deliberately kept.
  // This used to prune down to exactly the visible rows and mirror that onto
  // the module-level cache, which meant navigating C: -> D: discarded every
  // size known for C: — so coming back re-invoked the backend for each row
  // and, whenever the backend's own cache had also churned, re-walked them.
  // Retention is bounded by MAX_FOLDER_SIZES below instead.
  createEffect(() => {
    const list = entries();
    const known = untrack(folderSizes);
    for (const entry of list) {
      if (entry.isDir && !known.has(entry.path)) fetchFolderSize(entry.path);
    }
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    listen<{ path: string; size: number; done: boolean }>("folder-size-updated", (event) => {
      applyFolderSize(event.payload.path, event.payload.size, event.payload.done);
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => unlisten?.());
  });

  async function fetchFolderSize(path: string) {
    try {
      const response = await invoke<FolderSizeResponse>("get_folder_size", { path });
      if (response.status === "ready") applyFolderSize(path, response.size, true);
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

  // Sizes are now retained across navigation rather than pruned to the
  // visible listing, so this is what bounds the map. Roomy enough to hold
  // every folder a long session touches across several drives; the backend
  // holds the authoritative, disk-persisted cache behind it either way.
  const MAX_FOLDER_SIZES = 5000;

  // Mirrors the eviction cap onto the module-level cache too, so a folder
  // dropped here (session ranged over too many folders) is also dropped
  // from what a future remount reads from — otherwise the two could drift
  // and the persistent cache would just grow unbounded across remounts.
  function syncPersistentFolderSizes(next: Map<string, FolderSizeState>) {
    persistentFolderSizes.clear();
    for (const [key, value] of next) persistentFolderSizes.set(key, value);
  }

  // Re-inserts so the entry moves to the newest position: a plain `set` on
  // an existing key keeps its original slot in a JS Map, which would make
  // the oldest-first trim below evict recently-used folders.
  function touchAndTrim(next: Map<string, FolderSizeState>, path: string, value: FolderSizeState) {
    next.delete(path);
    next.set(path, value);
    if (next.size > MAX_FOLDER_SIZES) {
      const keys = [...next.keys()];
      for (let i = 0; i < keys.length - MAX_FOLDER_SIZES; i++) next.delete(keys[i]);
    }
    syncPersistentFolderSizes(next);
    return next;
  }

  function markFolderPending(path: string) {
    setFolderSizes((prev) => {
      // Don't overwrite if progress events already arrived (the worker
      // can emit folder-size-updated before the invoke() response lands).
      const existing = prev.get(path);
      if (existing && typeof existing === "object") return prev;
      return touchAndTrim(new Map(prev), path, { size: 0, done: false });
    });
  }

  function applyFolderSize(path: string, size: number, done: boolean) {
    setFolderSizes((prev) => touchAndTrim(new Map(prev), path, { size, done }));
  }

  function renderSizeCell(entry: DirEntry) {
    if (!entry.isDir) return formatBytes(entry.size);
    const state = folderSizes().get(entry.path);
    if (state && typeof state === "object") {
      const formatted = formatBytes(state.size);
      if (state.done) {
        return formatted;
      } else {
        return (
          <span class="size-calculating">
            {formatted}
            <RefreshIcon size={12} class="size-loading-spinner" />
          </span>
        );
      }
    }
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
        if (state && typeof state === "object") {
          return state.size;
        }
        return undefined;
      }
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
      const newPath = await invoke<string>("rename_item", { path, newName });
      pushUndo({ type: "rename", from: path, to: newPath });
      refresh();
    } catch (err) {
      setOpError(String(err));
    }
  }

  function cancelRename() {
    setRenamingPath(null);
  }

  async function startNewFolder() {
    await createNewEntry("create_folder", "New folder");
  }

  async function startNewFile() {
    await createNewEntry("create_file", "New file.txt");
  }

  // Shared by New folder/New file: pick a name that doesn't collide with
  // anything already listed (appending " (2)", " (3)", … the same way
  // Explorer does), create it, then drop straight into the rename input so
  // the user can immediately type the real name over the placeholder.
  async function createNewEntry(command: "create_folder" | "create_file", defaultName: string) {
    setOpError("");
    const existingNames = new Set(entries().map((e) => e.name));
    let name = defaultName;
    let suffix = 2;
    const dotIndex = defaultName.lastIndexOf(".");
    const stem = dotIndex > 0 ? defaultName.slice(0, dotIndex) : defaultName;
    const ext = dotIndex > 0 ? defaultName.slice(dotIndex) : "";
    while (existingNames.has(name)) {
      name = `${stem} (${suffix})${ext}`;
      suffix++;
    }

    try {
      const newPath = await invoke<string>(command, { parentDir: props.path, name });
      pushUndo({ type: "create", path: newPath });
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

  // Mirrors the backend's own dest_dir.join(file_name) (see move_items_inner/
  // copy_items_inner) so the frontend can compute where an item landed
  // without a round trip — needed to build undo entries, since BatchResult
  // only reports back the original source paths, not the destinations.
  function joinDestPath(destinationDir: string, sourcePath: string): string {
    const withSep = /[\\/]$/.test(destinationDir) ? destinationDir : `${destinationDir}\\`;
    return `${withSep}${baseName(sourcePath)}`;
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
        if (result.succeeded.length > 0) {
          pushUndo({
            type: "move",
            items: result.succeeded.map((from) => ({ from, to: joinDestPath(props.path, from) })),
          });
        }
      }
      refresh();
    } catch (err) {
      setOpError(String(err));
    }
  }

  // Starts a native OS drag session for a row press-and-move, rather than
  // wiring HTML5 `draggable`/dragstart — see dnd.ts's startRowDrag comment
  // for why the two can't be layered on the same gesture. A move threshold
  // (rather than firing on mousedown itself) keeps an ordinary click/
  // ctrl-click from being swallowed as a zero-distance drag.
  function handleRowMouseDown(e: MouseEvent, entry: DirEntry) {
    if (e.button !== 0 || renamingPath() === entry.path) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const dragPaths = selected().has(entry.path) && selected().size > 1 ? [...selected()] : [entry.path];
    const mode: "copy" | "move" = e.ctrlKey || e.metaKey ? "copy" : "move";
    let started = false;

    function onMove(ev: MouseEvent) {
      if (started || Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      started = true;
      cleanup();
      void beginRowDrag(dragPaths, mode);
    }
    function cleanup() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", cleanup);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", cleanup);
  }

  // Only elements explicitly marked [data-drop-path] (folder rows here,
  // sidebar/breadcrumb entries elsewhere) count as a drop target — a drop on
  // a file row or blank list space is a no-op, matching how Explorer treats
  // non-folder rows. A drop that lands outside our own window entirely
  // (external app, Explorer, desktop) is left alone: the OS drag itself
  // already handed the real files to whatever received it.
  async function beginRowDrag(paths: string[], mode: "copy" | "move") {
    try {
      const { result, cursorPos } = await startRowDrag(paths, mode);
      if (result !== "Dropped") return;
      const target = await elementAtDropPoint(cursorPos);
      const dropEl = target?.closest("[data-drop-path]") as HTMLElement | null;
      const destination = dropEl?.dataset.dropPath;
      if (!destination || paths.includes(destination)) return;
      setOpError("");
      const res = await transferItems(paths, destination, mode);
      if (res.failed.length > 0) {
        setOpError(res.failed.map((f) => `${f.path}: ${f.error}`).join("; "));
      }
      if (mode === "move" && res.succeeded.length > 0) {
        pushUndo({
          type: "move",
          items: res.succeeded.map((from) => ({ from, to: joinDestPath(destination, from) })),
        });
      }
      refresh();
    } catch (err) {
      setOpError(String(err));
    }
  }

  // All currently-selected directories (files in the selection are just
  // skipped) — lets Recalculate act on the whole multi-selection in one
  // click instead of only the single row that was right-clicked.
  function selectedDirPaths(): string[] {
    const selectedSet = selected();
    return entries()
      .filter((e) => e.isDir && selectedSet.has(e.path))
      .map((e) => e.path);
  }

  function contextMenuItems(): ContextMenuItem[] {
    const menu = contextMenu();
    if (!menu) return [];
    const canPaste = props.clipboard !== null;

    if (menu.targetPath === null) {
      return [
        { label: "New folder", icon: <FolderPlusIcon size={15} />, onSelect: startNewFolder },
        { label: "New file", icon: <FilePlusIcon size={15} />, onSelect: startNewFile },
        { label: "Paste", icon: <ClipboardIcon size={15} />, onSelect: pasteClipboard, disabled: !canPaste },
      ];
    }

    const hasSelection = selected().size > 0;
    const targetEntry = entries().find((e) => e.path === menu.targetPath);
    const dirPaths = selectedDirPaths();
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
      ...(selected().size > 1
        ? [
            {
              label: `Bulk rename (${selected().size})`,
              icon: <PencilIcon size={15} />,
              onSelect: () => setBulkRenameOpen(true),
            },
          ]
        : []),
      ...(dirPaths.length > 0
        ? [
            {
              label: dirPaths.length > 1 ? `Recalculate (${dirPaths.length})` : "Recalculate",
              icon: <RefreshIcon size={15} />,
              onSelect: () => dirPaths.forEach((path) => recalculateFolderSize(path)),
            },
          ]
        : []),
      ...(targetEntry?.isDir
        ? [
            {
              label: props.favouritePaths.includes(menu.targetPath) ? "Remove from Favourites" : "Add to Favourites",
              icon: <StarIcon size={15} filled={props.favouritePaths.includes(menu.targetPath)} />,
              onSelect: () => props.onToggleFavourite(menu.targetPath!),
              disabled: selected().size !== 1,
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
      {
        label: "Properties",
        icon: <InfoIcon size={15} />,
        onSelect: () => setPropertiesTarget(menu.targetPath),
        disabled: selected().size !== 1,
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
    } else if (!mod && !e.altKey && e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) {
      // Explorer-style type-ahead: typing jumps to the next entry whose name
      // starts with what's been typed so far, same letter repeated cycles
      // through every match instead of just re-selecting the first one.
      typeAheadJump(e.key);
    }
  }

  let typeAheadBuffer = "";
  let typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

  function typeAheadJump(char: string) {
    clearTimeout(typeAheadTimer);
    typeAheadBuffer += char.toLowerCase();
    typeAheadTimer = setTimeout(() => {
      typeAheadBuffer = "";
    }, 700);

    const list = sortedEntries();
    if (list.length === 0) return;

    // Search starting just after the currently-focused row (wrapping
    // around) so pressing the same letter repeatedly cycles forward through
    // every match, rather than always landing back on the first one.
    const currentIndex = lastClickedIndex();
    const startIndex = currentIndex !== null ? currentIndex + 1 : 0;
    const ordered = [...list.slice(startIndex), ...list.slice(0, startIndex)];
    const match = ordered.find((entry) => entry.name.toLowerCase().startsWith(typeAheadBuffer));
    if (!match) return;

    setSelected(new Set([match.path]));
    setLastClickedIndex(list.indexOf(match));
    document
      .querySelector(`[data-row-path="${CSS.escape(match.path)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  onMount(() => document.addEventListener("keydown", handleKeyDown));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  // Drag-in from Explorer/desktop: unlike the internal-drag path above, the
  // OS hands us real paths directly via this Tauri-core event rather than
  // anything DOM-level, so there's no dragover/drop wiring on the rows for
  // this direction — it fires for the whole window regardless of where the
  // cursor lands, so always copies into whatever folder is currently open.
  onMount(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        setOpError("");
        transferItems(event.payload.paths, props.path, "copy")
          .then((res) => {
            if (res.failed.length > 0) {
              setOpError(res.failed.map((f) => `${f.path}: ${f.error}`).join("; "));
            }
            refresh();
          })
          .catch((err) => setOpError(String(err)));
      })
      .then((fn) => {
        unlisten = fn;
      });
    onCleanup(() => unlisten?.());
  });

  return (
    <>
      <div class="file-list" onContextMenu={handleBackgroundContextMenu} data-bg-lightness={props["data-bg-lightness"]}>
        {error() && <p class="file-list-error">{error()}</p>}
        {opError() && <p class="file-list-error">{opError()}</p>}
        <div class="file-list-split">
        <div class="file-list-table-wrap">
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
            <Show when={sortedEntries().length === 0}>
              <tr>
                <td colspan={isSearching() ? 4 : 3} style="text-align:center;padding:3em 1em;opacity:0.5;">
                  <div style="display:flex;flex-direction:column;align-items:center;gap:0.6em;">
                    <FolderIcon size={24} />
                    <span>{isSearching() ? "No results match your search" : "This folder is empty"}</span>
                  </div>
                </td>
              </tr>
            </Show>
            <For each={sortedEntries()}>
              {(entry, index) => (
                <tr
                  class="file-row"
                  classList={{
                    "file-row-dir": entry.isDir,
                    "file-row-selected": selected().has(entry.path),
                    "file-row-cut": props.clipboard?.mode === "cut" && props.clipboard.paths.includes(entry.path),
                  }}
                  tabIndex={0}
                  role="row"
                  data-row-path={entry.path}
                  data-drop-path={entry.isDir ? entry.path : undefined}
                  onMouseDown={(e) => handleRowMouseDown(e, entry)}
                  onClick={(e) => handleRowClick(e, entry, index())}
                  onDblClick={() => openEntry(entry)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      openEntry(entry);
                    } else if (e.key === " ") {
                      e.preventDefault();
                      handleRowClick(e as unknown as MouseEvent, entry, index());
                    }
                  }}
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
                  <td>{renderSizeCell(entry)}</td>
                  <td>{formatModified(entry.modified)}</td>
                  {isSearching() && <td class="file-location">{parentDir(entry.path)}</td>}
                </tr>
              )}
            </For>
          </tbody>
        </table>
        </div>

        <Show when={previewPath() && !previewDismissed()}>
          <PreviewPanel path={previewPath()!} onClose={() => setPreviewDismissed(true)} />
        </Show>
        </div>
      </div>

      {/* Rendered outside .file-list on purpose: that container has its own
          backdrop-filter (for the glass surface look), which — like
          transform/filter — creates a new containing block for
          position:fixed descendants. Nested inside it, these would be
          positioned relative to .file-list's box instead of the viewport,
          landing away from the actual cursor/screen center. */}
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

      {propertiesTarget() && (() => {
        const target = entries().find((e) => e.path === propertiesTarget());
        return (
          <PropertiesDialog
            path={propertiesTarget()!}
            fileSize={target && !target.isDir ? target.size : null}
            folderSizeState={() => folderSizes().get(propertiesTarget()!)}
            onRecalculate={() => recalculateFolderSize(propertiesTarget()!)}
            onClose={() => setPropertiesTarget(null)}
          />
        );
      })()}

      {bulkRenameOpen() && (
        <BulkRenameDialog
          entries={sortedEntries().filter((e) => selected().has(e.path))}
          onClose={() => setBulkRenameOpen(false)}
          onRenamed={(renamed, failures) => {
            setBulkRenameOpen(false);
            if (renamed.length > 0) {
              pushUndo({ type: "bulkRename", items: renamed });
            }
            if (failures.length > 0) {
              setOpError(failures.map((f) => `${f.path}: ${f.error}`).join("; "));
            }
            setSelected(new Set(renamed.map((r) => r.to)));
            refresh();
          }}
        />
      )}

      {undoAction() && (
        <div class="undo-toast" role="status">
          <span>{undoLabel(undoAction()!)}</span>
          <button type="button" onClick={performUndo}>
            <UndoIcon size={14} /> Undo
          </button>
        </div>
      )}
    </>
  );
}
