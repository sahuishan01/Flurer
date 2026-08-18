import { createResource, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { RefreshIcon } from "./icons";
import { baseName, formatBytes, parentDir } from "../lib/fs";

type PathMetadata = {
  created: number | null;
  modified: number | null;
  accessed: number | null;
  readonly: boolean;
  isDir: boolean;
  itemCount: number | null;
};

type FolderSizeState = "pending" | { size: number; done: boolean };

type PropertiesDialogProps = {
  path: string;
  // For a file this is just entry.size (already known, no fetch needed).
  // For a folder this reads the same live folderSizes map FileList already
  // maintains — reusing it instead of a separate one-shot fetch means the
  // dialog shows the exact number already on screen, live-updating in the
  // background computation the same way the size column does.
  fileSize: number | null;
  folderSizeState: () => FolderSizeState | undefined;
  onRecalculate: () => void;
  onClose: () => void;
};

function formatDate(epochSeconds: number | null): string {
  if (epochSeconds === null) return "Unknown";
  return new Date(epochSeconds * 1000).toLocaleString();
}

export function PropertiesDialog(props: PropertiesDialogProps) {
  const [metadata] = createResource(
    () => props.path,
    (path) => invoke<PathMetadata>("get_path_metadata", { path }),
  );

  function sizeLabel(): string {
    if (props.fileSize !== null) return formatBytes(props.fileSize);
    const state = props.folderSizeState();
    if (!state || state === "pending") return "Calculating…";
    return state.done ? formatBytes(state.size) : `${formatBytes(state.size)}…`;
  }

  return (
    <Modal title="Properties" onClose={props.onClose}>
      <div class="properties-grid">
        <span class="properties-label">Name</span>
        <span class="properties-value selectable-text" title={baseName(props.path)}>
          {baseName(props.path)}
        </span>

        <span class="properties-label">Type</span>
        <span class="properties-value selectable-text">{props.fileSize !== null ? "File" : "Folder"}</span>

        <span class="properties-label">Location</span>
        <span class="properties-value selectable-text" title={parentDir(props.path)}>
          {parentDir(props.path)}
        </span>

        <span class="properties-label">Size</span>
        <span class="properties-value properties-size-row selectable-text">
          {sizeLabel()}
          <Show when={props.fileSize === null}>
            <button type="button" class="icon-btn" title="Recalculate" aria-label="Recalculate" onClick={props.onRecalculate}>
              <RefreshIcon size={13} />
            </button>
          </Show>
        </span>

        <Show when={metadata()?.itemCount !== null && metadata()?.itemCount !== undefined}>
          <span class="properties-label">Contains</span>
          <span class="properties-value selectable-text">
            {metadata()!.itemCount} item{metadata()!.itemCount === 1 ? "" : "s"}
          </span>
        </Show>

        <span class="properties-label">Modified</span>
        <span class="properties-value selectable-text">
          <Show when={!metadata.loading} fallback="Loading…">
            {formatDate(metadata()?.modified ?? null)}
          </Show>
        </span>

        <span class="properties-label">Created</span>
        <span class="properties-value selectable-text">
          <Show when={!metadata.loading} fallback="Loading…">
            {formatDate(metadata()?.created ?? null)}
          </Show>
        </span>

        <span class="properties-label">Attributes</span>
        <span class="properties-value selectable-text">
          <Show when={!metadata.loading} fallback="Loading…">
            {metadata()?.readonly ? "Read-only" : "Read/Write"}
          </Show>
        </span>

        {metadata.error && <p class="settings-error">{String(metadata.error)}</p>}
      </div>
    </Modal>
  );
}
