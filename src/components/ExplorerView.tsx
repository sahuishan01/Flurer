import { createSignal, Show } from "solid-js";
import { FileList } from "./FileList";
import { CloseIcon, LayersIcon } from "./icons";
import { parentDir, type ClipboardState, type GroupByKey, type SortDirection, type SortKey } from "../lib/fs";
import type { InAppShortcutAction } from "../lib/shortcuts";

type ExplorerViewProps = {
  path: string;
  onNavigate: (path: string) => void;
  searchQuery: string;
  searchRecursive: boolean;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
  folderColors: Record<string, string | undefined>;
  onSetFolderColor: (path: string, color: string | null) => void;
  inAppShortcuts: Partial<Record<InAppShortcutAction, string>>;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortChange: (key: SortKey) => void;
  groupFoldersFirst: boolean;
  onGroupFoldersFirstChange: (value: boolean) => void;
  groupBy: GroupByKey;
  onGroupByChange: (value: GroupByKey) => void;
  /** Folder shown in the second pane; null/undefined when the view is unsplit. */
  splitPath: string | null;
  onSplitPathChange: (path: string | null) => void;
  "data-bg-lightness"?: string;
};

type Pane = "primary" | "secondary";

export function ExplorerView(props: ExplorerViewProps) {
  // One clipboard across both panes, deliberately: copying in one pane and
  // pasting in the other is the main reason to have a split at all.
  const [clipboard, setClipboard] = createSignal<ClipboardState>(null);

  // Which pane keyboard shortcuts and OS drops apply to. Tracked on pointer
  // and focus rather than hover so the target doesn't change out from under
  // someone who has moved the mouse away before pressing Delete.
  const [activePane, setActivePane] = createSignal<Pane>("primary");

  // Loose comparison deliberately: a settings.json written before this
  // field existed deserializes splitViewPath as undefined, and a strict
  // `!== null` would read that as "split is open," laying out a second
  // pane that never renders anything.
  const isSplit = () => props.splitPath != null;

  /**
   * Parent of `path`, or null if it is already a root. parentDir() alone
   * isn't enough: at a drive root it returns "C:" (no trailing separator),
   * which to Windows means "the current directory on C:" rather than the
   * drive root — navigating there would be a different place, so treat it
   * as "no parent" instead.
   */
  function parentOf(path: string): string | null {
    const up = parentDir(path);
    const withoutTrailingSeparator = path.replace(/[/\\]+$/, "");
    if (!up || up === path || up === withoutTrailingSeparator) return null;
    return up;
  }

  function openSplit() {
    // Opens alongside the current folder rather than at some fixed home:
    // the overwhelmingly common split is "this folder and its parent" or
    // "this folder and one I'm about to navigate to".
    props.onSplitPathChange(parentOf(props.path) ?? props.path);
    setActivePane("secondary");
  }

  function closeSplit() {
    props.onSplitPathChange(null);
    setActivePane("primary");
  }

  return (
    <div class="explorer-content" classList={{ "explorer-content-split": isSplit() }}>
      <div
        class="explorer-pane"
        classList={{ "explorer-pane-active": isSplit() && activePane() === "primary" }}
        onFocusIn={() => setActivePane("primary")}
        onPointerDown={() => setActivePane("primary")}
      >
        <Show when={!isSplit()}>
          <div class="explorer-pane-actions">
            <button type="button" class="icon-btn" title="Split view" aria-label="Split view" onClick={openSplit}>
              <LayersIcon />
            </button>
          </div>
        </Show>
        <FileList
          data-bg-lightness={props["data-bg-lightness"]}
          path={props.path}
          onNavigate={props.onNavigate}
          active={!isSplit() || activePane() === "primary"}
          sortKey={props.sortKey}
          sortDirection={props.sortDirection}
          onSortChange={props.onSortChange}
          groupFoldersFirst={props.groupFoldersFirst}
          onGroupFoldersFirstChange={props.onGroupFoldersFirstChange}
          groupBy={props.groupBy}
          onGroupByChange={props.onGroupByChange}
          clipboard={clipboard()}
          onClipboardChange={setClipboard}
          searchQuery={props.searchQuery}
          searchRecursive={props.searchRecursive}
          favouritePaths={props.favouritePaths}
          onToggleFavourite={props.onToggleFavourite}
          folderColors={props.folderColors}
          onSetFolderColor={props.onSetFolderColor}
          inAppShortcuts={props.inAppShortcuts}
        />
      </div>

      <Show when={props.splitPath}>
        {(splitPath) => (
          <div
            class="explorer-pane explorer-pane-secondary"
            classList={{ "explorer-pane-active": activePane() === "secondary" }}
            onFocusIn={() => setActivePane("secondary")}
            onPointerDown={() => setActivePane("secondary")}
          >
            <div class="explorer-pane-header">
              {/* The second pane has no address bar or history of its own —
                  it navigates by opening folders and by this Up button.
                  Giving it the full chrome would mean duplicating the
                  window's back/forward stack per pane, which is a much
                  larger change than the split itself. */}
              <button
                type="button"
                class="icon-btn"
                title="Go to parent folder"
                aria-label="Go to parent folder"
                disabled={parentOf(splitPath()) === null}
                onClick={() => {
                  const up = parentOf(splitPath());
                  if (up) props.onSplitPathChange(up);
                }}
              >
                ↑
              </button>
              <span class="explorer-pane-path selectable-text">{splitPath()}</span>
              <button type="button" class="icon-btn" title="Close split" aria-label="Close split" onClick={closeSplit}>
                <CloseIcon />
              </button>
            </div>
            <FileList
              data-bg-lightness={props["data-bg-lightness"]}
              path={splitPath()}
              onNavigate={props.onSplitPathChange}
              active={activePane() === "secondary"}
              sortKey={props.sortKey}
              sortDirection={props.sortDirection}
              onSortChange={props.onSortChange}
              groupFoldersFirst={props.groupFoldersFirst}
              onGroupFoldersFirstChange={props.onGroupFoldersFirstChange}
              groupBy={props.groupBy}
              onGroupByChange={props.onGroupByChange}
              clipboard={clipboard()}
              onClipboardChange={setClipboard}
              // The window's search box drives the primary pane only —
              // applying one query to both panes would make the split
              // useless as a "search here, browse there" workspace.
              searchQuery=""
              searchRecursive={false}
              favouritePaths={props.favouritePaths}
              onToggleFavourite={props.onToggleFavourite}
              folderColors={props.folderColors}
              onSetFolderColor={props.onSetFolderColor}
              inAppShortcuts={props.inAppShortcuts}
            />
          </div>
        )}
      </Show>
    </div>
  );
}
