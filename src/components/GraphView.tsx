import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatBytes, parentDir, type DirEntry, type FolderSizeResponse } from "../lib/fs";
import type { PhysicalDisk } from "../lib/graph";
import type { GraphState } from "../lib/settings";
import {
  buildDiskTree,
  canExpand,
  childNode,
  layoutTree,
  updateNodeById,
  NODE_HEIGHT,
  NODE_WIDTH,
  type GraphNode,
  type PositionedNode,
} from "../lib/graphTree";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  DiskIcon,
  ExternalLinkIcon,
  FileIcon,
  FitToViewIcon,
  FolderIcon,
  RedoIcon,
  RefreshIcon,
  UndoIcon,
  VolumeIcon,
} from "./icons";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

// Stores an id + position, not the node itself: if the tooltip captured a
// GraphNode snapshot directly, it would never reflect size updates that
// arrive while it's open (e.g. a pending->resolved size transition) since
// roots() is rebuilt immutably on every update. Looking the node up by id
// each render keeps the tooltip live.
type TooltipState = {
  nodeId: string;
  x: number;
  y: number;
};

type TooltipLine = { label: string; value: string };

function tooltipLines(node: GraphNode): TooltipLine[] {
  const lines: TooltipLine[] = [{ label: "Name", value: node.label }];
  if (node.path) lines.push({ label: "Path", value: node.path });
  lines.push({ label: "Type", value: node.kind });
  // While a recalculation is in flight, any previously known size is stale —
  // prefer the pending indicator so the user doesn't mistake it for current.
  if (node.sizePending) lines.push({ label: "Size", value: "Calculating…" });
  else if (node.size !== undefined) lines.push({ label: "Size", value: formatBytes(node.size) });
  if (node.modifiedAt) lines.push({ label: "Modified", value: new Date(node.modifiedAt * 1000).toLocaleString() });
  if (node.meta && node.kind !== "file") lines.push({ label: "Info", value: node.meta });
  if (node.error) lines.push({ label: "Error", value: node.error });
  return lines;
}

type ContextMenuState = {
  x: number;
  y: number;
  nodeId: string;
};

type GraphViewProps = {
  searchQuery: string;
  onOpenInExplorer: (path: string) => void;
  // GraphView is always mounted (see App.tsx's view-stack), so it can't just
  // check initialState once in onMount — settings load asynchronously and
  // may still be the untouched default at that point. settingsLoaded tells
  // it when initialState (whether null or populated) is actually trustworthy.
  settingsLoaded: boolean;
  persistState: boolean;
  initialState: GraphState | null;
  onStateChange: (state: GraphState) => void;
  // Scopes the Ctrl+Z/Ctrl+Y keyboard shortcuts to when this view is the one
  // actually on screen — it's always mounted, so without this a shortcut
  // pressed while looking at Explorer or Settings would still fire here.
  active: boolean;
};

// Everything an undoable action can change. roots/nodeOverrides are always
// replaced wholesale rather than mutated (see updateNodeById), so archiving a
// snapshot is just holding onto a reference — no deep clone needed, and old
// snapshots can never be corrupted by later updates.
type GraphSnapshot = {
  roots: GraphNode[];
  pan: { x: number; y: number };
  zoom: number;
  nodeOverrides: Map<string, { x: number; y: number }>;
};

export function GraphView(props: GraphViewProps) {
  const [roots, setRoots] = createSignal<GraphNode[]>([]);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [pan, setPan] = createSignal({ x: 60, y: 40 });
  const [zoom, setZoom] = createSignal(1);
  const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  // Manual positions the user has dragged a node to, overriding the computed
  // tree layout for just that node. Keyed by node id so it survives re-runs
  // of layoutTree() (e.g. expanding a sibling) untouched.
  const [nodeOverrides, setNodeOverrides] = createSignal<Map<string, { x: number; y: number }>>(new Map());
  const [draggingNodeId, setDraggingNodeId] = createSignal<string | null>(null);
  let canvasRef: SVGSVGElement | undefined;
  // Guards the one-time restore-on-mount attempt below from re-firing once
  // it's already run (the effect it lives in also depends on roots()/etc.,
  // which change constantly afterward).
  const [restored, setRestored] = createSignal(false);

  // Undo/redo history — covers every arrangement action the user takes
  // (expand/collapse, drag a node, pan, zoom). Deliberately excludes size
  // computations/recalculation (they reflect actual disk state, not a user
  // choice, so "undoing" one doesn't mean anything) and navigating away via
  // the context menu (that's an Explorer action, not a graph one).
  const [undoStack, setUndoStack] = createSignal<GraphSnapshot[]>([]);
  const [redoStack, setRedoStack] = createSignal<GraphSnapshot[]>([]);

  function currentSnapshot(): GraphSnapshot {
    return { roots: roots(), pan: pan(), zoom: zoom(), nodeOverrides: nodeOverrides() };
  }

  function applySnapshot(snap: GraphSnapshot) {
    setTooltip(null);
    setContextMenu(null);
    setRoots(snap.roots);
    setPan(snap.pan);
    setZoom(snap.zoom);
    setNodeOverrides(snap.nodeOverrides);
  }

  // Call before applying an undoable mutation, with the state as it stood
  // just before that mutation. A fresh action always invalidates redo — once
  // you branch off in a new direction, the old "future" isn't reachable
  // anymore.
  function pushHistory() {
    setUndoStack((prev) => [...prev, currentSnapshot()]);
    setRedoStack([]);
  }

  function undo() {
    const stack = undoStack();
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    setUndoStack(stack.slice(0, -1));
    setRedoStack((prev) => [...prev, currentSnapshot()]);
    applySnapshot(previous);
  }

  function redo() {
    const stack = redoStack();
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    setRedoStack(stack.slice(0, -1));
    setUndoStack((prev) => [...prev, currentSnapshot()]);
    applySnapshot(next);
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  }

  onMount(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!props.active) return;
      if (isTypingTarget(document.activeElement)) return;
      if (!(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  onMount(async () => {
    try {
      const disks = await invoke<PhysicalDisk[]>("get_disk_topology");
      setRoots(buildDiskTree(disks, formatBytes));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  });

  // The backend caches recursive folder sizes and watches expanded folders
  // for changes; when a watched folder's contents change, it recomputes and
  // pushes the new size here so the graph stays accurate without a manual
  // refresh.
  onMount(() => {
    let unlisten: (() => void) | undefined;
    listen<{ path: string; size: number }>("folder-size-updated", (event) => {
      applyFolderSize(event.payload.path, event.payload.size);
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => unlisten?.());
  });

  // Per-node mouseenter/mouseleave can't cover every way the cursor leaves a
  // node: if the window loses focus (Alt-Tab, clicking another app while
  // this transparent window sits on top of it) or the cursor exits the
  // window entirely, no mouseleave fires for whatever node was last hovered.
  // These are blunt but reliable backstops for both cases.
  onMount(() => {
    function clearTooltip() {
      setTooltip(null);
      setContextMenu(null);
    }
    window.addEventListener("blur", clearTooltip);
    document.addEventListener("mouseleave", clearTooltip);
    onCleanup(() => {
      window.removeEventListener("blur", clearTooltip);
      document.removeEventListener("mouseleave", clearTooltip);
    });
  });

  const layout = createMemo(() => layoutTree(roots()));
  const nodeById = createMemo(() => new Map(layout().positioned.map((p) => [p.node.id, p])));

  // Only nodes already visible (i.e. inside an expanded/opened branch) can
  // match — layout().positioned excludes anything under a collapsed node, so
  // this never reaches into subtrees the user hasn't opened yet.
  const matchedIds = createMemo(() => {
    const query = props.searchQuery.trim().toLowerCase();
    if (!query) return new Set<string>();
    const ids = new Set<string>();
    for (const p of layout().positioned) {
      if (p.node.label.toLowerCase().includes(query)) ids.add(p.node.id);
    }
    return ids;
  });

  // Shared by the click-to-expand path and restoring a persisted expanded
  // node on mount — fetches this node's children and marks it expanded.
  async function fetchAndExpand(node: GraphNode) {
    setRoots((prev) => updateNodeById(prev, node.id, (n) => ({ ...n, loading: true, error: "" })));
    try {
      const entries = await invoke<DirEntry[]>("list_graph_children", { path: node.path });
      const children = entries.map((entry) => childNode(entry));
      setRoots((prev) =>
        updateNodeById(prev, node.id, (n) => ({
          ...n,
          children,
          loaded: true,
          loading: false,
          expanded: true,
        })),
      );
      for (const child of children) {
        if (child.kind === "folder" && child.path) fetchFolderSize(child.path);
      }
    } catch (err) {
      setRoots((prev) => updateNodeById(prev, node.id, (n) => ({ ...n, loading: false, error: String(err) })));
    }
  }

  async function toggleNode(node: GraphNode) {
    // A drag still ends in a click event — swallow the one right after a
    // real drag so dropping a node doesn't also toggle it.
    if (nodeDragMoved) {
      nodeDragMoved = false;
      return;
    }

    // Expanding/collapsing reflows every node below this one via SVG
    // transforms, not real pointer movement, so any tooltip shown for a node
    // that's about to shift position would otherwise be left stale.
    setTooltip(null);
    setContextMenu(null);
    pushHistory();

    if (!node.expanded && !node.loaded) {
      await fetchAndExpand(node);
      return;
    }
    setRoots((prev) => updateNodeById(prev, node.id, (n) => ({ ...n, expanded: !n.expanded })));
  }

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
    setRoots((prev) => updateNodeById(prev, `folder:${path}`, (n) => ({ ...n, sizePending: true })));
  }

  function applyFolderSize(path: string, size: number) {
    setRoots((prev) => updateNodeById(prev, `folder:${path}`, (n) => ({ ...n, size, sizePending: false })));
  }

  // Node ids embed their full path (e.g. "folder:C:\Users\me"), so counting
  // separators is a cheap stand-in for tree depth — good enough to expand
  // parents before the children a persisted id depends on being able to find.
  function idDepth(id: string): number {
    return (id.match(/\\/g) ?? []).length;
  }

  function collectExpandedIds(nodes: GraphNode[]): string[] {
    const ids: string[] = [];
    for (const node of nodes) {
      if (node.expanded) ids.push(node.id);
      if (node.children.length > 0) ids.push(...collectExpandedIds(node.children));
    }
    return ids;
  }

  async function restoreGraphState(state: GraphState) {
    setPan({ x: state.panX, y: state.panY });
    setZoom(state.zoom);
    setNodeOverrides(new Map(state.nodePositions.map((p) => [p.nodeId, { x: p.x, y: p.y }])));

    // Shallowest first — a nested folder's id can't be found via nodeById()
    // until its parent has actually been expanded and fetched.
    const ids = [...state.expandedNodeIds].sort((a, b) => idDepth(a) - idDepth(b));
    for (const id of ids) {
      const node = nodeById().get(id)?.node;
      // A path that no longer exists (deleted/renamed since last session) or
      // whose parent failed to expand just gets skipped, not retried.
      if (!node) continue;
      if (node.kind === "disk" || node.loaded) {
        setRoots((prev) => updateNodeById(prev, id, (n) => ({ ...n, expanded: true })));
        continue;
      }
      await fetchAndExpand(node);
    }
  }

  // Runs exactly once, as soon as both the disk tree exists (so nodeById()
  // has something to look up) and settings have actually finished loading
  // (so initialState is trustworthy — see the settingsLoaded prop comment).
  createEffect(() => {
    if (restored()) return;
    if (!props.settingsLoaded) return;
    if (roots().length === 0) return;
    setRestored(true);
    if (props.persistState && props.initialState) {
      restoreGraphState(props.initialState);
    }
  });

  // Persists pan/zoom/expanded-folders/node-positions as they change, so the
  // graph looks the same next time the app opens. Debounced the same way
  // App.tsx debounces its own settings writes.
  let saveGraphStateTimeout: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    if (!restored() || !props.persistState) return;
    const state: GraphState = {
      expandedNodeIds: collectExpandedIds(roots()),
      panX: pan().x,
      panY: pan().y,
      zoom: zoom(),
      nodePositions: [...nodeOverrides().entries()].map(([nodeId, { x, y }]) => ({ nodeId, x, y })),
    };
    clearTimeout(saveGraphStateTimeout);
    saveGraphStateTimeout = setTimeout(() => props.onStateChange(state), 400);
  });
  onCleanup(() => clearTimeout(saveGraphStateTimeout));

  function nodeIcon(kind: GraphNode["kind"]) {
    if (kind === "disk") return <DiskIcon size={16} />;
    if (kind === "volume") return <VolumeIcon size={16} />;
    if (kind === "file") return <FileIcon size={14} />;
    return <FolderIcon size={15} />;
  }

  // Re-derives the hovered node from current roots() on every render so the
  // tooltip reflects live size updates instead of a stale hover-time snapshot.
  const tooltipView = createMemo(() => {
    const t = tooltip();
    if (!t) return null;
    const node = nodeById().get(t.nodeId)?.node;
    if (!node) return null;
    return { node, x: t.x, y: t.y };
  });

  function handleNodeEnter(e: MouseEvent, node: GraphNode) {
    // Re-entering the node that opened the menu cancels its pending close.
    if (contextMenu()?.nodeId === node.id) cancelCloseContextMenu();
    // Don't pop up a tooltip while a context menu is open — showing both at
    // once for the same (or a different) node is just visual clutter.
    if (contextMenu()) return;
    setTooltip({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }

  function handleNodeMove(e: MouseEvent) {
    if (tooltip()) setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
  }

  function handleNodeLeave(node: GraphNode) {
    setTooltip(null);
    // The menu should only stay open while the cursor is over the node that
    // opened it or the menu itself — scheduleCloseContextMenu (below) gives
    // the cursor a brief window to travel from one to the other; entering
    // either cancels it.
    if (contextMenu()?.nodeId === node.id) scheduleCloseContextMenu();
  }

  let closeMenuTimeout: ReturnType<typeof setTimeout> | undefined;

  function cancelCloseContextMenu() {
    clearTimeout(closeMenuTimeout);
  }

  function scheduleCloseContextMenu() {
    clearTimeout(closeMenuTimeout);
    closeMenuTimeout = setTimeout(() => setContextMenu(null), 200);
  }

  onCleanup(() => clearTimeout(closeMenuTimeout));

  function handleNodeContextMenu(e: MouseEvent, node: GraphNode) {
    // A right-button drag can still end in a native contextmenu event on
    // release — don't pop the menu up as a side effect of dropping a node.
    if (nodeDragMoved) {
      nodeDragMoved = false;
      e.preventDefault();
      return;
    }
    if (!node.path) return;
    e.preventDefault();
    e.stopPropagation();
    cancelCloseContextMenu();
    setTooltip(null);
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }

  function contextMenuItems(): ContextMenuItem[] {
    const menu = contextMenu();
    const node = menu ? nodeById().get(menu.nodeId)?.node : undefined;
    if (!node?.path) return [];
    // A file itself can't be "opened" in the folder listing — land on the
    // folder that contains it so the file is visible there.
    const targetPath = node.kind === "file" ? parentDir(node.path) : node.path;
    return [
      {
        label: "Open in Explorer",
        icon: <ExternalLinkIcon size={15} />,
        onSelect: () => props.onOpenInExplorer(targetPath),
      },
    ];
  }

  let dragging = false;
  let panMoved = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent) {
    if ((e.target as Element).closest(".graph-node")) return;
    dragging = true;
    panMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    // Panning moves every node under a stationary cursor via the same
    // transform-only reflow as expand/collapse — clear any stale tooltip.
    setTooltip(null);
    setContextMenu(null);
    // The whole drag gesture is one undo step, not one per pixel of movement.
    if (!panMoved) {
      panMoved = true;
      pushHistory();
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function onPointerUp() {
    dragging = false;
  }

  // A burst of wheel notches (one scroll gesture) counts as one undo step —
  // only the first tick in a session pushes history; further ticks within
  // this window are treated as part of the same zoom.
  let zoomSessionActive = false;
  let zoomSessionTimeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(zoomSessionTimeout));

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    // Zooming rescales node positions under a stationary cursor the same way.
    setTooltip(null);
    setContextMenu(null);
    if (!zoomSessionActive) {
      zoomSessionActive = true;
      pushHistory();
    }
    clearTimeout(zoomSessionTimeout);
    zoomSessionTimeout = setTimeout(() => {
      zoomSessionActive = false;
    }, 500);
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  }

  function effectiveX(p: PositionedNode): number {
    return nodeOverrides().get(p.node.id)?.x ?? p.x;
  }

  function effectiveY(p: PositionedNode): number {
    return nodeOverrides().get(p.node.id)?.y ?? p.y;
  }

  // Bookkeeping for a node drag, mirroring the plain-variable pattern used
  // for canvas panning below — only nodeOverrides (what actually renders)
  // needs to be a signal.
  let dragNodeStartClientX = 0;
  let dragNodeStartClientY = 0;
  let dragNodeStartX = 0;
  let dragNodeStartY = 0;
  let nodeDragMoved = false;

  function onNodePointerDown(e: PointerEvent, p: PositionedNode) {
    // Only the left/primary button repositions a node — a right-button press
    // is headed for the context menu, not a drag.
    if (e.button !== 0) return;
    e.stopPropagation();
    setDraggingNodeId(p.node.id);
    dragNodeStartClientX = e.clientX;
    dragNodeStartClientY = e.clientY;
    dragNodeStartX = effectiveX(p);
    dragNodeStartY = effectiveY(p);
    nodeDragMoved = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onNodePointerMove(e: PointerEvent) {
    const id = draggingNodeId();
    if (!id) return;
    // Divide by zoom to convert a screen-space pointer delta into the SVG's
    // local coordinate space, which the enclosing <g> scales by zoom().
    const dx = (e.clientX - dragNodeStartClientX) / zoom();
    const dy = (e.clientY - dragNodeStartClientY) / zoom();
    if (!nodeDragMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      nodeDragMoved = true;
      setTooltip(null);
      setContextMenu(null);
      // Captures state from just before this drag — the whole gesture is one
      // undo step, not one per pixel of movement.
      pushHistory();
    }
    if (!nodeDragMoved) return;
    setNodeOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, { x: dragNodeStartX + dx, y: dragNodeStartY + dy });
      return next;
    });
  }

  function onNodePointerUp() {
    setDraggingNodeId(null);
  }

  // Re-fits pan/zoom so every currently visible node (i.e. inside an
  // expanded branch — same set layoutTree already restricts to) is on
  // screen at once, honoring any dragged-node overrides.
  function fitToView() {
    const positioned = layout().positioned;
    if (positioned.length === 0 || !canvasRef) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positioned) {
      const x = effectiveX(p);
      const y = effectiveY(p);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_WIDTH);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    }

    const viewportWidth = canvasRef.clientWidth;
    const viewportHeight = canvasRef.clientHeight;
    if (viewportWidth === 0 || viewportHeight === 0) return;

    const PADDING = 60;
    const contentWidth = Math.max(maxX - minX, 1);
    const contentHeight = Math.max(maxY - minY, 1);
    const newZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((viewportWidth - PADDING * 2) / contentWidth, (viewportHeight - PADDING * 2) / contentHeight)),
    );

    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    pushHistory();
    setZoom(newZoom);
    setPan({
      x: viewportWidth / 2 - contentCenterX * newZoom,
      y: viewportHeight / 2 - contentCenterY * newZoom,
    });
  }

  function edgePath(fromX: number, fromY: number, toX: number, toY: number): string {
    const startX = fromX + NODE_WIDTH;
    const startY = fromY + NODE_HEIGHT / 2;
    const endY = toY + NODE_HEIGHT / 2;
    const midX = (startX + toX) / 2;
    return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${toX} ${endY}`;
  }

  return (
    <div class="graph-view">
      <div class="graph-toolbar">
        <h2 class="graph-title">Storage graph</h2>
        <button
          type="button"
          class="icon-btn"
          title="Undo"
          aria-label="Undo"
          disabled={undoStack().length === 0}
          onClick={undo}
        >
          <UndoIcon size={16} />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Redo"
          aria-label="Redo"
          disabled={redoStack().length === 0}
          onClick={redo}
        >
          <RedoIcon size={16} />
        </button>
        <span class="graph-hint">Drag canvas to pan · drag a node to reposition · scroll to zoom · click to expand</span>
        <Show when={loading()}>
          <span class="graph-hint">Reading disk layout…</span>
        </Show>
        <Show when={error()}>
          <span class="graph-error">{error()}</span>
        </Show>
      </div>

      <svg
        ref={canvasRef}
        class="graph-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${pan().x}, ${pan().y}) scale(${zoom()})`}>
          <For each={layout().positioned.filter((p) => p.parentId)}>
            {(p) => {
              const parent = () => nodeById().get(p.parentId!);
              return (
                <Show when={parent()}>
                  {(parentNode) => (
                    <path
                      class="graph-edge"
                      d={edgePath(effectiveX(parentNode()), effectiveY(parentNode()), effectiveX(p), effectiveY(p))}
                    />
                  )}
                </Show>
              );
            }}
          </For>

          <For each={layout().positioned}>
            {(p) => (
              <g
                class="graph-node"
                classList={{
                  [`graph-node-${p.node.kind}`]: true,
                  loading: p.node.loading,
                  "has-error": !!p.node.error,
                  expandable: canExpand(p.node),
                  "graph-node-match": matchedIds().has(p.node.id),
                  dragging: draggingNodeId() === p.node.id,
                }}
                transform={`translate(${effectiveX(p)}, ${effectiveY(p)})`}
                onClick={() => toggleNode(p.node)}
                onContextMenu={(e) => handleNodeContextMenu(e, p.node)}
                onMouseEnter={(e) => handleNodeEnter(e, p.node)}
                onMouseMove={handleNodeMove}
                onMouseLeave={() => handleNodeLeave(p.node)}
                onPointerDown={(e) => onNodePointerDown(e, p)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
              >
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} />
                <foreignObject width={NODE_WIDTH} height={NODE_HEIGHT}>
                  <div class="graph-node-body">
                    {nodeIcon(p.node.kind)}
                    <span class="graph-node-label">{p.node.label}</span>
                    <Show when={p.node.loading}>
                      <span class="graph-node-spinner" />
                    </Show>
                    <Show when={canExpand(p.node) && !p.node.loading}>
                      <span classList={{ "graph-node-chevron": true, expanded: p.node.expanded }}>›</span>
                    </Show>
                  </div>
                </foreignObject>
              </g>
            )}
          </For>
        </g>
      </svg>

      <Show when={tooltipView()}>
        {(t) => (
          <div class="graph-tooltip" style={{ left: `${t().x + 16}px`, top: `${t().y + 16}px` }}>
            <For each={tooltipLines(t().node)}>
              {(line) => (
                <div class="graph-tooltip-row">
                  <span class="graph-tooltip-label">{line.label}</span>
                  <span class="graph-tooltip-value">{line.value}</span>
                </div>
              )}
            </For>
            <Show when={t().node.kind === "folder" && t().node.path}>
              <button
                type="button"
                class="graph-tooltip-recalculate"
                title="Recalculate size"
                aria-label="Recalculate size"
                disabled={t().node.sizePending}
                onClick={() => recalculateFolderSize(t().node.path!)}
              >
                <RefreshIcon size={13} />
              </button>
            </Show>
          </div>
        )}
      </Show>

      {contextMenu() && (
        <ContextMenu
          x={contextMenu()!.x}
          y={contextMenu()!.y}
          items={contextMenuItems()}
          onDismiss={() => setContextMenu(null)}
          onMouseEnter={cancelCloseContextMenu}
          onMouseLeave={scheduleCloseContextMenu}
        />
      )}

      <button
        type="button"
        class="icon-btn graph-fit-view"
        title="Fit all visible nodes in view"
        aria-label="Fit all visible nodes in view"
        onClick={fitToView}
      >
        <FitToViewIcon size={18} />
      </button>
    </div>
  );
}
