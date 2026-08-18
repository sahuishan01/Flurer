# Dual-pane explorer — design

## Purpose

Flurer's explorer view is single-pane: `App.tsx` holds one flat set of
browsing signals (`currentPath`, `history`/`historyIndex`, `tabs`,
`searchQuery`) plus shared display prefs (`sortKey`/`sortDirection`,
`groupBy`/`groupFoldersFirst`) and renders one `ExplorerView`. Power users
of file managers expect a second, fully independent pane they can browse
side-by-side and move/copy files between (Total Commander / Directory Opus
style). This design adds an optional second pane, each with its own path,
history, tabs, and search state (sort/group stays a shared app-wide
preference, see §1), plus a quick way to send the current selection to
the other pane without dragging.

This only affects the `"explorer"` `mainView` — Trash, Duplicate Finder,
Settings, and other top-level views stay single-pane; `dualPane` has no
effect on them.

## 1. Extract `ExplorerPane.tsx`

Create `src/components/ExplorerPane.tsx`, moving out of `App.tsx`:

- Signals: `currentPath`, `pathInput`, `history`/`historyIndex`, `tabs`/
  `activeTabId`, `searchQuery`, `searchRecursive`.
- Functions: `navigateTo`, `goBack`/`goForward`, tab management
  (`openNewTab`/`switchTab`/`closeTab`), `applyHistoryEntry`.

`sortKey`/`sortDirection`/`groupBy`/`groupFoldersFirst` are *not* moved —
they're already persisted `Settings` fields (`App.tsx:998-1003` reads them
from `settings.*`, not local signals), shared app-wide today. This design
keeps them shared across both panes rather than forking them per-pane:
sorting/grouping is a display preference, not browsing position, and
per-pane sort would mean a `Settings` schema change (`sortKey` etc.
becoming per-pane-keyed) that neither user requirement (fast transfer,
side-by-side browsing) needs. `ExplorerPane` receives them as props from
`App.tsx`/`settings`, same as `ExplorerView` does today.
- Rendering: a header row with back/forward buttons + `ExplorerPathBar`
  (both currently injected into the shared `CommandBar` via its
  `viewControls` slot — that slot's explorer usage goes away) and a search
  box, followed by `ExplorerTabs` and `ExplorerView` — i.e. everything
  explorer-specific that this repo's own view-separation convention says
  shouldn't live in the app-wide `CommandBar`.

`ExplorerPane` props:

```ts
type ExplorerPaneProps = {
  paneId: string;
  initialPath: string;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
  folderColors: Record<string, string | undefined>;
  onSetFolderColor: (path: string, color: string | null) => void;
  inAppShortcuts: Partial<Record<InAppShortcutAction, string>>;
  sortKey: SortKey;
  sortDirection: SortDirection;
  groupFoldersFirst: boolean;
  onGroupFoldersFirstChange: (value: boolean) => void;
  groupBy: GroupByKey;
  onGroupByChange: (value: GroupByKey) => void;
  otherPanePath: string | null; // null when dualPane is off or other pane unmounted
  dualPaneActive: boolean; // gates the "copy/move to other pane" context menu items
  onActivate: (paneId: string) => void;
  onPathChange: (paneId: string, path: string) => void;
  onRegisterNavigate: (paneId: string, navigate: (path: string) => void) => void;
  "data-bg-lightness"?: string;
};
```

`onActivate` fires from an `onFocusIn`/`onMouseDown` (capture, non-stopping)
handler on the pane's root div, so any interaction inside the pane marks it
active without needing every inner control to call it individually.
`onRegisterNavigate` fires once via `onMount`, handing `App.tsx` a stable
reference to this pane's `navigateTo` so cross-pane callers (the sidebar)
can target "whichever pane is active" without `App.tsx` re-implementing
navigation.

`CommandBar` loses its `viewControls` prop entirely (nothing else uses it)
and keeps only genuinely app-wide chrome: the progress indicator and
`showProgressWhenIdle`.

## 2. Layout, toggle, and persistence

`App.tsx` renders a new `.explorer-panes` flex container:

```tsx
<div class="explorer-panes" classList={{ "explorer-panes-dual": settings.dualPane }}>
  <ExplorerPane paneId="left" ... />
  <Show when={settings.dualPane}>
    <ExplorerPane paneId="right" ... />
  </Show>
</div>
```

`.explorer-panes-dual` splits children 50/50 with a fixed `flex: 1` each
and a `border-left`/gap between them for a visible seam — no resizable
divider in this iteration (YAGNI; can follow later if wanted).

`dualPane: boolean` is added to `Settings` (`src-tauri/src/helpers/
settings.rs`, defaulting to `false`) and persisted the same way every
other layout preference already is — no new storage mechanism. The
toggle is a new icon button in `ViewRail` (it already owns view-switching
affordances), calling `onDualPaneChange` which round-trips through the
existing settings-update path used by other toggles like
`groupFoldersFirst`.

`App.tsx` tracks:

```ts
const [activePaneId, setActivePaneId] = createSignal<string>("left");
const paneNavigators = new Map<string, (path: string) => void>();
const [panePaths, setPanePaths] = createSignal<Record<string, string>>({ left: DEFAULT_PATH });
```

`Sidebar`'s `onSelectPath` (and any other "jump somewhere" caller) now
calls `paneNavigators.get(activePaneId())?.(path)` instead of the old
single `navigateTo`. When `dualPane` is turned off, the right pane
unmounts (its `onCleanup` naturally drops its entry from `paneNavigators`/
`panePaths`); if it was active, `activePaneId` resets to `"left"`.

## 3. Cross-pane transfer

Drag-and-drop between panes needs no new code: `startRowDrag`/
`elementAtDropPoint` (`FileList.tsx`) already resolve drop targets by
`[data-drop-path]` anywhere in the DOM — this now includes rows rendered
by the other pane's `FileList`, so a row dragged from the left pane onto a
folder row in the right pane already works via the existing mechanism.

For a faster non-drag path, `FileList`'s `contextMenuItems()` gets two new
entries, shown only when `props.dualPaneActive && props.otherPanePath`:

- **Copy to other pane** — calls the same `transferItems(paths,
  props.otherPanePath, "copy")` already used by the drag-drop handler.
- **Move to other pane** — same with `"move"`, and pushes the same
  `pushUndo({ type: "move", ... })` entry the existing move path already
  constructs.

`otherPanePath` is threaded down: `App.tsx` → `ExplorerPane` (as a prop,
derived from `panePaths()[otherPaneId]`) → `ExplorerView` → `FileList`,
following the existing prop-drilling pattern already used for
`folderColors`/`favouritePaths` etc.

## 4. Single-pane behavior is unchanged

With `dualPane` off, `App.tsx` renders exactly one `ExplorerPane` with
`paneId="left"` and `otherPanePath={null}`/`dualPaneActive={false}` — the
new context-menu entries don't render, and `ExplorerPane`'s internals are
a straight move of today's `App.tsx` logic with no behavior change. This
keeps the common case (single pane) byte-for-byte equivalent to today
rather than a special case of the dual-pane code path.

## Testing

No automated UI test harness exists in this repo for pointer/navigation
interactions (consistent with prior UI plans). Manual verification:
single-pane mode navigates/searches/sorts identically to today; toggling
dual-pane on shows two independent panes that can be navigated and
searched independently (sort/group changes apply to both, since that
preference stays shared); the sidebar navigates whichever pane was last
interacted with; dragging a row from one pane onto a folder row in the
other pane copies/moves it; the new context-menu "copy/move to other
pane" entries appear only in dual-pane mode and produce the same result
as the equivalent drag; turning dual-pane back off collapses to the left
pane's current state without navigating away from what was showing there.
