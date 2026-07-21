import { createContext, useContext, createSignal, onMount, type Accessor, type JSX, type ParentProps } from "solid-js";
import { saveRecentRepo } from "./utils";
import * as git from "./git";
import type {
  GitView, GitStatus, GitCommit, GitBranch, GitGraphEntry,
  GitDiff, GitStashEntry, GitWorktree, GitCommitDetail,
} from "./types";

interface GitContextValue {
  activeView: Accessor<GitView>;
  switchView: (view: GitView) => void;

  repoPath: Accessor<string | null>;
  openRepo: (path: string) => void;
  backToDashboard: () => void;

  status: Accessor<GitStatus | null>;
  branches: Accessor<GitBranch[]>;
  commits: Accessor<GitCommit[]>;
  graph: Accessor<GitGraphEntry[]>;
  stashes: Accessor<GitStashEntry[]>;
  worktrees: Accessor<GitWorktree[]>;
  commitDetail: Accessor<GitCommitDetail | null>;

  selectedDiffFile: Accessor<string | null>;
  selectDiffFile: (path: string | null) => void;
  diffResult: Accessor<GitDiff | null>;
  diffMode: Accessor<"staged" | "unstaged" | "commit">;
  diffCommitHash: Accessor<string | null>;
  setDiffMode: (mode: "staged" | "unstaged" | "commit") => void;

  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  toast: Accessor<{ message: string; type: "success" | "error" } | null>;
  shellAvailable: Accessor<boolean>;

  refresh: () => Promise<void>;
  stage: (path: string) => Promise<void>;
  unstage: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  fetchRemote: () => Promise<void>;
  createBranch: (name: string, start_point?: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  checkout: (branch: string) => Promise<void>;
  merge: (branch: string) => Promise<void>;
  cherryPick: (commitHash: string) => Promise<void>;
  stash: (message?: string) => Promise<void>;
  stashPop: (index: number) => Promise<void>;
  stashDrop: (index: number) => Promise<void>;
  addWorktree: (path: string, branch?: string) => Promise<void>;
  removeWorktree: (path: string) => Promise<void>;
  loadDiff: (filePath: string, mode: "staged" | "unstaged" | "commit", commitHash?: string) => Promise<void>;
  loadGraph: () => Promise<void>;
  loadHistory: (maxCount: number) => Promise<void>;
  loadBranches: () => Promise<void>;
  loadStashes: () => Promise<void>;
  loadWorktrees: () => Promise<void>;
  showCommitDetail: (hash: string) => Promise<void>;
}

const GitContext = createContext<GitContextValue>();

export function useGit(): GitContextValue {
  const ctx = useContext(GitContext);
  if (!ctx) throw new Error("useGit must be used within GitProvider");
  return ctx;
}

export function GitProvider(props: ParentProps & { initialPath?: string | null }) {
  const [activeView, setActiveView] = createSignal<GitView>("dashboard");
  const [repoPath, setRepoPath] = createSignal<string | null>(props.initialPath ?? null);
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [branches, setBranches] = createSignal<GitBranch[]>([]);
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [graph, setGraph] = createSignal<GitGraphEntry[]>([]);
  const [stashes, setStashes] = createSignal<GitStashEntry[]>([]);
  const [worktrees, setWorktrees] = createSignal<GitWorktree[]>([]);
  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(null);
  const [selectedDiffFile, setSelectedDiffFile] = createSignal<string | null>(null);
  const [diffResult, setDiffResult] = createSignal<GitDiff | null>(null);
  const [diffMode, setDiffMode] = createSignal<"staged" | "unstaged" | "commit">("unstaged");
  const [diffCommitHash, setDiffCommitHash] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal<{ message: string; type: "success" | "error" } | null>(null);
  const [shellAvail, setShellAvail] = createSignal(false);

  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (props.initialPath) {
      setRepoPath(props.initialPath);
      refresh();
    }
    setShellAvail(git.hasShellPlugin());
  });

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 3000);
  }

  async function refresh() {
    const path = repoPath();
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const s = await git.gitRepoStatus(path);
      setStatus(s);
      saveRecentRepo(path, s.branch);
      try {
        const c = await git.gitLog(path, 50);
        setCommits(c);
      } catch {}
      try {
        const b = await git.gitBranches(path);
        setBranches(b);
      } catch {}
    } catch (err) {
      setError(`Not a git repository: ${err}`);
      setStatus(null);
      setCommits([]);
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }

  function openRepo(path: string) {
    setRepoPath(path);
    setActiveView("changes");
    setGraph([]);
    setStashes([]);
    setWorktrees([]);
    setCommitDetail(null);
    setSelectedDiffFile(null);
    setDiffResult(null);
    refresh();
  }

  function backToDashboard() {
    setRepoPath(null);
    setStatus(null);
    setBranches([]);
    setCommits([]);
    setGraph([]);
    setStashes([]);
    setWorktrees([]);
    setCommitDetail(null);
    setSelectedDiffFile(null);
    setDiffResult(null);
    setActiveView("dashboard");
  }

  function switchView(view: GitView) {
    setActiveView(view);
    setSelectedDiffFile(null);
    setDiffResult(null);
  }

  async function stage(path: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitStage(p, path);
    await refresh();
  }

  async function unstage(path: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitUnstage(p, path);
    await refresh();
  }

  async function stageAll() {
    const s = status();
    const p = repoPath();
    if (!s || !p) return;
    for (const c of s.changes) {
      if (!c.staged) await git.gitStage(p, c.path);
    }
    await refresh();
  }

  async function unstageAll() {
    const s = status();
    const p = repoPath();
    if (!s || !p) return;
    for (const c of s.changes) {
      if (c.staged) await git.gitUnstage(p, c.path);
    }
    await refresh();
  }

  async function commit(message: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitCommit(p, message);
    showToast("Committed successfully", "success");
    await refresh();
  }

  async function push() {
    const p = repoPath();
    if (!p) return;
    setLoading(true);
    try {
      await git.gitPush(p);
      showToast("Push completed", "success");
      await refresh();
    } catch (err) {
      showToast(`Push failed: ${err}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function pull() {
    const p = repoPath();
    if (!p) return;
    setLoading(true);
    try {
      await git.gitPull(p);
      showToast("Pull completed", "success");
      await refresh();
    } catch (err) {
      showToast(`Pull failed: ${err}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchRemote() {
    const p = repoPath();
    if (!p) return;
    setLoading(true);
    try {
      await git.gitFetch(p);
      showToast("Fetch completed", "success");
      await refresh();
    } catch (err) {
      showToast(`Fetch failed: ${err}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function createBranch(name: string, start_point?: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitBranchCreate(p, name, start_point);
    showToast(`Branch "${name}" created`, "success");
    await refresh();
  }

  async function deleteBranch(name: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitBranchDelete(p, name);
    showToast(`Branch "${name}" deleted`, "success");
    await refresh();
  }

  async function checkout(branch: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitCheckout(p, branch);
    showToast(`Switched to "${branch}"`, "success");
    await refresh();
  }

  async function merge(branch: string) {
    const p = repoPath();
    if (!p) return;
    setLoading(true);
    try {
      await git.gitMerge(p, branch);
      showToast(`Merged "${branch}"`, "success");
      await refresh();
    } catch (err) {
      showToast(`Merge failed: ${err}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function cherryPick(commitHash: string) {
    const p = repoPath();
    if (!p) return;
    setLoading(true);
    try {
      await git.gitCherryPick(p, commitHash);
      showToast("Cherry-pick completed", "success");
      await refresh();
    } catch (err) {
      showToast(`Cherry-pick failed: ${err}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function stash(message?: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitStash(p, message);
    showToast("Changes stashed", "success");
    await refresh();
    await loadStashes();
  }

  async function stashPop(index: number) {
    const p = repoPath();
    if (!p) return;
    await git.gitStashPop(p, index);
    showToast("Stash popped", "success");
    await refresh();
    await loadStashes();
  }

  async function stashDrop(index: number) {
    const p = repoPath();
    if (!p) return;
    await git.gitStashDrop(p, index);
    showToast("Stash dropped", "success");
    await loadStashes();
  }

  async function addWorktree(path: string, branch?: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitWorktreeAdd(p, path, branch);
    showToast("Worktree added", "success");
    await loadWorktrees();
  }

  async function removeWorktree(path: string) {
    const p = repoPath();
    if (!p) return;
    await git.gitWorktreeRemove(p, path);
    showToast("Worktree removed", "success");
    await loadWorktrees();
  }

  async function loadDiff(filePath: string, mode: "staged" | "unstaged" | "commit", commitHash?: string) {
    setSelectedDiffFile(filePath);
    setDiffMode(mode);
    setDiffCommitHash(commitHash ?? null);
    setDiffResult(null);
    const p = repoPath();
    if (!p) return;
    try {
      let diff: GitDiff;
      if (mode === "commit" && commitHash) {
        diff = await git.gitDiffCommit(p, commitHash, filePath);
      } else if (mode === "staged") {
        diff = await git.gitDiffStaged(p, filePath);
      } else {
        diff = await git.gitDiff(p, filePath);
      }
      setDiffResult(diff);
      if (activeView() !== "diff") setActiveView("diff");
    } catch (err) {
      showToast(`Failed to load diff: ${err}`, "error");
    }
  }

  async function loadGraph() {
    const p = repoPath();
    if (!p) return;
    try {
      const g = await git.gitGraph(p, 200);
      setGraph(g);
    } catch (err) {
      showToast(`Failed to load graph: ${err}`, "error");
    }
  }

  async function loadHistory(maxCount: number) {
    const p = repoPath();
    if (!p) return;
    try {
      const c = await git.gitLog(p, maxCount);
      setCommits(c);
    } catch {}
  }

  async function loadBranches() {
    const p = repoPath();
    if (!p) return;
    try {
      const b = await git.gitBranches(p);
      setBranches(b);
    } catch {}
  }

  async function loadStashes() {
    const p = repoPath();
    if (!p) return;
    try {
      const s = await git.gitStashList(p);
      setStashes(s);
    } catch {}
  }

  async function loadWorktrees() {
    const p = repoPath();
    if (!p) return;
    try {
      const w = await git.gitWorktreeList(p);
      setWorktrees(w);
    } catch {}
  }

  async function showCommitDetail(hash: string) {
    const p = repoPath();
    if (!p) return;
    try {
      const d = await git.gitShow(p, hash);
      setCommitDetail(d);
    } catch {}
  }

  const ctx: GitContextValue = {
    activeView, switchView,
    repoPath, openRepo, backToDashboard,
    status, branches, commits, graph, stashes, worktrees, commitDetail,
    selectedDiffFile, selectDiffFile: setSelectedDiffFile,
    diffResult, diffMode, diffCommitHash, setDiffMode,
    loading, error, toast, shellAvailable: shellAvail,
    refresh, stage, unstage, stageAll, unstageAll, commit,
    push, pull, fetchRemote,
    createBranch, deleteBranch, checkout, merge, cherryPick,
    stash, stashPop, stashDrop,
    addWorktree, removeWorktree,
    loadDiff, loadGraph, loadHistory, loadBranches, loadStashes, loadWorktrees,
    showCommitDetail,
  };

  return <GitContext.Provider value={ctx}>{props.children}</GitContext.Provider>;
}
