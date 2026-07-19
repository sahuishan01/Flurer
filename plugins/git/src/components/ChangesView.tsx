import { createSignal, createMemo, For, Show } from "solid-js";
import { useGit } from "../context";
import { statusColor } from "../utils";
import { Badge, Button, Card, EmptyState } from "./shared";
import { S } from "../styles";

export function ChangesView() {
  const ctx = useGit();
  const [commitMsg, setCommitMsg] = createSignal("");

  const stagedFiles = createMemo(() => ctx.status()?.changes.filter((c) => c.staged) ?? []);
  const unstagedFiles = createMemo(() => ctx.status()?.changes.filter((c) => !c.staged && c.status !== "??") ?? []);
  const untrackedFiles = createMemo(() => ctx.status()?.changes.filter((c) => c.status === "??") ?? []);

  async function handleCommit() {
    const msg = commitMsg().trim();
    if (!msg) return;
    await ctx.commit(msg);
    setCommitMsg("");
  }

  function handleFileClick(path: string, staged: boolean) {
    ctx.loadDiff(path, staged ? "staged" : "unstaged");
  }

  return (
    <div style={{ padding: "16px 24px" }}>
      <Show when={ctx.loading() && !ctx.status()}>
        <EmptyState message="Loading repository status..." />
      </Show>

      <Show when={ctx.status()}>
        <Show when={stagedFiles().length > 0}>
          <Card>
            <div style={S.cardHeader}>
              <span>Staged<Badge variant="staged" count={stagedFiles().length} /></span>
              <Button size="sm" onClick={ctx.unstageAll}>Unstage All</Button>
            </div>
            <For each={stagedFiles()}>
              {(f) => (
                <div style={S.fileRow}>
                  <span style={{ cursor: "pointer", flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }} onClick={() => handleFileClick(f.path, true)}>
                    <span style={{ color: statusColor(f.status), "font-family": "Space Mono, monospace", "margin-right": "8px", "font-size": "12px" }}>{f.status}</span>
                    {f.path}
                  </span>
                  <Button size="sm" onClick={() => ctx.unstage(f.path)}>Unstage</Button>
                </div>
              )}
            </For>
          </Card>
        </Show>

        <Show when={unstagedFiles().length > 0}>
          <Card>
            <div style={S.cardHeader}>
              <span>Changes<Badge variant="unstaged" count={unstagedFiles().length} /></span>
              <Button size="sm" onClick={ctx.stageAll}>Stage All</Button>
            </div>
            <For each={unstagedFiles()}>
              {(f) => (
                <div style={S.fileRow}>
                  <span style={{ cursor: "pointer", flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }} onClick={() => handleFileClick(f.path, false)}>
                    <span style={{ color: statusColor(f.status), "font-family": "Space Mono, monospace", "margin-right": "8px", "font-size": "12px" }}>{f.status}</span>
                    {f.path}
                  </span>
                  <Button variant="primary" size="sm" onClick={() => ctx.stage(f.path)}>Stage</Button>
                </div>
              )}
            </For>
          </Card>
        </Show>

        <Show when={untrackedFiles().length > 0}>
          <Card>
            <div style={S.cardHeader}>
              <span>Untracked<Badge variant="untracked" count={untrackedFiles().length} /></span>
            </div>
            <For each={untrackedFiles()}>
              {(f) => (
                <div style={S.fileRow}>
                  <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    <span style={{ color: "#f87171", "font-family": "Space Mono, monospace", "margin-right": "8px", "font-size": "12px" }}>?</span>
                    {f.path}
                  </span>
                  <Button variant="primary" size="sm" onClick={() => ctx.stage(f.path)}>Stage</Button>
                </div>
              )}
            </For>
          </Card>
        </Show>

        <Show when={stagedFiles().length === 0 && unstagedFiles().length === 0 && untrackedFiles().length === 0}>
          <EmptyState message="Working tree is clean." />
        </Show>

        <Show when={stagedFiles().length > 0}>
          <Card>
            <div style={S.cardHeader}>Commit</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="Commit message"
                value={commitMsg()}
                onInput={(e) => setCommitMsg(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommit()}
                style={{ ...S.commitInput, flex: 1 }}
              />
              <Button variant="primary" onClick={handleCommit} disabled={!commitMsg().trim()}>Commit</Button>
            </div>
          </Card>
        </Show>
      </Show>
    </div>
  );
}
