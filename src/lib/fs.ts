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
