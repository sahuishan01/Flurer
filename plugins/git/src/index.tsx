import { Show, For, createSignal, createMemo, createEffect } from "solid-js";
import { GitProvider } from "./context";
import { getRecentRepos, basename } from "./utils";
import { GitIcon, CloseIcon, PlusIcon, Button, Toast } from "./components/shared";
import { S } from "./styles";
import { DashboardView } from "./components/DashboardView";
import { RepoView } from "./components/RepoView";

interface OpenTab {
  id: string;
  path: string;
  name: string;
}

let tabCounter = 0;

function GitPanel(props: any) {
  const [tabs, setTabs] = createSignal<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

  // If the user navigated to a path that is a known recent repo, pre-open it
  const initialPath = createMemo(() => {
    const p = props.currentPath;
    if (!p) return null;
    const recent = getRecentRepos().some((r) => r.path === p);
    if (!recent) return null;
    // Check if already open
    if (tabs().some((t) => t.path === p)) return null;
    return p;
  });

  createEffect(() => {
    const p = initialPath();
    if (p) openRepo(p);
  });

  const showDashboard = () => tabs().length === 0;

  function openRepo(path: string) {
    // Check if already open
    const existing = tabs().find((t) => t.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const id = `tab-${++tabCounter}`;
    const name = basename(path);
    setTabs((prev) => [...prev, { id, path, name }]);
    setActiveTabId(id);
  }

  function closeTab(id: string, e: MouseEvent) {
    e.stopPropagation();
    const tab = tabs().find((t) => t.id === id);
    if (!tab) return;
    const remaining = tabs().filter((t) => t.id !== id);
    setTabs(remaining);
    if (remaining.length === 0) {
      setActiveTabId(null);
    } else if (activeTabId() === id) {
      // Switch to the nearest remaining tab
      const idx = tabs().findIndex((t) => t.id === id);
      const nextIdx = Math.min(idx, remaining.length - 1);
      setActiveTabId(remaining[nextIdx].id);
    }
  }

  function switchTab(id: string) {
    setActiveTabId(id);
  }

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
      {/* Tab bar — always visible when there are open repos */}
      <Show when={tabs().length > 0}>
        <div style={{ display: "flex", gap: 0, "border-bottom": "1px solid var(--border-strong)", "flex-shrink": 0, "align-items": "stretch", overflow: "auto" }}>
          <For each={tabs()}>
            {(tab) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  padding: "0 12px",
                  height: "36px",
                  cursor: "pointer",
                  "flex-shrink": 0,
                  "font-size": "12px",
                  "font-weight": activeTabId() === tab.id ? 600 : 400,
                  color: activeTabId() === tab.id ? "var(--text-color)" : "var(--text-muted, #888)",
                  "border-bottom": activeTabId() === tab.id ? "2px solid var(--accent, var(--accent-color, #f59e0b))" : "2px solid transparent",
                  transition: "color 0.15s, border-color 0.15s",
                  "user-select": "none",
                }}
                onClick={() => switchTab(tab.id)}
              >
                <GitIcon size={14} />
                <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "max-width": "140px", "white-space": "nowrap" }}>
                  {tab.name}
                </span>
                <button
                  type="button"
                  style={{
                    display: "inline-flex",
                    "align-items": "center",
                    "justify-content": "center",
                    width: "18px",
                    height: "18px",
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: "var(--text-muted, #888)",
                    cursor: "pointer",
                    "border-radius": "3px",
                    opacity: 0.5,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.5"; }}
                  onClick={(e) => closeTab(tab.id, e)}
                  title="Close tab"
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            )}
          </For>
          <div style={{ display: "flex", "align-items": "center", padding: "0 8px" }}>
            <button
              type="button"
              style={{
                display: "inline-flex",
                "align-items": "center",
                "justify-content": "center",
                width: "24px",
                height: "24px",
                padding: 0,
                border: "none",
                background: "transparent",
                color: "var(--text-muted, #888)",
                cursor: "pointer",
                "border-radius": "4px",
              }}
              onClick={() => switchTab(tabs()[0]?.id ?? "")}
              onDblClick={() => {}}
              title="Open repository"
            >
              <PlusIcon size={16} />
            </button>
          </div>
        </div>
      </Show>

      {/* Dashboard — shown when no tabs are open, or when all tabs are closed */}
      <Show when={showDashboard()}>
        <DashboardView onOpenRepo={openRepo} />
      </Show>

      {/* Active repo tab — each tab gets its own GitProvider */}
      <For each={tabs()}>
        {(tab) => (
          <Show when={!showDashboard() && activeTabId() === tab.id}>
            <GitProvider initialPath={tab.path}>
              <RepoView onClose={() => closeTab(tab.id, new MouseEvent("click"))} />
              <Toast />
            </GitProvider>
          </Show>
        )}
      </For>
    </div>
  );
}

window.registerPlugin({
  id: "git",
  name: "Git Operations",
  description: "Full-featured git panel with graph, branches, diff, stash, worktrees, and more.",
  version: "0.3.0",
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