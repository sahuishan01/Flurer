import { createSignal, For, Show, onMount } from "solid-js";
import { useGit } from "../context";
import { basename } from "../utils";
import { Card, Button, EmptyState, ConfirmDialog } from "./shared";
import { S } from "../styles";

export function WorktreesView() {
  const ctx = useGit();
  const [showAdd, setShowAdd] = createSignal(false);
  const [addPath, setAddPath] = createSignal("");
  const [addBranch, setAddBranch] = createSignal("");
  const [removeTarget, setRemoveTarget] = createSignal<string | null>(null);

  onMount(() => {
    ctx.loadWorktrees();
  });

  async function handleAdd() {
    const p = addPath().trim();
    if (!p) return;
    await ctx.addWorktree(p, addBranch().trim() || undefined);
    setAddPath("");
    setAddBranch("");
    setShowAdd(false);
  }

  async function handleRemove() {
    const p = removeTarget();
    if (p) await ctx.removeWorktree(p);
    setRemoveTarget(null);
  }

  return (
    <div style={{ padding: "16px 24px" }}>
      <Card>
        <div style={S.cardHeader}>
          <span>Worktrees ({ctx.worktrees().length})</span>
          <Button variant="primary" size="sm" onClick={() => setShowAdd(!showAdd())}>
            {showAdd() ? "Cancel" : "Add Worktree"}
          </Button>
        </div>

        <Show when={showAdd()}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-bottom": "12px" }}>
            <input
              type="text"
              placeholder="Worktree path (e.g. ../my-feature)"
              value={addPath()}
              onInput={(e) => setAddPath(e.currentTarget.value)}
              style={S.input}
            />
            <input
              type="text"
              placeholder="Branch name (optional, creates new if needed)"
              value={addBranch()}
              onInput={(e) => setAddBranch(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              style={S.input}
            />
            <Button variant="primary" onClick={handleAdd}>Add</Button>
          </div>
        </Show>

        <Show when={ctx.worktrees().length === 0}>
          <EmptyState message="No worktrees." />
        </Show>

        <For each={ctx.worktrees()}>
          {(wt) => {
            const isMain = wt.path === ctx.repoPath();
            return (
              <div style={{ ...S.fileRow, padding: "10px 0", "flex-direction": "column", "align-items": "stretch", gap: "4px" }}>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <span style={{ "font-weight": 600, "font-size": "13px" }}>{basename(wt.path)}</span>
                      <Show when={isMain}>
                        <span style={{ "font-size": "10px", padding: "1px 6px", "border-radius": "4px", background: "var(--accent-color, #f59e0b)", color: "#000", "font-weight": 600 }}>Main</span>
                      </Show>
                      <Show when={wt.locked}>
                        <span style={{ "font-size": "10px", padding: "1px 6px", "border-radius": "4px", background: "rgba(239,68,68,0.2)", color: "#f87171" }}>Locked</span>
                      </Show>
                    </div>
                    <div style={{ "font-size": "11px", color: "var(--text-muted, #888)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                      {wt.path}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", "flex-shrink": 0 }}>
                    <Show when={wt.branch}>
                      <span style={{ "font-size": "11px", color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace" }}>{wt.branch}</span>
                    </Show>
                    <Show when={!isMain}>
                      <Button variant="danger" size="sm" onClick={() => setRemoveTarget(wt.path)}>Remove</Button>
                    </Show>
                  </div>
                </div>
                <div style={{ "font-size": "11px", color: "var(--text-muted, #888)", "font-family": "Space Mono, monospace" }}>
                  HEAD: {wt.head.slice(0, 7)}
                </div>
              </div>
            );
          }}
        </For>
      </Card>

      <ConfirmDialog
        open={removeTarget() !== null}
        message={`Remove worktree at "${removeTarget()}"? Uncommitted changes will be discarded.`}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
        danger
      />
    </div>
  );
}
