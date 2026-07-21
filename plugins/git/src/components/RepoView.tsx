import { Show, Switch, Match, createMemo } from "solid-js";
import { useGit } from "../context";
import { basename } from "../utils";
import { GitIcon, RefreshIcon, PullIcon, PushIcon, FetchIcon, CloseIcon, BranchIcon, Button, TabBar } from "./shared";
import { S } from "../styles";
import { ChangesView } from "./ChangesView";
import { DiffView } from "./DiffView";
import { BranchesView } from "./BranchesView";
import { HistoryView } from "./HistoryView";
import { GraphView } from "./GraphView";
import { StashView } from "./StashView";
import { WorktreesView } from "./WorktreesView";

const TABS = [
  { id: "changes", label: "Changes" },
  { id: "graph", label: "Graph" },
  { id: "branches", label: "Branches" },
  { id: "history", label: "History" },
  { id: "diff", label: "Diff" },
  { id: "stash", label: "Stash" },
  { id: "worktrees", label: "Worktrees" },
];

type RepoViewProps = {
  onClose: () => void;
};

export function RepoView(props: RepoViewProps) {
  const ctx = useGit();

  const repoName = createMemo(() => {
    const p = ctx.repoPath();
    return p ? basename(p) : "";
  });

  const changeCount = createMemo(() => {
    const s = ctx.status();
    return s ? s.changes.length : 0;
  });

  function handleTabSelect(id: string) {
    ctx.switchView(id as any);
  }

  const tabsWithCount = createMemo(() =>
    TABS.map((t) => ({
      ...t,
      count: t.id === "changes" ? changeCount() : undefined,
    }))
  );

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
      <div style={{ ...S.section, "border-bottom": "1px solid var(--border-strong)", "flex-shrink": 0 }}>
        <div style={S.toolbar}>
          <Button onClick={props.onClose} size="sm" title="Close tab">
            <CloseIcon size={14} />
          </Button>
          <GitIcon size={22} />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <h2 style={{ margin: 0, "font-size": "16px", "font-weight": 600, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{repoName()}</h2>
            <div style={{ "font-size": "11px", color: "var(--text-muted, #888)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{ctx.repoPath()}</div>
          </div>
          <Show when={ctx.status()}>
            {(s) => (
              <>
                <span style={S.branchBadge}>
                  <BranchIcon size={14} />
                  {s().branch}
                  <Show when={s().hasRemote}>
                    <span style={{ opacity: 0.7, "font-weight": 400 }}>↑{s().ahead} ↓{s().behind}</span>
                  </Show>
                </span>
                <Button variant="secondary" size="sm" onClick={ctx.pull} disabled={ctx.loading()}>
                  <PullIcon size={14} /> Pull
                </Button>
                <Button variant="primary" size="sm" onClick={ctx.push} disabled={ctx.loading()}>
                  <PushIcon size={14} /> Push
                </Button>
                <Button variant="secondary" size="sm" onClick={ctx.fetchRemote} disabled={ctx.loading()}>
                  <FetchIcon size={14} /> Fetch
                </Button>
                <Button variant="secondary" size="sm" onClick={ctx.refresh} disabled={ctx.loading()}>
                  <RefreshIcon size={14} />
                </Button>
              </>
            )}
          </Show>
        </div>
      </div>

      <TabBar tabs={tabsWithCount()} activeTab={ctx.activeView()} onSelect={handleTabSelect} />

      <div style={{ flex: 1, overflow: "auto" }}>
        <Switch>
          <Match when={ctx.activeView() === "changes"}><ChangesView /></Match>
          <Match when={ctx.activeView() === "graph"}><GraphView /></Match>
          <Match when={ctx.activeView() === "branches"}><BranchesView /></Match>
          <Match when={ctx.activeView() === "history"}><HistoryView /></Match>
          <Match when={ctx.activeView() === "diff"}><DiffView /></Match>
          <Match when={ctx.activeView() === "stash"}><StashView /></Match>
          <Match when={ctx.activeView() === "worktrees"}><WorktreesView /></Match>
        </Switch>
      </div>
    </div>
  );
}