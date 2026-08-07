import { createSignal, For, Show } from "solid-js";
import { getRecentRepos, removeRecentRepo, formatTimestamp, surfaceBg } from "../utils";
import { GitIcon, FolderIcon, TrashIcon, Button } from "./shared";
import { DirectoryPickerModal } from "./DirectoryPickerModal";
import { S } from "../styles";

type DashboardViewProps = {
  onOpenRepo: (path: string) => void;
};

export function DashboardView(props: DashboardViewProps) {
  const [repos, setRepos] = createSignal(getRecentRepos());
  const [openPath, setOpenPath] = createSignal("");
  const [showInput, setShowInput] = createSignal(false);
  const [showPicker, setShowPicker] = createSignal(false);

  function handleOpen(path: string) {
    props.onOpenRepo(path);
  }

  function handleRemove(path: string) {
    removeRecentRepo(path);
    setRepos(getRecentRepos());
  }

  function handleOpenPath() {
    const p = openPath().trim();
    if (!p) return;
    props.onOpenRepo(p);
    setOpenPath("");
    setShowInput(false);
  }

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
      <div style={{ ...S.section, "border-bottom": "1px solid var(--border-strong)", "flex-shrink": 0 }}>
        <div style={S.toolbar}>
          <GitIcon size={22} />
          <h2 style={{ margin: 0, "font-size": "18px", "font-weight": 600 }}>Git Dashboard</h2>
        </div>
      </div>

      <div style={{ ...S.section, flex: 1, overflow: "auto", "padding-top": "16px", "padding-bottom": "24px" }}>
        <Show when={repos().length > 0}>
          <div style={{ "margin-bottom": "16px" }}>
            <h3 style={S.sectionTitle}>Recent Repositories</h3>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
              <For each={repos()}>
                {(repo) => (
                  <div
                    style={{ ...S.repoCard, position: "relative" }}
                    onClick={() => handleOpen(repo.path)}
                  >
                    <FolderIcon size={20} />
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ "font-weight": 600, "font-size": "14px", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", color: "var(--text-primary, var(--text-color))", "text-shadow": "var(--text-shadow)" }}>{repo.name}</div>
                      <div style={{ "font-size": "12px", color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                        {repo.path}
                        <Show when={repo.branch}>
                          <span style={{ "margin-left": "8px", color: "var(--accent-default, var(--accent-color, #f59e0b))" }}>{repo.branch}</span>
                        </Show>
                      </div>
                    </div>
                    <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-shrink": 0 }}>
                      <span style={{ "font-size": "11px", color: "var(--text-secondary, #888)", "text-shadow": "var(--text-shadow)" }}>{formatTimestamp(repo.lastOpened / 1000)}</span>
                      <button
                        type="button"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #888)", padding: "4px" }}
                        title="Remove from list"
                        onClick={(e) => { e.stopPropagation(); handleRemove(repo.path); }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div style={S.card}>
          <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
            <Button
              variant="primary"
              onClick={() => setShowPicker(true)}
              style={{ flex: 1, padding: "10px", display: "flex", "align-items": "center", "justify-content": "center", gap: "8px" }}
            >
              <FolderIcon size={16} />
              Browse Folder...
            </Button>
            <Show when={!showInput()}>
              <Button onClick={() => setShowInput(true)} style={{ padding: "10px" }}>
                Enter Path...
              </Button>
            </Show>
          </div>

          <Show when={showInput()}>
            <div style={{ "margin-top": "12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="/path/to/repo"
                  value={openPath()}
                  onInput={(e) => setOpenPath(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleOpenPath()}
                  style={{ ...S.input, flex: 1 }}
                />
                <Button variant="primary" onClick={handleOpenPath}>Open</Button>
                <Button onClick={() => setShowInput(false)}>Cancel</Button>
              </div>
            </div>
          </Show>
        </div>

        <Show when={repos().length === 0}>
          <div style={{ ...S.emptyState, "padding-top": "60px" }}>
            <GitIcon size={48} />
            <p style={{ "margin-top": "16px" }}>No recent repositories</p>
            <p style={{ "font-size": "12px", opacity: 0.6 }}>Open a git repository to get started</p>
          </div>
        </Show>
      </div>

      {/* Internal Folder Browser Modal */}
      <DirectoryPickerModal
        open={showPicker()}
        onSelect={(path) => props.onOpenRepo(path)}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}