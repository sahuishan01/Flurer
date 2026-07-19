import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useGit } from "../context";
import { formatTimestamp } from "../utils";
import { Card, EmptyState, Button } from "./shared";
import { S } from "../styles";

export function HistoryView() {
  const ctx = useGit();
  const [search, setSearch] = createSignal("");
  const [limit, setLimit] = createSignal(50);

  onMount(() => {
    if (ctx.commits().length === 0) {
      ctx.loadHistory(limit());
    }
  });

  const filteredCommits = createMemo(() => {
    const q = search().toLowerCase();
    const c = ctx.commits();
    if (!q) return c;
    return c.filter((cm) =>
      cm.message.toLowerCase().includes(q) ||
      cm.author.toLowerCase().includes(q) ||
      cm.hash.toLowerCase().includes(q)
    );
  });

  function loadMore() {
    const newLimit = limit() + 50;
    setLimit(newLimit);
    ctx.loadHistory(newLimit);
  }

  return (
    <div style={{ padding: "16px 24px" }}>
      <div style={{ "margin-bottom": "12px" }}>
        <input
          type="text"
          placeholder="Search commits..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          style={{ ...S.input, width: "100%" }}
        />
      </div>

      <Show when={filteredCommits().length === 0}>
        <EmptyState message="No commits found." />
      </Show>

      <Show when={filteredCommits().length > 0}>
        <Card style={{ padding: 0 }}>
          <For each={filteredCommits()}>
            {(c) => (
              <div
                style={{ ...S.fileRow, padding: "8px 12px", cursor: "pointer" }}
                onClick={() => ctx.showCommitDetail(c.hash)}
              >
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "2px" }}>
                    <code style={{ color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace", "font-size": "12px" }}>{c.hash.slice(0, 7)}</code>
                    <span style={{ flex: 1, "font-size": "13px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{c.message}</span>
                  </div>
                  <div style={{ "font-size": "11px", color: "var(--text-muted, #888)" }}>
                    {c.author} · {formatTimestamp(c.timestamp)}
                  </div>
                </div>
              </div>
            )}
          </For>
        </Card>

        <Show when={filteredCommits().length >= limit()}>
          <div style={{ "text-align": "center", "margin-top": "12px" }}>
            <Button onClick={loadMore}>Load More</Button>
          </div>
        </Show>
      </Show>

      <Show when={ctx.commitDetail()}>
        <div style={{ "margin-top": "16px" }}>
          <Card>
            <div style={S.cardHeader}>
              <span>Commit Detail</span>
              <Button size="sm" onClick={() => {
                const d = ctx.commitDetail();
                if (d) {
                  ctx.loadDiff(".", "commit", d.hash);
                }
              }}>View Diff</Button>
            </div>
            <div style={{ "font-size": "13px" }}>
              <div style={{ "margin-bottom": "4px" }}>
                <code style={{ color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace" }}>{ctx.commitDetail()!.hash}</code>
              </div>
              <div style={{ "font-weight": 600, "margin-bottom": "8px" }}>{ctx.commitDetail()!.message}</div>
              <div style={{ color: "var(--text-muted, #888)" }}>
                {ctx.commitDetail()!.author} &lt;{ctx.commitDetail()!.email}&gt;
              </div>
              <div style={{ color: "var(--text-muted, #888)" }}>
                {formatTimestamp(ctx.commitDetail()!.timestamp)}
              </div>
            </div>
          </Card>
        </div>
      </Show>
    </div>
  );
}
