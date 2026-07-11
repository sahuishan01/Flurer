import type { DirEntry } from "./fs";
import type { PhysicalDisk } from "./graph";

export type GraphNodeKind = "disk" | "volume" | "folder" | "file";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  meta: string;
  path?: string;
  size?: number;
  sizePending?: boolean;
  modifiedAt?: number | null;
  children: GraphNode[];
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  error: string;
};

export function buildDiskTree(disks: PhysicalDisk[], formatBytes: (bytes: number) => string): GraphNode[] {
  return disks.map((disk) => ({
    id: `disk:${disk.index}`,
    kind: "disk",
    label: `Disk ${disk.index}: ${disk.model || "Unknown disk"}`,
    meta: `${formatBytes(disk.size)} · ${disk.mediaType}${disk.interfaceType ? ` · ${disk.interfaceType}` : ""}`,
    children: disk.volumes.map((volume) => ({
      id: `volume:${volume.driveLetter}`,
      kind: "volume" as const,
      label: volume.volumeName ? `${volume.driveLetter} (${volume.volumeName})` : volume.driveLetter,
      meta: `${formatBytes(volume.totalSpace - volume.freeSpace)} of ${formatBytes(volume.totalSpace)} used${
        volume.fileSystem ? ` · ${volume.fileSystem}` : ""
      }`,
      path: `${volume.driveLetter}\\`,
      children: [],
      expanded: false,
      loaded: false,
      loading: false,
      error: "",
    })),
    expanded: false,
    loaded: true,
    loading: false,
    error: "",
  }));
}

export function childNode(entry: DirEntry): GraphNode {
  return {
    id: `${entry.isDir ? "folder" : "file"}:${entry.path}`,
    kind: entry.isDir ? "folder" : "file",
    label: entry.name,
    meta: "",
    path: entry.path,
    // A directory's own filesystem size is meaningless (always ~0 — it's not
    // a data stream). Leave it undefined until a real recursive size arrives
    // via get_folder_size, rather than showing a bogus "0 B".
    size: entry.isDir ? undefined : entry.size,
    modifiedAt: entry.modified,
    children: [],
    expanded: false,
    // Files have no children, so there's nothing to fetch — treat as
    // already-loaded so canExpand() correctly hides the expand affordance.
    loaded: !entry.isDir,
    loading: false,
    error: "",
  };
}

export function updateNodeById(roots: GraphNode[], id: string, updater: (node: GraphNode) => GraphNode): GraphNode[] {
  return roots.map((node) => {
    if (node.id === id) return updater(node);
    if (node.children.length === 0) return node;
    return { ...node, children: updateNodeById(node.children, id, updater) };
  });
}

export function findNode(roots: GraphNode[], predicate: (node: GraphNode) => boolean): GraphNode | undefined {
  for (const node of roots) {
    if (predicate(node)) return node;
    if (node.children.length > 0) {
      const found = findNode(node.children, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

export function canExpand(node: GraphNode): boolean {
  return !node.loaded || node.children.length > 0;
}

export type PositionedNode = {
  node: GraphNode;
  x: number;
  y: number;
  parentId?: string;
};

export const COL_WIDTH = 260;
export const ROW_HEIGHT = 60;
export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 42;

export type TreeLayout = {
  positioned: PositionedNode[];
  width: number;
  height: number;
};

// A minimal top-down tree layout: leaves get the next free row, and each
// internal (expanded) node is centered on the vertical span of its visible
// children. Collapsed nodes are drawn as leaves regardless of whether they
// have children, since nothing below them is on screen yet.
export function layoutTree(roots: GraphNode[]): TreeLayout {
  const positioned: PositionedNode[] = [];
  let row = 0;

  function visit(node: GraphNode, depth: number, parentId?: string): number {
    const entry: PositionedNode = { node, x: depth * COL_WIDTH, y: 0, parentId };
    positioned.push(entry);

    const visibleChildren = node.expanded ? node.children : [];
    if (visibleChildren.length === 0) {
      entry.y = row * ROW_HEIGHT;
      row++;
      return entry.y;
    }

    const childYs = visibleChildren.map((child) => visit(child, depth + 1, node.id));
    entry.y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    return entry.y;
  }

  for (const root of roots) visit(root, 0, undefined);

  const width = positioned.reduce((max, p) => Math.max(max, p.x), 0) + COL_WIDTH;
  const height = positioned.reduce((max, p) => Math.max(max, p.y), 0) + ROW_HEIGHT;

  return { positioned, width, height };
}
