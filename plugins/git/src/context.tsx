import { createContext, useContext, createSignal, createMemo, onMount, type Accessor, type JSX, type ParentProps } from "solid-js";
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
  historyHasMore: Accessor<boolean>;
  graph: Accessor<GitGraphEntry[]>;
  graphHasMore: Accessor<boolean>;
  graphLoading: Accessor<boolean>;
  stashes: Accessor<GitStashEntry[]>;
  worktrees: Accessor<GitWorktree[]>;
  commitDetail: Accessor<GitCommitDetail | null>;

  selectedDiffFile: Accessor<string | null>;
  selectDiffFile: (path: string | null) => void;
  diffResult: Accessor<GitDiff | null>;
  diffMode: Accessor<"staged" | "unstaged" | "commit" | "compare">;
  diffCommitHash: Accessor<string | null>;
  compareSourceHash: Accessor<string | null>;
  setCompareSourceHash: (hash: string | null) => void;
  diffCompareCommits: Accessor<{ from: string; to: string } | null>;
  setDiffMode: (mode: "staged" | "unstaged" | "commit" | "compare") => void;

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
  loadDiff: (filePath: string, mode: "staged" | "unstaged" | "commit" | "compare", commitHash?: string) => Promise<void>;
  loadDiffCompare: (fromHash: string, toHash: string, filePath?: string) => Promise<void>;
  loadDiffWithCurrent: (commitHash: string, filePath?: string) => Promise<void>;
  loadDiffWithWorkingTree: (commitHash: string, filePath?: string) => Promise<void>;
  diffPromptHash: Accessor<string | null>;
  openDiffPrompt: (hash: string) => void;
  closeDiffPrompt: () => void;
  loadGraph: () => Promise<void>;
  loadMoreGraph: () => Promise<void>;
  loadHistory: (maxCount: number) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  loadBranches: () => Promise<void>;
  loadStashes: () => Promise<void>;
  loadWorktrees: () => Promise<void>;
  showCommitDetail: (hash: string) => Promise<void>;
  closeCommitDetail: () => void;
  selectedBranches: Accessor<string[]>;
  isAllBranchesSelected: Accessor<boolean>;
  toggleBranchSelection: (branchName: string) => void;
  selectAllBranches: () => void;
}

const GitContext = createContext<GitContextValue>();

export function useGit(): GitContextValue {
  const ctx = useContext(GitContext);
  if (!ctx) throw new Error("useGit must be used within GitProvider");
  return ctx;
}

export function GitProvider(props: ParentProps & { initialPath?: string | null }) {
  const [activeView, setActiveView] = createSignal<GitView>(props.initialPath ? "graph" : "dashboard");
  const [repoPath, setRepoPath] = createSignal<string | null>(props.initialPath ?? null);
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [branches, setBranches] = createSignal<GitBranch[]>([]);
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [historyHasMore, setHistoryHasMore] = createSignal(true);
  let historyPage = 0;
  const [graph, setGraph] = createSignal<GitGraphEntry[]>([]);
  const [graphHasMore, setGraphHasMore] = createSignal(true);
  const [graphLoading, setGraphLoading] = createSignal(false);
  let graphPage = 0; // non-reactive page counter for --skip
  const [stashes, setStashes] = createSignal<GitStashEntry[]>([]);
  const [worktrees, setWorktrees] = createSignal<GitWorktree[]>([]);
  const [selectedBranches, setSelectedBranches] = createSignal<string[]>(["all"]);

  const isAllBranchesSelected = createMemo(() => {
    const sb = selectedBranches();
    return sb.length === 0 || sb.includes("all");
  });
  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(null);
  const [selectedDiffFile, setSelectedDiffFile] = createSignal<string | null>(null);
  const [diffResult, setDiffResult] = createSignal<GitDiff | null>(null);
  const [diffMode, setDiffMode] = createSignal<"staged" | "unstaged" | "commit" | "compare">("unstaged");
  const [diffCommitHash, setDiffCommitHash] = createSignal<string | null>(null);
  const [compareSourceHash, setCompareSourceHash] = createSignal<string | null>(null);
  const [diffCompareCommits, setDiffCompareCommits] = createSignal<{ from: string; to: string } | null>(null);
  const [diffPromptHash, setDiffPromptHash] = createSignal<string | null>(null);

  function openDiffPrompt(hash: string) {
    setDiffPromptHash(hash);
  }

  function closeDiffPrompt() {
    setDiffPromptHash(null);
  }

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal<{ message: string; type: "success" | "error" } | null>(null);
  const [shellAvail, setShellAvail] = createSignal(false);

  onMount(() => {
    if (props.initialPath) {
      openRepo(props.initialPath);
    }
    setShellAvail(git.hasShellPlugin());
  });

  let toastTimer: ReturnType<typeof setTimeout> | null = null;

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
        const c = await git.gitLog(path, 100);
        setCommits(c);
        setHistoryHasMore(c.length >= 100);
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
    setActiveView("graph");
    setGraph([]);
    setGraphHasMore(true);
    setGraphLoading(false);
    setStashes([]);
    setWorktrees([]);
    setCommitDetail(null);
    setSelectedDiffFile(null);
    setDiffResult(null);
    refresh();
    loadGraph();
  }

  function backToDashboard() {
    setRepoPath(null);
    setStatus(null);
    setBranches([]);
    setCommits([]);
    setGraph([]);
    setGraphHasMore(true);
    setGraphLoading(false);
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

  let diffReqId = 0;

  async function loadDiff(filePath: string, mode: "staged" | "unstaged" | "commit" | "compare", commitHash?: string) {
    const myReq = ++diffReqId;
    setSelectedDiffFile(filePath === "." ? null : filePath);
    setDiffMode(mode);
    setDiffCommitHash(commitHash ?? null);
    if (mode === "commit" && commitHash) {
      setDiffCompareCommits({ from: `${commitHash.slice(0, 7)}~1`, to: commitHash.slice(0, 7) });
    } else if (mode === "staged" || mode === "unstaged") {
      setDiffCompareCommits(null);
    }
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
      if (myReq !== diffReqId) return;
      setDiffResult(diff);
      if (activeView() !== "diff") setActiveView("diff");
    } catch (err) {
      if (myReq !== diffReqId) return;
      showToast(`Failed to load diff: ${err}`, "error");
    }
  }

  async function loadDiffCompare(fromHash: string, toHash: string, filePath: string = ".") {
    const myReq = ++diffReqId;
    setSelectedDiffFile(filePath === "." ? null : filePath);
    setDiffMode("compare");
    setDiffCommitHash(toHash);
    setDiffCompareCommits({ from: fromHash, to: toHash });
    setDiffResult(null);
    const p = repoPath();
    if (!p) return;
    try {
      const diff = await git.gitDiffBetween(p, fromHash, toHash, filePath);
      if (myReq !== diffReqId) return;
      setDiffResult(diff);
      if (activeView() !== "diff") setActiveView("diff");
    } catch (err) {
      if (myReq !== diffReqId) return;
      showToast(`Failed to load diff comparison: ${err}`, "error");
    }
  }

  async function loadDiffWithCurrent(commitHash: string, filePath: string = ".") {
    const myReq = ++diffReqId;
    setSelectedDiffFile(filePath === "." ? null : filePath);
    setDiffMode("compare");
    setDiffCommitHash(commitHash);
    setDiffCompareCommits({ from: commitHash, to: "HEAD" });
    setDiffResult(null);
    const p = repoPath();
    if (!p) return;
    try {
      const diff = await git.gitDiffBetween(p, commitHash, "HEAD", filePath);
      if (myReq !== diffReqId) return;
      setDiffResult(diff);
      if (activeView() !== "diff") setActiveView("diff");
    } catch (err) {
      if (myReq !== diffReqId) return;
      showToast(`Failed to load diff with current: ${err}`, "error");
    }
  }

  async function loadDiffWithWorkingTree(commitHash: string, filePath: string = ".") {
    const myReq = ++diffReqId;
    setSelectedDiffFile(filePath === "." ? null : filePath);
    setDiffMode("compare");
    setDiffCommitHash(commitHash);
    setDiffCompareCommits({ from: commitHash, to: "Working Tree" });
    setDiffResult(null);
    const p = repoPath();
    if (!p) return;
    try {
      const diff = await git.gitDiffCommitWithWorkingTree(p, commitHash, filePath);
      if (myReq !== diffReqId) return;
      setDiffResult(diff);
      if (activeView() !== "diff") setActiveView("diff");
    } catch (err) {
      if (myReq !== diffReqId) return;
      showToast(`Failed to load diff with working tree: ${err}`, "error");
    }
  }

  const GRAPH_PAGE_SIZE = 1000;

  async function loadGraph(overrideBranches?: string[]) {
    const p = repoPath();
    if (!p) return;
    const bList = overrideBranches ?? selectedBranches();
    setGraphLoading(true);
    graphPage = 0;
    try {
      const g = await git.gitGraph(p, GRAPH_PAGE_SIZE, 0, bList);
      setGraph(g);
      graphPage = 1;
      setGraphHasMore(g.length >= GRAPH_PAGE_SIZE);
    } catch (err) {
      showToast(`Failed to load graph: ${err}`, "error");
    } finally {
      setGraphLoading(false);
    }
  }

  async function loadMoreGraph() {
    const p = repoPath();
    if (!p || graphLoading() || !graphHasMore()) return;
    setGraphLoading(true);
    try {
      const g = await git.gitGraph(p, GRAPH_PAGE_SIZE, graphPage * GRAPH_PAGE_SIZE, selectedBranches());
      if (g.length > 0) {
        setGraph([...graph(), ...g]);
        graphPage++;
      }
      setGraphHasMore(g.length >= GRAPH_PAGE_SIZE);
    } catch (err) {
      showToast(`Failed to load more graph: ${err}`, "error");
    } finally {
      setGraphLoading(false);
    }
  }

  const HISTORY_PAGE_SIZE = 100;
  let historyLoading = false;

  async function loadHistory(maxCount: number = 100, overrideBranches?: string[]) {
    const p = repoPath();
    if (!p) return;
    const bList = overrideBranches ?? selectedBranches();
    try {
      const c = await git.gitLog(p, maxCount, 0, bList);
      setCommits(c);
      setHistoryHasMore(c.length >= maxCount);
    } catch {}
  }

  async function loadMoreHistory() {
    const p = repoPath();
    if (!p || !historyHasMore() || historyLoading) return;
    historyLoading = true;
    try {
      const offset = commits().length;
      const c = await git.gitLog(p, HISTORY_PAGE_SIZE, offset, selectedBranches());
      if (c.length > 0) {
        setCommits((prev) => [...prev, ...c]);
      }
      setHistoryHasMore(c.length >= HISTORY_PAGE_SIZE);
    } catch {} finally {
      historyLoading = false;
    }
  }

  function selectAllBranches() {
    setSelectedBranches(["all"]);
    refreshHistoryAndGraph(["all"]);
  }

  function toggleBranchSelection(branchName: string) {
    if (branchName === "all") {
      selectAllBranches();
      return;
    }

    const current = selectedBranches().filter((b) => b !== "all");
    let next: string[];
    if (current.includes(branchName)) {
      next = current.filter((b) => b !== branchName);
      if (next.length === 0) next = ["all"];
    } else {
      next = [...current, branchName];
    }
    setSelectedBranches(next);
    refreshHistoryAndGraph(next);
  }

  async function refreshHistoryAndGraph(branchesToUse?: string[]) {
    await loadGraph(branchesToUse);
    await loadHistory(100, branchesToUse);
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

  function closeCommitDetail() {
    setCommitDetail(null);
  }

  const ctx: GitContextValue = {
    activeView, switchView,
    repoPath, openRepo, backToDashboard,
    status, branches, commits, historyHasMore, graph, graphHasMore, graphLoading,
    stashes, worktrees, commitDetail,
    selectedBranches, isAllBranchesSelected, toggleBranchSelection, selectAllBranches,
    selectedDiffFile, selectDiffFile: setSelectedDiffFile,
    diffResult, diffMode, diffCommitHash, compareSourceHash, setCompareSourceHash, diffCompareCommits, setDiffMode,
    loading, error, toast, shellAvailable: shellAvail,
    refresh, stage, unstage, stageAll, unstageAll, commit,
    push, pull, fetchRemote,
    createBranch, deleteBranch, checkout, merge, cherryPick,
    stash, stashPop, stashDrop,
    addWorktree, removeWorktree,
    loadDiff, loadDiffCompare, loadDiffWithCurrent, loadDiffWithWorkingTree,
    diffPromptHash, openDiffPrompt, closeDiffPrompt,
    loadGraph, loadMoreGraph, loadHistory, loadMoreHistory, loadBranches, loadStashes, loadWorktrees,
    showCommitDetail, closeCommitDetail,
  };

  return <GitContext.Provider value={ctx}>{props.children}</GitContext.Provider>;
}
