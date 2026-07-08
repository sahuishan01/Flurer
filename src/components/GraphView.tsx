import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatBytes, type DirEntry, type FolderSizeResponse } from "../lib/fs";
import type { PhysicalDisk } from "../lib/graph";
import {
  buildDiskTree,
  canExpand,
  childNode,
  layoutTree,
  updateNodeById,
  NODE_HEIGHT,
  NODE_WIDTH,
  type GraphNode,
} from "../lib/graphTree";
import { DiskIcon, FileIcon, FolderIcon, VolumeIcon } from "./icons";

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

export function GraphView() {
  const [roots, setRoots] = createSignal<GraphNode[]>([]);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [pan, setPan] = createSignal({ x: 60, y: 40 });
  const [zoom, setZoom] = createSignal(1);
  const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);

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

  async function toggleNode(node: GraphNode) {
    // Expanding/collapsing reflows every node below this one via SVG
    // transforms, not real pointer movement, so any tooltip shown for a node
    // that's about to shift position would otherwise be left stale.
    setTooltip(null);

    if (!node.expanded && !node.loaded) {
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
    setTooltip({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }

  function handleNodeMove(e: MouseEvent) {
    if (tooltip()) setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
  }

  function handleNodeLeave() {
    setTooltip(null);
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent) {
    if ((e.target as Element).closest(".graph-node")) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    // Panning moves every node under a stationary cursor via the same
    // transform-only reflow as expand/collapse — clear any stale tooltip.
    setTooltip(null);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function onPointerUp() {
    dragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    // Zooming rescales node positions under a stationary cursor the same way.
    setTooltip(null);
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
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
        <span class="graph-hint">Drag to pan · scroll to zoom · click a node to expand</span>
        <Show when={loading()}>
          <span class="graph-hint">Reading disk layout…</span>
        </Show>
        <Show when={error()}>
          <span class="graph-error">{error()}</span>
        </Show>
      </div>

      <svg
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
                    <path class="graph-edge" d={edgePath(parentNode().x, parentNode().y, p.x, p.y)} />
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
                }}
                transform={`translate(${p.x}, ${p.y})`}
                onClick={() => toggleNode(p.node)}
                onMouseEnter={(e) => handleNodeEnter(e, p.node)}
                onMouseMove={handleNodeMove}
                onMouseLeave={handleNodeLeave}
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
                disabled={t().node.sizePending}
                onClick={() => recalculateFolderSize(t().node.path!)}
              >
                Recalculate size
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
