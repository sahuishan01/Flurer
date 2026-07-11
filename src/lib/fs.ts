export type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
};

export type SortKey = "name" | "size" | "modified";
export type SortDirection = "ascending" | "descending";

export type OpFailure = {
  path: string;
  error: string;
};

export type BatchResult = {
  succeeded: string[];
  failed: OpFailure[];
};

export type ClipboardMode = "copy" | "cut";

export type ClipboardState = {
  mode: ClipboardMode;
  paths: string[];
} | null;

// get_folder_size / recompute_folder_size never block on the recursive walk:
// they return Ready immediately if cached, otherwise Pending, with the real
// value following later via a "folder-size-updated" event.
export type FolderSizeResponse = { status: "ready"; size: number } | { status: "pending" };

export function parentDir(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (idx < 0) return normalized;
  // A file directly at a drive root ("C:\notes.txt") must keep the trailing
  // separator ("C:\") — "C:" without it means "current directory on C:" to
  // Windows, not the drive root, which is a different location entirely.
  if (idx === 2 && normalized[1] === ":") return normalized.slice(0, idx + 1);
  return normalized.slice(0, idx);
}

export function baseName(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "");
  // A bare drive letter ("C:") reads as truncated — show it as a proper
  // drive root instead, the same distinction parentDir already makes for
  // drive roots vs. an ordinary trailing-separator strip.
  if (/^[a-zA-Z]:$/.test(normalized)) return `${normalized}\\`;
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

export type PathSegment = { label: string; path: string };

// Splits a Windows path into clickable breadcrumb segments, each carrying
// the full path to navigate to if that segment is clicked. The drive root
// keeps its trailing separator ("C:\") for the same reason baseName does —
// "C:" alone means "current directory on C:" to Windows, not the drive root.
export function pathSegments(path: string): PathSegment[] {
  const driveMatch = /^([a-zA-Z]:)[\\/]?/.exec(path);
  if (!driveMatch) return path ? [{ label: path, path }] : [];

  const drive = driveMatch[1];
  const rest = path.slice(driveMatch[0].length);
  const parts = rest.split(/[\\/]+/).filter(Boolean);

  const driveRoot = `${drive}\\`;
  const segments: PathSegment[] = [{ label: driveRoot, path: driveRoot }];
  let current = driveRoot;
  for (const part of parts) {
    current = `${current}${part}\\`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

export function formatBytes(bytes: number): string {
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
