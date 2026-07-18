import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

type GitChange = { path: string; status: string; staged: boolean };
type GitStatus = { branch: string; ahead: number; behind: number; hasRemote: boolean; changes: GitChange[] };
type GitCommit = { hash: string; message: string; author: string; timestamp: number };

function GitIcon(props: { size?: number }) {
  return (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6H9a2 2 0 0 0-2 2v7" />
      <line x1="6" y1="15" x2="9" y2="15" />
      <line x1="18" y1="9" x2="15" y2="9" />
      <path d="M15 6v6a2 2 0 0 1-2 2h-2" />
    </svg>
  );
}

function RefreshIcon(props: { size?: number; class?: string }) {
  return (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

window.registerPlugin({
  id: "git",
  name: "Git Operations",
  description: "View git status, stage/unstage files, commit, push and pull.",
  version: "0.1.0",
  author: "Algosculptor",
  viewRailButton: (props: any) => (
    <button
      type="button"
      class="view-rail-item"
      classList={{ active: props.active }}
      title="Git operations"
      aria-label="Git operations"
      onClick={props.onClick}
    >
      <GitIcon size={19} />
    </button>
  ),
  fullPanel: (props: any) => <GitView {...props} />,
});

function GitView(props: any) {
  const [status, setStatus] = createSignal<GitStatus | null>(null);
  const [commits, setCommits] = createSignal<GitCommit[]>([]);
  const [commitMsg, setCommitMsg] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [statusMsg, setStatusMsg] = createSignal<string | null>(null);

  const repoPath = createMemo(() => {
    const p = props.currentPath;
    if (!p) return null;
    // Walk up to find the .git root — the user's current path is in the repo
    return p;
  });

  const fetchStatus = async () => {
    const path = repoPath();
    if (!path) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const s = await invoke<GitStatus>("git_repo_status", { repoPath: path });
      setStatus(s);
      try {
        const c = await invoke<GitCommit[]>("git_log", { repoPath: path, maxCount: 10 });
        setCommits(c);
      } catch (_) {}
    } catch (err) {
      setStatusMsg(`Not a git repository: ${err}`);
      setStatus(null);
      setCommits([]);
    } finally {
      setLoading(false);
    }
  };

  onMount(fetchStatus);

  const handleStage = async (filePath: string) => {
    try {
      await invoke("git_stage", { repoPath: repoPath(), filePath });
      await fetchStatus();
    } catch (err) {
      setStatusMsg(`Stage failed: ${err}`);
    }
  };

  const handleUnstage = async (filePath: string) => {
    try {
      await invoke("git_unstage", { repoPath: repoPath(), filePath });
      await fetchStatus();
    } catch (err) {
      setStatusMsg(`Unstage failed: ${err}`);
    }
  };

  const handleCommit = async () => {
    const msg = commitMsg().trim();
    if (!msg) return;
    try {
      await invoke("git_commit", { repoPath: repoPath(), message: msg });
      setCommitMsg("");
      setStatusMsg("Committed successfully.");
      await fetchStatus();
    } catch (err) {
      setStatusMsg(`Commit failed: ${err}`);
    }
  };

  const handlePush = async () => {
    try {
      setStatusMsg("Pushing...");
      await invoke("git_push", { repoPath: repoPath() });
      setStatusMsg("Push completed.");
      await fetchStatus();
    } catch (err) {
      setStatusMsg(`Push failed: ${err}`);
    }
  };

  const handlePull = async () => {
    try {
      setStatusMsg("Pulling...");
      await invoke("git_pull", { repoPath: repoPath() });
      setStatusMsg("Pull completed.");
      await fetchStatus();
    } catch (err) {
      setStatusMsg(`Pull failed: ${err}`);
    }
  };

  const stagedFiles = createMemo(() => status()?.changes.filter((c) => c.staged) ?? []);
  const unstagedFiles = createMemo(() => status()?.changes.filter((c) => !c.staged && c.status != "??") ?? []);
  const untrackedFiles = createMemo(() => status()?.changes.filter((c) => c.status == "??") ?? []);

  const S = {
    section: { padding: "0 24px" },
    toolbar: { display: "flex", "align-items": "center", gap: "12px", padding: "12px 0", "flex-wrap": "wrap" as const },
    branchBadge: { display: "flex", "align-items": "center", gap: "6px", padding: "5px 12px", background: "var(--accent-color, #f59e0b)", color: "#000", "border-radius": "20px", "font-size": "13px", "font-weight": 600, "font-family": "Space Mono, monospace" as const },
    badge: { padding: "4px 10px", "border-radius": "4px", "font-size": "11px", "font-weight": 600 },
    stagedBadge: { background: "rgba(34,197,94,0.2)", color: "#4ade80" },
    unstagedBadge: { background: "rgba(59,130,246,0.2)", color: "#60a5fa" },
    untrackedBadge: { background: "rgba(239,68,68,0.2)", color: "#f87171" },
    btn: { padding: "6px 14px", "font-size": "12px", "border-radius": "6px", border: "none", cursor: "pointer", "font-weight": 600 } as any,
    btnPrimary: { background: "var(--accent-color, #f59e0b)", color: "#000" },
    btnSecondary: { background: "rgba(255,255,255,0.1)", color: "var(--text-color)" },
    btnDanger: { background: "rgba(239,68,68,0.2)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" },
    card: { background: "var(--panel-bg)", border: "1px solid var(--border-strong)", "border-radius": "8px", padding: "16px", "margin-bottom": "12px" },
    fileRow: { display: "flex", "align-items": "center", "justify-content": "space-between", padding: "6px 0", "border-bottom": "1px solid var(--border-subtle, rgba(255,255,255,0.04))", "font-size": "13px" },
    commitInput: { width: "100%", padding: "8px 12px", "border-radius": "6px", border: "1px solid var(--border-strong)", background: "var(--bg-color, #1a1a2e)", color: "var(--text-color)", "font-size": "14px", "box-sizing": "border-box" as any },
    statusMsg: { padding: "8px 12px", "border-radius": "6px", "font-size": "13px", "margin-bottom": "8px" },
  };

  return (
    <div class="git-view" style={{ height: "100%", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ ...S.section, "border-bottom": "1px solid var(--border-strong)", "flex-shrink": 0 }}>
        <div style={S.toolbar}>
          <GitIcon size={22} />
          <h2 style={{ margin: 0, "font-size": "18px", "font-weight": 600 }}>Git Operations</h2>
          <Show when={status()}>
            {(s) => (
              <>
                <span style={S.branchBadge}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
                  {s().branch}
                  <Show when={s().hasRemote}>
                    <span style={{ opacity: 0.7, "font-weight": 400 }}>↑{s().ahead} ↓{s().behind}</span>
                  </Show>
                </span>
                <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding: "5px 10px" }} onClick={handlePull} disabled={loading()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style={{ "vertical-align": "middle", "margin-right": "4px" }}><polyline points="21 15 21 21 3 21 3 15" /><polyline points="12 3 12 15" /><polyline points="8 11 12 15 16 11" /></svg>
                  Pull
                </button>
                <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding: "5px 10px" }} onClick={handlePush} disabled={loading()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style={{ "vertical-align": "middle", "margin-right": "4px" }}><polyline points="21 9 21 3 3 3 3 9" /><polyline points="12 21 12 9" /><polyline points="16 13 12 9 8 13" /></svg>
                  Push
                </button>
                <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding: "5px 10px" }} onClick={fetchStatus} disabled={loading()}>
                  <RefreshIcon size={14} />
                </button>
              </>
            )}
          </Show>
          <Show when={!status() && !loading()}>
            <span style={{ "font-size": "13px", color: "var(--text-muted, #888)" }}>Navigate into a git repository to see its status</span>
          </Show>
        </div>
      </div>

      {/* Status message */}
      <Show when={statusMsg()}>
        <div style={{ ...S.section, padding: "8px 24px 0" }}>
          <div style={{ ...S.statusMsg, background: statusMsg()?.includes("failed") || statusMsg()?.includes("Not a git") ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", color: statusMsg()?.includes("failed") || statusMsg()?.includes("Not a git") ? "#f87171" : "#4ade80" }}>
            {statusMsg()}
          </div>
        </div>
      </Show>

      {/* Loading */}
      <Show when={loading() && !status()}>
        <div style={{ ...S.section, padding: "40px", "text-align": "center", color: "var(--text-muted, #888)" }}>
          Checking repository...
        </div>
      </Show>

      {/* Main content */}
      <Show when={status()}>
        <div style={{ ...S.section, flex: 1, overflow: "auto", "padding-bottom": "24px" }}>
          {/* Commits */}
          <Show when={commits().length > 0}>
            <div style={S.card}>
              <h3 style={{ margin: "0 0 10px", "font-size": "14px", "font-weight": 600 }}>Recent Commits</h3>
              <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                <For each={commits()}>
                  {(c) => (
                    <div style={{ display: "flex", "align-items": "flex-start", gap: "8px", "font-size": "12px" }}>
                      <code style={{ color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace", "flex-shrink": 0 }}>{c.hash.slice(0, 7)}</code>
                      <span style={{ flex: 1, color: "var(--text-color)", "word-break": "break-word" }}>{c.message}</span>
                      <span style={{ "flex-shrink": 0, color: "var(--text-muted, #888)" }}>
                        {new Date(c.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Staged changes */}
          <Show when={stagedFiles().length > 0}>
            <div style={S.card}>
              <h3 style={{ margin: "0 0 10px", "font-size": "14px", "font-weight": 600 }}>
                Staged <span style={{ ...S.badge, ...S.stagedBadge, "margin-left": "8px" }}>{stagedFiles().length}</span>
              </h3>
              <For each={stagedFiles()}>
                {(f) => (
                  <div style={S.fileRow}>
                    <span><span style={{ color: "#4ade80", "font-family": "Space Mono, monospace", "margin-right": "8px" }}>{f.status}</span>{f.path}</span>
                    <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding: "2px 8px", "font-size": "11px" }} onClick={() => handleUnstage(f.path)}>Unstage</button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Unstaged changes */}
          <Show when={unstagedFiles().length > 0}>
            <div style={S.card}>
              <h3 style={{ margin: "0 0 10px", "font-size": "14px", "font-weight": 600 }}>
                Changes <span style={{ ...S.badge, ...S.unstagedBadge, "margin-left": "8px" }}>{unstagedFiles().length}</span>
              </h3>
              <For each={unstagedFiles()}>
                {(f) => (
                  <div style={S.fileRow}>
                    <span><span style={{ color: "#60a5fa", "font-family": "Space Mono, monospace", "margin-right": "8px" }}>{f.status}</span>{f.path}</span>
                    <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding: "2px 8px", "font-size": "11px" }} onClick={() => handleStage(f.path)}>Stage</button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Untracked files */}
          <Show when={untrackedFiles().length > 0}>
            <div style={S.card}>
              <h3 style={{ margin: "0 0 10px", "font-size": "14px", "font-weight": 600 }}>
                Untracked <span style={{ ...S.badge, ...S.untrackedBadge, "margin-left": "8px" }}>{untrackedFiles().length}</span>
              </h3>
              <For each={untrackedFiles()}>
                {(f) => (
                  <div style={S.fileRow}>
                    <span><span style={{ color: "#f87171", "font-family": "Space Mono, monospace", "margin-right": "8px" }}>?</span>{f.path}</span>
                    <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding: "2px 8px", "font-size": "11px" }} onClick={() => handleStage(f.path)}>Stage</button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Empty state */}
          <Show when={stagedFiles().length === 0 && unstagedFiles().length === 0 && untrackedFiles().length === 0}>
            <div style={{ ...S.card, "text-align": "center", color: "var(--text-muted, #888)", "font-size": "14px" }}>
              Working tree is clean.
            </div>
          </Show>

          {/* Commit */}
          <Show when={stagedFiles().length > 0}>
            <div style={S.card}>
              <h3 style={{ margin: "0 0 10px", "font-size": "14px", "font-weight": 600 }}>Commit</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Commit message"
                  value={commitMsg()}
                  onInput={(e) => setCommitMsg(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCommit()}
                  style={S.commitInput}
                />
                <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding: "8px 16px" }} disabled={!commitMsg().trim()} onClick={handleCommit}>Commit</button>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
