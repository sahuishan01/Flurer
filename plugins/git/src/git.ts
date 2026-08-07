import { invoke } from "@tauri-apps/api/core";
import type {
  GitStatus, GitChange, GitCommit, GitBranch, GitGraphEntry,
  GitDiff, DiffHunk, DiffLine, GitStashEntry, GitWorktree, GitCommitDetail,
} from "./types";

let shellAvailable: boolean | null = null;

function getShell() {
  const win = window as any;
  const shell = win.TauriShell || win.__TAURI_PLUGIN_SHELL__ || win.__TAURI__?.shell;
  return shell?.Command || null;
}

function stripAnsi(output: string): string {
  // eslint-disable-next-line no-control-regex
  return output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

async function execGit(repoPath: string, ...args: string[]): Promise<string> {
  const Command = getShell();
  if (Command) {
    // -c color.ui=never guarantees machine-readable output regardless of the
    // user's global git config (color.ui=always would otherwise inject ANSI
    // escape codes that break every diff parser).
    const result = await Command.create("git", ["-C", repoPath, "-c", "color.ui=never", ...args]).execute({ windowsHide: true });
    // Exit code 0: success / no diffs
    // Exit code 1: differences found (standard git diff exit code)
    if (result.code !== 0 && result.code !== 1) {
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
    let filePath = line.substring(3);

    if (filePath.includes(" -> ")) {
      const parts = filePath.split(" -> ");
      filePath = parts[parts.length - 1].replace(/^"|"$/g, "");
    } else {
      filePath = filePath.replace(/^"|"$/g, "");
    }

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

export async function gitLog(
  repoPath: string,
  maxCount: number,
  skip: number = 0,
  selectedBranches?: string[]
): Promise<GitCommit[]> {
  const Command = getShell();
  if (Command) {
    const branchArgs = (!selectedBranches || selectedBranches.length === 0 || selectedBranches.includes("all"))
      ? ["--all"]
      : selectedBranches;
    const out = await execGit(repoPath, "log", ...branchArgs, `--max-count=${maxCount}`, `--skip=${skip}`, "--format=%H%x1f%s%x1f%an%x1f%at");
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, message, author, timestamp] = line.split("\x1f");
      return { hash, message, author, timestamp: parseInt(timestamp, 10) };
    });
  }

  return invoke<GitCommit[]>("git_log", { repoPath, maxCount, skip, selectedBranches: selectedBranches ?? null });
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
    const out = await execGit(repoPath, "branch", "-vv", "--format=%(refname:short)\x1f%(HEAD)\x1f%(upstream:short)");
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const [name, isCurrent, upstream] = line.split("\x1f");
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
  const files: DiffFile[] = [];
  const allHunks: DiffHunk[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  if (!output || !output.trim()) {
    return { files: [], hunks: [] };
  }

  // Normalize CRLF to LF so Windows diff output matches regexes,
  // and strip any residual ANSI escape sequences
  const lines = stripAnsi(output).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    if (rawLine.startsWith("diff --git ") || rawLine.startsWith("diff --no-index ")) {
      const prefix = rawLine.startsWith("diff --git ") ? "diff --git " : "diff --no-index ";
      const cleanLine = rawLine.substring(prefix.length).trim();
      let oldPath = "";
      let newPath = "";
      const match = cleanLine.match(/^(?:"?a\/(.*?)"?)\s+(?:"?b\/(.*?)"?)$/);
      if (match) {
        oldPath = match[1].replace(/^"|"$/g, "");
        newPath = match[2].replace(/^"|"$/g, "");
      } else {
        const parts = cleanLine.split(" ");
        if (parts.length >= 2) {
          oldPath = parts[0].replace(/^"?a\//, "").replace(/^"|"$/g, "");
          newPath = parts[1].replace(/^"?b\//, "").replace(/^"|"$/g, "");
        }
      }
      currentFile = { oldPath, newPath, hunks: [], binary: false };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (currentFile && rawLine.startsWith("Binary files ")) {
      currentFile.binary = true;
      continue;
    }

    const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      currentHunk = {
        old_start: parseInt(hunkMatch[1], 10),
        old_lines: parseInt(hunkMatch[2] || "1", 10),
        new_start: parseInt(hunkMatch[3], 10),
        new_lines: parseInt(hunkMatch[4] || "1", 10),
        lines: [],
      };
      allHunks.push(currentHunk);
      if (!currentFile) {
        currentFile = { oldPath: "", newPath: "", hunks: [], binary: false };
        files.push(currentFile);
      }
      currentFile.hunks.push(currentHunk);
      continue;
    }

if (currentHunk) {
        if (rawLine.startsWith("--- ") || rawLine.startsWith("+++ ") || rawLine.startsWith("index ") || rawLine.startsWith("mode ") || rawLine.startsWith("new file mode") || rawLine.startsWith("new file") || rawLine.startsWith("deleted file")) {
          continue;
        }
        // "\ No newline at end of file" marker — annotation, not a code line
        if (rawLine.startsWith("\\")) {
          continue;
        }
        if (rawLine.startsWith("+")) {
          currentHunk.lines.push({ origin: "+", content: rawLine.substring(1) });
        } else if (rawLine.startsWith("-")) {
          currentHunk.lines.push({ origin: "-", content: rawLine.substring(1) });
        } else if (rawLine.startsWith(" ")) {
          currentHunk.lines.push({ origin: " ", content: rawLine.substring(1) });
        }
      }
  }

  return { files, hunks: allHunks };
}

export async function gitUntrackedFiles(repoPath: string): Promise<string[]> {
  const Command = getShell();
  if (Command) {
    const out = await execGit(repoPath, "ls-files", "--others", "--exclude-standard");
    return out.trim().split("\n").filter(Boolean);
  }
  return invoke<string[]>("git_untracked_files", { repoPath });
}

export async function gitDiff(repoPath: string, filePath: string = "."): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    const args = ["diff"];
    if (filePath && filePath !== ".") args.push("--", filePath);
    let out = await execGit(repoPath, ...args);

    // Fallback 1: If empty and specific file requested, check staged diff
    if ((!out || !out.trim()) && filePath && filePath !== ".") {
      try {
        const stagedArgs = ["diff", "--cached", "--", filePath];
        out = await execGit(repoPath, ...stagedArgs);
      } catch {}
    }

    // Fallback 2: If still empty and specific file requested, check untracked file via --no-index
    if ((!out || !out.trim()) && filePath && filePath !== ".") {
      try {
        out = await execGit(repoPath, "diff", "--no-index", "--", "/dev/null", filePath);
      } catch {}
    }
    const parsed = parseDiff(out);

    // "All changes" mode: git diff never includes untracked files, so append
    // their /dev/null diffs so they show up in the diff section too
    if (!filePath || filePath === ".") {
      try {
        const untracked = await gitUntrackedFiles(repoPath);
        for (const u of untracked) {
          try {
            const uOut = await execGit(repoPath, "diff", "--no-index", "--", "/dev/null", u);
            const uParsed = parseDiff(uOut);
            parsed.files.push(...uParsed.files);
            parsed.hunks.push(...uParsed.hunks);
          } catch {}
        }
      } catch {}
    }
    return parsed;
  }
  return invoke<GitDiff>("git_diff", { repoPath, filePath });
}

export async function gitDiffStaged(repoPath: string, filePath: string = "."): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    const args = ["diff", "--cached"];
    if (filePath && filePath !== ".") args.push("--", filePath);
    let out = await execGit(repoPath, ...args);

    // Fallback: If empty and specific file requested, check unstaged diff
    if ((!out || !out.trim()) && filePath && filePath !== ".") {
      try {
        const unstagedArgs = ["diff", "--", filePath];
        out = await execGit(repoPath, ...unstagedArgs);
      } catch {}
    }
    return parseDiff(out);
  }
  return invoke<GitDiff>("git_diff_staged", { repoPath, filePath });
}

export async function gitDiffCommit(repoPath: string, commitHash: string, filePath: string = "."): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    let out = "";
    try {
      const args = ["show", "-m", "--patch", "--format=", commitHash];
      if (filePath && filePath !== ".") args.push("--", filePath);
      out = await execGit(repoPath, ...args);
    } catch {
      const args = ["diff", `${commitHash}~1`, commitHash];
      if (filePath && filePath !== ".") args.push("--", filePath);
      out = await execGit(repoPath, ...args);
    }
    return parseDiff(out);
  }
  return invoke<GitDiff>("git_diff_commit", { repoPath, commitHash, filePath });
}

export async function gitDiffBetween(repoPath: string, fromHash: string, toHash: string, filePath: string = "."): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    const args = ["diff", fromHash, toHash];
    if (filePath && filePath !== ".") args.push("--", filePath);
    const out = await execGit(repoPath, ...args);
    return parseDiff(out);
  }
  return invoke<GitDiff>("git_diff_between", { repoPath, fromHash, toHash, filePath });
}

export async function gitDiffCommitWithWorkingTree(repoPath: string, commitHash: string, filePath: string = "."): Promise<GitDiff> {
  const Command = getShell();
  if (Command) {
    const args = ["diff", commitHash];
    if (filePath && filePath !== ".") args.push("--", filePath);
    const out = await execGit(repoPath, ...args);
    return parseDiff(out);
  }
  return invoke<GitDiff>("git_diff_between", { repoPath, fromHash: commitHash, toHash: "", filePath });
}

// ---- Graph ----

export async function gitGraph(
  repoPath: string,
  maxCount: number,
  skip: number = 0,
  selectedBranches?: string[]
): Promise<GitGraphEntry[]> {
  const Command = getShell();
  if (Command) {
    const branchArgs = (!selectedBranches || selectedBranches.length === 0 || selectedBranches.includes("all"))
      ? ["--all"]
      : selectedBranches;
    const out = await execGit(repoPath, "log", ...branchArgs, `--max-count=${maxCount}`, `--skip=${skip}`, "--topo-order", "--format=%H%x1f%P%x1f%s%x1f%an%x1f%at%x1f%D");
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, parentsStr, message, author, timestamp, refsStr] = line.split("\x1f");
      const parents = parentsStr ? parentsStr.split(" ") : [];
      const refs = refsStr ? refsStr.split(",").map((r) => r.trim().split(" ").pop()!).filter(Boolean) : [];
      return { hash, message, author, timestamp: parseInt(timestamp, 10), parents, refs };
    });
  }

  return invoke<GitGraphEntry[]>("git_graph", { repoPath, maxCount, skip, selectedBranches: selectedBranches ?? null });
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
    const out = await execGit(repoPath, "stash", "list", "--format=%gd%x1f%gs%x1f%H%x1f%ci");
    return out.trim().split("\n").filter(Boolean).map((line, i) => {
      const [ref, message, hash, timestamp] = line.split("\x1f");
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
        current = { path: line.substring(9), locked: false };
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
    const out = await execGit(repoPath, "show", "--format=%H%x1f%s%x1f%an%x1f%ae%x1f%at%x1f%P", "--no-patch", commitHash);
    const [hash, message, author, email, timestamp, parentHashes] = out.trim().split("\x1f");
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
