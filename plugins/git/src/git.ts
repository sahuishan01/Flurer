import { invoke } from "@tauri-apps/api/core";
import type {
  GitStatus, GitChange, GitCommit, GitBranch, GitGraphEntry,
  GitDiff, DiffHunk, DiffLine, GitStashEntry, GitWorktree, GitCommitDetail,
} from "./types";

let shellAvailable: boolean | null = null;

function getShell() {
  if (shellAvailable === null) {
    shellAvailable = !!(window as any).__TAURI__?.shell?.Command || !!(window as any).TauriShell?.Command;
  }
  if (!shellAvailable) return null;
  const shell = (window as any).__TAURI__?.shell || (window as any).TauriShell;
  return shell?.Command || null;
}

async function execGit(repoPath: string, ...args: string[]): Promise<string> {
  const Command = getShell();
  if (Command) {
    const result = await Command.create("git", ["-C", repoPath, ...args]).execute({ windowsHide: true });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `git exited with code ${result.code}`);
    }
    return result.stdout;
  }
  // Fallback: try invoke (requires Rust commands)
  throw new Error("Shell plugin not available");
}

function parsePorcelainStatus(output: string): GitChange[] {
  const changes: GitChange[] = [];
  for (const line of output.split("\n")) {
    if (!line || line.startsWith("##")) continue;
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePath = line.substring(3);

    if (indexStatus !== " " && indexStatus !== "?") {
      changes.push({ path: filePath, status: indexStatus, staged: true });
    }
    if (workTreeStatus !== " " && workTreeStatus !== "?") {
      changes.push({ path: filePath, status: workTreeStatus, staged: false });
    }
    if (indexStatus === "?" && workTreeStatus === "?") {
      changes.push({ path: filePath, status: "??", staged: false });
    }
  }
  return changes;
}

// ---- Public API ----

export async function gitRepoStatus(repoPath: string): Promise<GitStatus> {
  const Command = getShell();
  if (Command) {
    const [statusOut, branchOut] = await Promise.all([
      execGit(repoPath, "status", "--porcelain"),
      execGit(repoPath, "branch", "--show-current").catch(() => ""),
    ]);

    const branch = branchOut.trim() || "HEAD";
    const changes = parsePorcelainStatus(statusOut);

    let ahead = 0, behind = 0, hasRemote = false;
    try {
      const ab = await execGit(repoPath, "rev-list", "--left-right", "--count", `HEAD...@{upstream}`);
      const [a, b] = ab.trim().split("\t").map(Number);
      ahead = a;
      behind = b;
      hasRemote = true;
    } catch {}

    return { branch, ahead, behind, hasRemote, changes };
  }

  return invoke<GitStatus>("git_repo_status", { repoPath });
}

export async function gitLog(repoPath: string, maxCount: number): Promise<GitCommit[]> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "log", `--max-count=${maxCount}`, "--format=%H|%s|%an|%at");
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, message, author, timestamp] = line.split("|");
      return { hash, message, author, timestamp: parseInt(timestamp, 10) };
    });
  }

  return invoke<GitCommit[]>("git_log", { repoPath, maxCount });
}

export async function gitStage(repoPath: string, filePath: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "add", filePath);
    return;
  }
  await invoke("git_stage", { repoPath, filePath });
}

export async function gitUnstage(repoPath: string, filePath: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "restore", "--staged", filePath);
    return;
  }
  await invoke("git_unstage", { repoPath, filePath });
}

export async function gitCommit(repoPath: string, message: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "commit", "-m", message);
    return;
  }
  await invoke("git_commit", { repoPath, message });
}

export async function gitPush(repoPath: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "push");
    return;
  }
  await invoke("git_push", { repoPath });
}

export async function gitPull(repoPath: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "pull");
    return;
  }
  await invoke("git_pull", { repoPath });
}

export async function gitFetch(repoPath: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "fetch", "--all", "--prune");
    return;
  }
  await invoke("git_fetch", { repoPath });
}

export async function gitBranches(repoPath: string): Promise<GitBranch[]> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "branch", "-vv", "--format=%(refname:short)|%(HEAD)|%(upstream:short)");
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const [name, isCurrent, upstream] = line.split("|");
      return { name, is_current: isCurrent === "*", upstream: upstream || null };
    });
  }

  return invoke<GitBranch[]>("git_branches", { repoPath });
}

export async function gitBranchCreate(repoPath: string, name: string, startPoint?: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    const args = ["branch", name];
    if (startPoint) args.push(startPoint);
    await execGit(repoPath, ...args);
    return;
  }
  await invoke("git_branch_create", { repoPath, name, startPoint: startPoint ?? null });
}

export async function gitBranchDelete(repoPath: string, name: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "branch", "-d", name);
    return;
  }
  await invoke("git_branch_delete", { repoPath, name });
}

export async function gitCheckout(repoPath: string, branch: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "checkout", branch);
    return;
  }
  await invoke("git_checkout", { repoPath, branch });
}

export async function gitMerge(repoPath: string, branch: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "merge", branch);
    return;
  }
  await invoke("git_merge", { repoPath, branch });
}

export async function gitRebase(repoPath: string, branch: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "rebase", branch);
    return;
  }
  await invoke("git_rebase", { repoPath, branch });
}

export async function gitCherryPick(repoPath: string, commitHash: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "cherry-pick", commitHash);
    return;
  }
  await invoke("git_cherry_pick", { repoPath, commitHash });
}

// ---- Diff ----

function parseDiff(output: string): GitDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const rawLine of output.split("\n")) {
    const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      current = {
        old_start: parseInt(hunkMatch[1], 10),
        old_lines: parseInt(hunkMatch[2] || "1", 10),
        new_start: parseInt(hunkMatch[3], 10),
        new_lines: parseInt(hunkMatch[4] || "1", 10),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (current) {
      if (rawLine.startsWith("+")) {
        current.lines.push({ origin: "+", content: rawLine.substring(1) });
      } else if (rawLine.startsWith("-")) {
        current.lines.push({ origin: "-", content: rawLine.substring(1) });
      } else {
        current.lines.push({ origin: " ", content: rawLine.substring(1) || rawLine });
      }
    }
  }

  return { hunks };
}

export async function gitDiff(repoPath: string, filePath: string): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "diff", "--", filePath);
    return parseDiff(out);
  }
  return invoke<GitDiff>("git_diff", { repoPath, filePath });
}

export async function gitDiffStaged(repoPath: string, filePath: string): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "diff", "--cached", "--", filePath);
    return parseDiff(out);
  }
  return invoke<GitDiff>("git_diff_staged", { repoPath, filePath });
}

export async function gitDiffCommit(repoPath: string, commitHash: string, filePath: string): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    try {
      const out = await execGit(repoPath, "diff", `${commitHash}~1`, commitHash, "--", filePath);
      return parseDiff(out);
    } catch {
      const out = await execGit(repoPath, "show", commitHash, "--", filePath);
      return parseDiff(out);
    }
  }
  return invoke<GitDiff>("git_diff_commit", { repoPath, commitHash, filePath });
}

// ---- Graph ----

export async function gitGraph(repoPath: string, maxCount: number): Promise<GitGraphEntry[]> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "log", `--max-count=${maxCount}`, "--format=%H|%P|%s|%an|%at|%D");
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, parentsStr, message, author, timestamp, refsStr] = line.split("|");
      const parents = parentsStr ? parentsStr.split(" ") : [];
      const refs = refsStr ? refsStr.split(",").map((r) => r.trim().split(" ").pop()!).filter(Boolean) : [];
      return { hash, message, author, timestamp: parseInt(timestamp, 10), parents, refs };
    });
  }

  return invoke<GitGraphEntry[]>("git_graph", { repoPath, maxCount });
}

// ---- Stash ----

export async function gitStash(repoPath: string, message?: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    if (message) {
      await execGit(repoPath, "stash", "push", "-m", message);
    } else {
      await execGit(repoPath, "stash");
    }
    return;
  }
  await invoke("git_stash", { repoPath, message: message ?? null });
}

export async function gitStashList(repoPath: string): Promise<GitStashEntry[]> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "stash", "list", "--format=%gd|%gs|%H|%ci");
    return out.trim().split("\n").filter(Boolean).map((line, i) => {
      const [ref, message, hash, timestamp] = line.split("|");
      const index = parseInt(ref.match(/\{(\d+)\}/)?.[1] || String(i), 10);
      return { index, message, hash, timestamp: new Date(timestamp).getTime() / 1000 };
    });
  }

  return invoke<GitStashEntry[]>("git_stash_list", { repoPath });
}

export async function gitStashPop(repoPath: string, index: number): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "stash", "pop", `stash@{${index}}`);
    return;
  }
  await invoke("git_stash_pop", { repoPath, index });
}

export async function gitStashDrop(repoPath: string, index: number): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "stash", "drop", `stash@{${index}}`);
    return;
  }
  await invoke("git_stash_drop", { repoPath, index });
}

// ---- Worktrees ----

export async function gitWorktreeList(repoPath: string): Promise<GitWorktree[]> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "worktree", "list", "--porcelain");
    const worktrees: GitWorktree[] = [];
    let current: Partial<GitWorktree> = {};

    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push(current as GitWorktree);
        current = { path: line.substring(10), locked: false };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.substring(5);
      } else if (line.startsWith("branch ")) {
        current.branch = line.substring(7).replace("refs/heads/", "");
      } else if (line === "locked") {
        current.locked = true;
      }
    }
    if (current.path) worktrees.push(current as GitWorktree);
    return worktrees;
  }

  return invoke<GitWorktree[]>("git_worktree_list", { repoPath });
}

export async function gitWorktreeAdd(repoPath: string, worktreePath: string, branch?: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    const args = ["worktree", "add", worktreePath];
    if (branch) args.push(branch);
    await execGit(repoPath, ...args);
    return;
  }
  await invoke("git_worktree_add", { repoPath, worktreePath, branch: branch ?? null });
}

export async function gitWorktreeRemove(repoPath: string, worktreePath: string): Promise<void> {
  const Command = getShell();
  if (Command) {
    await execGit(repoPath, "worktree", "remove", "--force", worktreePath);
    return;
  }
  await invoke("git_worktree_remove", { repoPath, worktreePath });
}

// ---- Commit Detail ----

export async function gitShow(repoPath: string, commitHash: string): Promise<GitCommitDetail> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "show", "--format=%H|%s|%an|%ae|%at|%P", "--no-patch", commitHash);
    const [hash, message, author, email, timestamp, parentHashes] = out.trim().split("|");
    return {
      hash,
      message,
      author,
      email,
      timestamp: parseInt(timestamp, 10),
      parent_hashes: parentHashes ? parentHashes.split(" ") : [],
    };
  }

  return invoke<GitCommitDetail>("git_show", { repoPath, commitHash });
}

// ---- Utility: detect shell availability ----

export function hasShellPlugin(): boolean {
  return getShell() !== null;
}
