import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useGit } from "../context";
import { formatTimestamp } from "../utils";
import { Card, Button, EmptyState, ConfirmDialog } from "./shared";
import { S } from "../styles";

export function StashView() {
  const ctx = useGit();
  const [showCreate, setShowCreate] = createSignal(false);
  const [stashMsg, setStashMsg] = createSignal("");
  const [dropTarget, setDropTarget] = createSignal<number | null>(null);

  onMount(() => {
    ctx.loadStashes();
  });

  async function handleCreate() {
    await ctx.stash(stashMsg().trim() || undefined);
    setStashMsg("");
    setShowCreate(false);
  }

  async function handleDrop() {
    const idx = dropTarget();
    if (idx !== null) await ctx.stashDrop(idx);
    setDropTarget(null);
  }

  return (
    <div style={{ padding: "16px 24px" }}>
      <Card>
        <div style={S.cardHeader}>
          <span>Stashes ({ctx.stashes().length})</span>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(!showCreate())}>
            {showCreate() ? "Cancel" : "New Stash"}
          </Button>
        </div>

        <Show when={showCreate()}>
          <div style={{ display: "flex", gap: "8px", "margin-bottom": "12px" }}>
            <input
              type="text"
              placeholder="Stash message (optional)"
              value={stashMsg()}
              onInput={(e) => setStashMsg(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              style={{ ...S.input, flex: 1 }}
            />
            <Button variant="primary" onClick={handleCreate}>Stash</Button>
          </div>
        </Show>

        <Show when={ctx.stashes().length === 0}>
          <EmptyState message="No stashes." />
        </Show>

        <For each={ctx.stashes()}>
          {(stash) => (
            <div style={{ ...S.fileRow, padding: "8px 0", "flex-direction": "column", "align-items": "stretch", gap: "4px" }}>
              <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                <div>
                  <code style={{ color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace", "font-size": "12px" }}>stash@{"{"}{stash.index}{"}"}</code>
                  <span style={{ "font-size": "12px", color: "var(--text-muted, #888)", "margin-left": "8px" }}>{formatTimestamp(stash.timestamp)}</span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <Button variant="primary" size="sm" onClick={() => ctx.stashPop(stash.index)}>Pop</Button>
                  <Button variant="danger" size="sm" onClick={() => setDropTarget(stash.index)}>Drop</Button>
                </div>
              </div>
              <Show when={stash.message}>
                <div style={{ "font-size": "12px", color: "var(--text-color)" }}>{stash.message}</div>
              </Show>
            </div>
          )}
        </For>
      </Card>

      <ConfirmDialog
        open={dropTarget() !== null}
        message={`Drop stash@{"{"}${dropTarget()}{"}"}? This cannot be undone.`}
        onConfirm={handleDrop}
        onCancel={() => setDropTarget(null)}
        danger
      />
    </div>
  );
}
