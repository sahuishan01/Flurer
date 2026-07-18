export type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
};

export type FolderSizeResponse =
  | { status: "ready"; size: number }
  | { status: "pending" };

export type VirtualDisk = {
  driveLetter: string;
  volumeName: string;
  fileSystem: string;
  totalSpace: number;
  freeSpace: number;
};

export type PhysicalDisk = {
  index: number;
  model: string;
  size: number;
  mediaType: string;
  interfaceType: string;
  volumes: VirtualDisk[];
};

export type GraphNodePosition = {
  nodeId: string;
  x: number;
  y: number;
};

export type GraphState = {
  expandedNodeIds: string[];
  panX: number;
  panY: number;
  zoom: number;
  nodePositions: GraphNodePosition[];
};

export type GraphFocusRequest = {
  path: string;
  token: number;
};
