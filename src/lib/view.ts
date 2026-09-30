import type { JSX } from "solid-js";
import { DetailsIcon, GridIcon } from "../components/icons";

export type MainView = "explorer" | "settings" | string;

/** A file-listing layout the explorer can display (Details, Grid, …). */
export interface ExplorerViewType {
  /** Stable id, also used as the persisted `settings.viewMode` value. */
  id: string;
  /** Human-readable label shown in the view-type selector. */
  label: string;
  /** Icon shown in the selector trigger and item. */
  icon: (props: { size?: number; class?: string }) => JSX.Element;
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
