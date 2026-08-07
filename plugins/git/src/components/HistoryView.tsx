import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { useGit } from "../context";
import { formatTimestamp } from "../utils";
import { Card, EmptyState, Button, CommitContextMenu, BranchMultiSelect } from "./shared";
import { S } from "../styles";

export function HistoryView() {
  const ctx = useGit();
  const [search, setSearch] = createSignal("");
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number; hash: string } | null>(null);
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (ctx.commits().length === 0) {
      ctx.loadHistory(100);
    }
    const el = containerRef?.parentElement ?? containerRef;
    if (!el) return;
    const handler = () => {
      if (loadingMore() || !ctx.historyHasMore()) return;
      if (el.scrollTop > 50 && el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
        handleLoadMore();
      }
    };
    el.addEventListener("scroll", handler, { passive: true });
    onCleanup(() => el.removeEventListener("scroll", handler));
  });

  const filteredCommits = createMemo(() => {
    const q = search().trim().toLowerCase();
    const c = ctx.commits();
    if (!q) return c;
    return c.filter((cm) =>
      cm.message.toLowerCase().includes(q) ||
      cm.author.toLowerCase().includes(q) ||
      cm.hash.toLowerCase().includes(q)
    );
  });

  async function handleLoadMore() {
    if (loadingMore() || !ctx.historyHasMore()) return;
    setLoadingMore(true);
    await ctx.loadMoreHistory();
    setLoadingMore(false);
  }

  function handleContextMenu(e: MouseEvent, hash: string) {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY, hash });
  }

  return (
    <div
      ref={containerRef}
      style={{
        padding: "16px 20px",
        width: "100%",
        "max-width": "100%",
        "box-sizing": "border-box",
        display: "flex",
        "flex-direction": "column",
        "align-items": "stretch",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: "10px", "align-items": "center", "margin-bottom": "12px", width: "100%", "box-sizing": "border-box" }}>
        <input
          type="text"
          placeholder="Search commits..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          style={{ ...S.input, flex: 1, "box-sizing": "border-box" }}
        />
        <BranchMultiSelect />
      </div>

      <Show when={filteredCommits().length === 0}>
        <EmptyState message="No commits found." />
      </Show>

      <Show when={filteredCommits().length > 0}>
        <Card style={{ padding: 0, width: "100%", "max-width": "100%", "box-sizing": "border-box", overflow: "hidden" }}>
          <For each={filteredCommits()}>
            {(c) => (
              <div
                style={{
                  ...S.fileRow,
                  padding: "10px 14px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                  gap: "10px",
                  width: "100%",
                  "max-width": "100%",
                  "box-sizing": "border-box",
                  "min-width": 0,
                  overflow: "hidden",
                }}
                onClick={() => ctx.showCommitDetail(c.hash)}
                onContextMenu={(e) => handleContextMenu(e, c.hash)}
              >
                <code style={{ color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace", "font-size": "12px", "flex-shrink": 0 }}>
                  {c.hash.slice(0, 7)}
                </code>
                <span style={{ "font-size": "13px", color: "var(--text-color)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", flex: 1, "min-width": 0 }}>
                  {c.message}
                </span>
                <span style={{ "font-size": "11px", color: "var(--text-muted, #888)", "flex-shrink": 1, "min-width": 0, "text-align": "right", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "max-width": "200px" }}>
                  {c.author} · {formatTimestamp(c.timestamp)}
                </span>
              </div>
            )}
          </For>
        </Card>

        <Show when={ctx.historyHasMore()}>
          <div style={{ "text-align": "center", "margin-top": "12px", "padding-bottom": "16px", width: "100%" }}>
            <Button onClick={handleLoadMore} disabled={loadingMore()}>
              {loadingMore() ? "Loading..." : "Load More"}
            </Button>
          </div>
        </Show>
      </Show>

      <Show when={ctx.commitDetail()}>
        <div style={{ "margin-top": "16px", width: "100%", "max-width": "100%", "box-sizing": "border-box", overflow: "hidden" }}>
          <Card style={{ width: "100%", "max-width": "100%", "box-sizing": "border-box", overflow: "hidden" }}>
            <div style={S.cardHeader}>
              <span>Commit Detail</span>
              <Button size="sm" onClick={() => {
                const d = ctx.commitDetail();
                if (d) {
                  ctx.openDiffPrompt(d.hash);
                }
              }}>View Diff</Button>
            </div>
            <div style={{ "font-size": "13px", "line-height": "1.5", "word-break": "break-word", overflow: "hidden" }}>
              <div style={{ "margin-bottom": "4px" }}>
                <code style={{ color: "var(--accent-color, #f59e0b)", "font-family": "Space Mono, monospace", "word-break": "break-all" }}>{ctx.commitDetail()!.hash}</code>
              </div>
              <div style={{ "font-weight": 600, "margin-bottom": "8px", "white-space": "pre-wrap", "word-break": "break-word" }}>{ctx.commitDetail()!.message}</div>
              <div style={{ color: "var(--text-muted, #888)", "font-size": "11px", "word-break": "break-word" }}>
                {ctx.commitDetail()!.author} &lt;{ctx.commitDetail()!.email}&gt;
              </div>
              <div style={{ color: "var(--text-muted, #888)", "font-size": "11px" }}>
                {formatTimestamp(ctx.commitDetail()!.timestamp)}
              </div>
            </div>
          </Card>
        </div>
      </Show>

      {/* Right-click Context Menu */}
      <Show when={menuPos()}>
        <CommitContextMenu
          x={menuPos()!.x}
          y={menuPos()!.y}
          hash={menuPos()!.hash}
          onClose={() => setMenuPos(null)}
        />
      </Show>
    </div>
  );
}
