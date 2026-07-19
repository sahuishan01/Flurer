import { Show, createMemo } from "solid-js";
import { GitProvider } from "./context";
import { getRecentRepos } from "./utils";
import { GitIcon, Toast } from "./components/shared";
import { DashboardView } from "./components/DashboardView";
import { RepoView } from "./components/RepoView";

function GitPanel(props: any) {
  const hasRecentRepo = createMemo(() => {
    const p = props.currentPath;
    if (!p) return false;
    return getRecentRepos().some((r) => r.path === p);
  });

  const initialPath = createMemo(() => {
    const p = props.currentPath;
    if (!p) return null;
    if (hasRecentRepo()) return p;
    return null;
  });

  return (
    <GitProvider initialPath={initialPath()}>
      <div style={{ height: "100%", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
        <Show
          when={initialPath()}
          fallback={<DashboardView />}
        >
          <RepoView />
        </Show>
        <Toast />
      </div>
    </GitProvider>
  );
}

window.registerPlugin({
  id: "git",
  name: "Git Operations",
  description: "Full-featured git panel with graph, branches, diff, stash, worktrees, and more.",
  version: "0.2.0",
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
  fullPanel: (props: any) => <GitPanel {...props} />,
});
