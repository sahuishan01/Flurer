export type GitView = "dashboard" | "graph" | "branches" | "changes" | "diff" | "history" | "stash" | "worktrees";

export interface GitChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  changes: GitChange[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
}

export interface GitBranch {
  name: string;
  is_current: boolean;
  upstream: string | null;
}

export interface GitGraphEntry {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
  parents: string[];
  refs: string[];
}

export interface GitDiff {
  hunks: DiffHunk[];
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  origin: string;
  content: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  hash: string;
  timestamp: number;
}

export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null;
  locked: boolean;
}

export interface GitCommitDetail {
  hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  parent_hashes: string[];
}

export interface RecentRepo {
  path: string;
  name: string;
  lastOpened: number;
  branch?: string;
}
