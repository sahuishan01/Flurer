import { createSignal, createMemo, For, Show } from "solid-js";
import { useGit } from "../context";
import { Card, Button, EmptyState, ConfirmDialog } from "./shared";
import { S } from "../styles";

export function BranchesView() {
  const ctx = useGit();
  const [showCreate, setShowCreate] = createSignal(false);
  const [newBranchName, setNewBranchName] = createSignal("");
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [mergeTarget, setMergeTarget] = createSignal<string | null>(null);

  const currentBranch = createMemo(() => ctx.branches().find((b) => b.is_current));

  async function handleCreate() {
    const name = newBranchName().trim();
    if (!name) return;
    await ctx.createBranch(name);
    setNewBranchName("");
    setShowCreate(false);
  }

  async function handleDelete() {
    const name = deleteTarget();
    if (name) await ctx.deleteBranch(name);
    setDeleteTarget(null);
  }

  async function handleCheckout(name: string) {
    await ctx.checkout(name);
  }

  async function handleMerge() {
    const name = mergeTarget();
    if (name) await ctx.merge(name);
    setMergeTarget(null);
  }

  return (
    <div style={{ padding: "16px 24px" }}>
      <Show when={currentBranch()}>
        <Card>
          <div style={S.cardHeader}>Current Branch</div>
          <div style={{ "font-size": "14px", "font-weight": 600, color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace" }}>
            {currentBranch()!.name}
            <Show when={currentBranch()!.upstream}>
              <span style={{ "font-weight": 400, color: "var(--text-muted, #888)", "margin-left": "8px", "font-size": "12px" }}>
                → {currentBranch()!.upstream}
              </span>
            </Show>
          </div>
        </Card>
      </Show>

      <Card>
        <div style={S.cardHeader}>
          <span>All Branches ({ctx.branches().length})</span>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(!showCreate())}>
            {showCreate() ? "Cancel" : "New Branch"}
          </Button>
        </div>

        <Show when={showCreate()}>
          <div style={{ display: "flex", gap: "8px", "margin-bottom": "12px" }}>
            <input
              type="text"
              placeholder="Branch name"
              value={newBranchName()}
              onInput={(e) => setNewBranchName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              style={{ ...S.input, flex: 1 }}
            />
            <Button variant="primary" onClick={handleCreate}>Create</Button>
          </div>
        </Show>

        <Show when={ctx.branches().length === 0}>
          <EmptyState message="No branches found." />
        </Show>

        <For each={ctx.branches()}>
          {(branch) => (
            <div style={{ ...S.fileRow, padding: "8px 0" }}>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <span style={{ "font-family": "Space Mono, monospace", "font-size": "13px", color: branch.is_current ? "var(--accent-color, #f59e0b)" : "var(--text-color)" }}>
                  {branch.name}
                </span>
                <Show when={branch.upstream}>
                  <span style={{ "font-size": "11px", color: "var(--text-muted, #888)", "margin-left": "8px" }}>
                    → {branch.upstream}
                  </span>
                </Show>
              </div>
              <div style={{ display: "flex", gap: "6px", "flex-shrink": 0 }}>
                <Show when={!branch.is_current}>
                  <Button size="sm" onClick={() => handleCheckout(branch.name)}>Checkout</Button>
                  <Button size="sm" onClick={() => setMergeTarget(branch.name)}>Merge</Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleteTarget(branch.name)}>Delete</Button>
                </Show>
                <Show when={branch.is_current}>
                  <span style={{ "font-size": "11px", color: "var(--accent-color, #f59e0b)", padding: "4px 0" }}>HEAD</span>
                </Show>
              </div>
            </div>
          )}
        </For>
      </Card>

      <ConfirmDialog
        open={deleteTarget() !== null}
        message={`Delete branch "${deleteTarget()}"?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        danger
      />

      <ConfirmDialog
        open={mergeTarget() !== null}
        message={`Merge "${mergeTarget()}" into current branch?`}
        onConfirm={handleMerge}
        onCancel={() => setMergeTarget(null)}
      />
    </div>
  );
}
