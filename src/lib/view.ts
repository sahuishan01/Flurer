import type { Accessor, JSX } from "solid-js";
import type { DirEntry } from "./fs";
import { DetailsIcon, GridIcon } from "../components/icons";

export type MainView = "explorer" | "settings" | string;

/**
 * Context handed to a plugin-supplied explorer view type (the `render` field of
 * `ExplorerViewType`). It exposes Core's current listing, selection state, and
 * row-level actions so a plugin can render its own layout (list, columns,
 * gallery, …) without re-implementing listing/selection/open/rename logic.
 */
export interface ExplorerListViewContext {
  /** Current listing (flat, in grouped/sorted order — the same entries the
   *  built-in Details table and Grid render). */
  files: Accessor<DirEntry[]>;
  /** "light" | "dark" — choose readable text/icon colors against the shell. */
  dataBgLightness: string;
  /** Selection state for the current listing. */
  isSelected: (path: string) => boolean;
  selectedPaths: Accessor<string[]>;
  /** Select exactly one entry (click semantics); clears the rest. */
  selectPath: (path: string) => void;
  /** Select/deselect everything. */
  selectAll: (on: boolean) => void;
  /** Open the entry (files open externally, directories navigate in-app). */
  openFile: (entry: DirEntry) => void;
  /** Show Core's context menu for an entry (Delete, Rename, Share, …). */
  showContextMenu: (entry: DirEntry, e: MouseEvent) => void;
  /** Begin an inline rename for an entry. */
  startRename: (path: string) => void;
  /**
   * Core per-file tile (thumbnail/icon, name, size, selection state, rename
   * input, context menu). Optional convenience — compose these into any layout
   * (list, columns, gallery), or render your own rows from `files` for a fully
   * custom layout. Renders a Core grid-styled tile.
   */
  renderTile: (entry: DirEntry) => JSX.Element;
}

/**
 * A file-listing layout the explorer can display (Details, Grid, …). Core
 * registers `details` and `grid` with `EXPLORER_VIEW_TYPES`; plugins add their
 * own via `PluginInfo.explorerViewTypes` (unique ids).
 */
export interface ExplorerViewType {
  /** Stable id, also used as the persisted `settings.viewMode` value. Core
   *  reserves `details` and `grid`; plugins must use unique ids. */
  id: string;
  /** Human-readable label shown in the view-type selector. */
  label: string;
  /** Icon shown in the selector trigger and item. */
  icon: (props: { size?: number; class?: string }) => JSX.Element;
  /**
   * Optional Solid component that renders the list body for this view type.
   * Omitted for Core's built-ins (Details/Grid), which `FileList` renders with
   * its own table/grid. Plugin-contributed view types supply one — `FileList`
   * mounts it in place of the table/grid, passing the same `ExplorerListViewContext`
   * it gives every layout. Same `<PluginView ctx={…} />` pattern App uses for plugin
   * panels, so plugin render functions may use Solid hooks freely.
   */
  render?: (props: { ctx: ExplorerListViewContext }) => JSX.Element;
}

/**
 * Registered explorer view types. This array is the single source of truth for
 * which listing layouts the explorer offers — append a descriptor (with a
 * matching render branch in FileList.tsx keyed on its `id`) and it appears in
 * the view-type selector and is persisted via `settings.viewMode`.
 */
export const EXPLORER_VIEW_TYPES: ExplorerViewType[] = [
  { id: "details", label: "Details", icon: DetailsIcon },
  { id: "grid", label: "Grid", icon: GridIcon },
];

/**
 * Resolve a (possibly persisted/unknown) id to a registered view type, falling
 * back to the first registered one — so a legacy or unrecognized value never
 * leaves the file list without a valid layout.
 */
export function lookupViewType(id: string | undefined): ExplorerViewType {
  return EXPLORER_VIEW_TYPES.find((v) => v.id === id) ?? EXPLORER_VIEW_TYPES[0];
}

// A request for GraphView to expand and center on a given path (e.g. a
// drive selected from the sidebar while already in graph mode). `token` is
// bumped on every request, including a repeat of the same path, so the
// effect watching it in GraphView fires even when nothing else about the
// request changed.
export type GraphFocusRequest = { path: string; token: number };
