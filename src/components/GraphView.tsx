import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes } from "../lib/fs";
import type { PhysicalDisk, SubfolderEntry } from "../lib/graph";
import {
  buildDiskTree,
  canExpand,
  folderNode,
  layoutTree,
  updateNodeById,
  NODE_HEIGHT,
  NODE_WIDTH,
  type GraphNode,
} from "../lib/graphTree";
import { DiskIcon, FolderIcon, VolumeIcon } from "./icons";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

export function GraphView() {
  const [roots, setRoots] = createSignal<GraphNode[]>([]);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [pan, setPan] = createSignal({ x: 60, y: 40 });
  const [zoom, setZoom] = createSignal(1);

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

  const layout = createMemo(() => layoutTree(roots()));
  const nodeById = createMemo(() => new Map(layout().positioned.map((p) => [p.node.id, p])));

  async function toggleNode(node: GraphNode) {
    if (!node.expanded && !node.loaded) {
      setRoots((prev) => updateNodeById(prev, node.id, (n) => ({ ...n, loading: true, error: "" })));
      try {
        const entries = await invoke<SubfolderEntry[]>("list_subfolders", { path: node.path });
        setRoots((prev) =>
          updateNodeById(prev, node.id, (n) => ({
            ...n,
            children: entries.map(folderNode),
            loaded: true,
            loading: false,
            expanded: true,
          })),
        );
      } catch (err) {
        setRoots((prev) => updateNodeById(prev, node.id, (n) => ({ ...n, loading: false, error: String(err) })));
      }
      return;
    }
    setRoots((prev) => updateNodeById(prev, node.id, (n) => ({ ...n, expanded: !n.expanded })));
  }

  function nodeIcon(kind: GraphNode["kind"]) {
    if (kind === "disk") return <DiskIcon size={16} />;
    if (kind === "volume") return <VolumeIcon size={16} />;
    return <FolderIcon size={15} />;
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
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
              >
                <Show when={p.node.meta || p.node.error}>
                  <title>{p.node.error || p.node.meta}</title>
                </Show>
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
    </div>
  );
}
