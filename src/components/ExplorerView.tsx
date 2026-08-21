import { createEffect, createSignal, Index, Show } from "solid-js";
import { FileList } from "./FileList";
import { ExplorerPathBar } from "./ExplorerPathBar";
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
  // How many columns wide the grid lays out (1-4) — extra panes beyond a
  // full row wrap onto a new one automatically. Pane 0 (this view's own
  // `path`) is always present; splitPanePaths holds the *extra* panes'
  // folders, one entry per open pane, capped at MAX_PANES - 1 total.
  splitCols: number;
  onSplitColsChange: (cols: number) => void;
  splitPanePaths: string[];
  onSplitPanePathsChange: (paths: string[]) => void;
  "data-bg-lightness"?: string;
};

const MAX_COLS = 4;
const MAX_ROWS = 4;
const MAX_PANES = MAX_COLS * MAX_ROWS;

export function ExplorerView(props: ExplorerViewProps) {
  // One clipboard across every pane, deliberately: copying in one pane and
  // pasting in another is the main reason to have a split at all.
  const [clipboard, setClipboard] = createSignal<ClipboardState>(null);

  // Which pane keyboard shortcuts and OS drops apply to. 0 is the primary
  // pane; k (k >= 1) is splitPanePaths[k - 1]. Tracked on pointer and focus
  // rather than hover so the target doesn't change out from under someone
  // who has moved the mouse away before pressing Delete.
  const [activePane, setActivePane] = createSignal(0);

  const totalPanes = () => 1 + props.splitPanePaths.length;
  const isSplit = () => totalPanes() > 1;
  // Never wider than there are panes to fill it, so a 4-column grid with
  // only two panes open doesn't leave two empty tracks.
  const effectiveCols = () => Math.max(1, Math.min(props.splitCols, MAX_COLS, totalPanes()));

  function activePanePath(): string {
    const i = activePane();
    return i === 0 ? props.path : (props.splitPanePaths[i - 1] ?? props.path);
  }

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

  function addPane() {
    if (totalPanes() >= MAX_PANES) return;
    // Opens alongside whichever pane is active rather than always the
    // primary: the overwhelmingly common next split is "this folder and
    // its parent" or "this folder and one I'm about to navigate to",
    // relative to wherever the user was just looking.
    const base = activePanePath();
    const next = [...props.splitPanePaths, parentOf(base) ?? base];
    props.onSplitPanePathsChange(next);
    setActivePane(next.length);
  }

  function closePane(overallIndex: number) {
    const arrIndex = overallIndex - 1;
    const next = props.splitPanePaths.filter((_, i) => i !== arrIndex);
    props.onSplitPanePathsChange(next);
    if (activePane() === overallIndex) setActivePane(0);
    else if (activePane() > overallIndex) setActivePane(activePane() - 1);
  }

  function updateExtraPane(arrIndex: number, path: string) {
    const next = props.splitPanePaths.slice();
    next[arrIndex] = path;
    props.onSplitPanePathsChange(next);
  }

  function setCols(n: number) {
    props.onSplitColsChange(Math.max(1, Math.min(MAX_COLS, n)));
  }

  return (
    <div
      class="explorer-content"
      classList={{ "explorer-content-split": isSplit() }}
      style={{ "--split-cols": effectiveCols() }}
    >
      <div
        class="explorer-pane"
        classList={{ "explorer-pane-active": isSplit() && activePane() === 0 }}
        onFocusIn={() => setActivePane(0)}
        onPointerDown={() => setActivePane(0)}
      >
        <div class="explorer-pane-actions">
          <Show
            when={isSplit()}
            fallback={
              <button type="button" class="icon-btn" title="Split view" aria-label="Split view" onClick={addPane}>
                <LayersIcon />
              </button>
            }
          >
            <button
              type="button"
              class="icon-btn"
              title="Add pane"
              aria-label="Add pane"
              disabled={totalPanes() >= MAX_PANES}
              onClick={addPane}
            >
              +
            </button>
            <div class="split-cols-stepper" title="Grid columns">
              <button
                type="button"
                class="icon-btn"
                aria-label="Fewer columns"
                disabled={props.splitCols <= 1}
                onClick={() => setCols(props.splitCols - 1)}
              >
                –
              </button>
              <span class="split-cols-count">{props.splitCols}</span>
              <button
                type="button"
                class="icon-btn"
                aria-label="More columns"
                disabled={props.splitCols >= MAX_COLS}
                onClick={() => setCols(props.splitCols + 1)}
              >
                +
              </button>
            </div>
          </Show>
        </div>
        <FileList
          data-bg-lightness={props["data-bg-lightness"]}
          path={props.path}
          onNavigate={props.onNavigate}
          active={!isSplit() || activePane() === 0}
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

      {/* Index, not For: panes are addressed by position (pane 0 is always
          primary, pane k is splitPanePaths[k-1]), and two panes can
          legitimately show the same folder — keying by path like For does
          would collide. Index calls its render function once per slot and
          updates an accessor in place as that slot's path changes, so each
          pane's local pathInput state below survives navigation instead of
          being torn down and recreated on every keystroke. */}
      <Index each={props.splitPanePaths}>
        {(pathAt, arrIndex) => {
          const overallIndex = arrIndex + 1;
          const [pathInput, setPathInput] = createSignal(pathAt());
          // Keep the address bar's input in sync with navigation that
          // didn't come from typing (double-click, breadcrumb, the primary
          // pane's own search/sort controls don't apply here, but this
          // pane's own breadcrumb/back-to-parent do).
          createEffect(() => setPathInput(pathAt()));

          return (
            <div
              class="explorer-pane explorer-pane-secondary"
              classList={{ "explorer-pane-active": activePane() === overallIndex }}
              onFocusIn={() => setActivePane(overallIndex)}
              onPointerDown={() => setActivePane(overallIndex)}
            >
              <div class="explorer-pane-header">
                <ExplorerPathBar
                  path={pathAt()}
                  pathInput={pathInput()}
                  onPathInputChange={setPathInput}
                  onNavigate={(p) => updateExtraPane(arrIndex, p)}
                  favouritePaths={props.favouritePaths}
                  onToggleFavourite={props.onToggleFavourite}
                />
                <button
                  type="button"
                  class="icon-btn"
                  title="Close pane"
                  aria-label="Close pane"
                  onClick={() => closePane(overallIndex)}
                >
                  <CloseIcon />
                </button>
              </div>
              <FileList
                data-bg-lightness={props["data-bg-lightness"]}
                path={pathAt()}
                onNavigate={(p) => updateExtraPane(arrIndex, p)}
                active={activePane() === overallIndex}
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
                // applying one query to every pane would make the split
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
          );
        }}
      </Index>
    </div>
  );
}
