import { createMemo, For, Show } from "solid-js";
import { useGit } from "../context";
import { Card, EmptyState, Button } from "./shared";
import { S } from "../styles";

export function DiffView() {
  const ctx = useGit();

  const fileList = createMemo(() => {
    const s = ctx.status();
    if (!s) return [];
    return s.changes.map((c) => ({ path: c.path, status: c.status, staged: c.staged }));
  });

  const selectedFile = createMemo(() => ctx.selectedDiffFile());
  const diff = createMemo(() => ctx.diffResult());

  function handleFileClick(path: string, staged: boolean) {
    ctx.loadDiff(path, staged ? "staged" : "unstaged");
  }

  let oldLine = 0;
  let newLine = 0;

  function parseHunkHeader(header: string) {
    const match = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (match) {
      oldLine = parseInt(match[1], 10);
      newLine = parseInt(match[2], 10);
    }
  }

  return (
    <div style={{ padding: "16px 24px" }}>
      <Show when={!selectedFile()}>
        <Show when={fileList().length === 0}>
          <EmptyState message="No changes to display diff." />
        </Show>
        <Show when={fileList().length > 0}>
          <Card>
            <div style={S.cardHeader}>Files</div>
            <For each={fileList()}>
              {(f) => (
                <div
                  style={{ ...S.fileRow, cursor: "pointer" }}
                  onClick={() => handleFileClick(f.path, f.staged)}
                >
                  <span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    <span style={{ "font-size": "10px", color: f.staged ? "#4ade80" : "#60a5fa", "font-family": "Space Mono, monospace", "margin-right": "6px" }}>
                      {f.staged ? "S" : "U"}
                    </span>
                    <span style={{ color: "var(--text-muted, #888)", "font-family": "Space Mono, monospace", "margin-right": "8px", "font-size": "12px" }}>{f.status}</span>
                    {f.path}
                  </span>
                </div>
              )}
            </For>
          </Card>
        </Show>
      </Show>

      <Show when={selectedFile()}>
        <div style={{ "margin-bottom": "12px", display: "flex", "align-items": "center", gap: "8px" }}>
          <Button size="sm" onClick={() => ctx.selectDiffFile(null)}>Back to files</Button>
          <span style={{ "font-size": "13px", "font-family": "Space Mono, monospace", color: "var(--text-muted, #888)" }}>{selectedFile()}</span>
          <span style={{ "font-size": "11px", padding: "2px 8px", "border-radius": "4px", background: ctx.diffMode() === "staged" ? "rgba(34,197,94,0.2)" : ctx.diffMode() === "unstaged" ? "rgba(59,130,246,0.2)" : "rgba(168,85,247,0.2)", color: ctx.diffMode() === "staged" ? "#4ade80" : ctx.diffMode() === "unstaged" ? "#60a5fa" : "#c084fc" }}>
            {ctx.diffMode()}
          </span>
        </div>

        <Show when={diff()}>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <For each={diff()!.hunks}>
              {(hunk) => {
                oldLine = hunk.old_start;
                newLine = hunk.new_start;
                return (
                  <div>
                    <div style={S.diffHunkHeader}>
                      @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                    </div>
                    <For each={hunk.lines}>
                      {(line) => {
                        const old = line.origin !== "+" ? oldLine++ : null;
                        const newL = line.origin !== "-" ? newLine++ : null;
                        const style = line.origin === "+" ? S.diffAdded : line.origin === "-" ? S.diffRemoved : S.diffContext;
                        return (
                          <div style={{ ...S.diffLine, ...style }}>
                            <span style={S.diffGutter}>{old ?? ""}</span>
                            <span style={S.diffGutter}>{newL ?? ""}</span>
                            <span style={{ flex: 1, "white-space": "pre-wrap", "word-break": "break-all" }}>{line.content}</span>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                );
              }}
            </For>
            <Show when={diff()!.hunks.length === 0}>
              <div style={{ padding: "20px", "text-align": "center", color: "var(--text-muted, #888)", "font-size": "13px" }}>
                No changes in this file.
              </div>
            </Show>
          </Card>
        </Show>

        <Show when={!diff()}>
          <EmptyState message="Loading diff..." />
        </Show>
      </Show>
    </div>
  );
}
