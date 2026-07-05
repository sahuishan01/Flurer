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
