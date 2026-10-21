import { createResource, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { RefreshIcon } from "./icons";
import { FieldGroup, FieldRow, FieldValue } from "./ui/Field";
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
      <FieldGroup class="properties-list" readOnly>
        <FieldRow label="Name" readOnly>
          <FieldValue title={baseName(props.path)}>{baseName(props.path)}</FieldValue>
        </FieldRow>

        <FieldRow label="Type" readOnly>
          <FieldValue>{props.fileSize !== null ? "File" : "Folder"}</FieldValue>
        </FieldRow>

        <FieldRow label="Location" readOnly>
          <FieldValue title={parentDir(props.path)}>{parentDir(props.path)}</FieldValue>
        </FieldRow>

        <FieldRow label="Size" readOnly>
          <FieldValue>{sizeLabel()}</FieldValue>
          <Show when={props.fileSize === null}>
            <button type="button" class="icon-btn" title="Recalculate" aria-label="Recalculate" onClick={props.onRecalculate}>
              <RefreshIcon size={13} />
            </button>
          </Show>
        </FieldRow>

        <Show when={metadata()?.itemCount !== null && metadata()?.itemCount !== undefined}>
          <FieldRow label="Contains" readOnly>
            <FieldValue>
              {metadata()!.itemCount} item{metadata()!.itemCount === 1 ? "" : "s"}
            </FieldValue>
          </FieldRow>
        </Show>

        <FieldRow label="Modified" readOnly>
          <FieldValue>
            <Show when={!metadata.loading} fallback="Loading…">
              {formatDate(metadata()?.modified ?? null)}
            </Show>
          </FieldValue>
        </FieldRow>

        <FieldRow label="Created" readOnly>
          <FieldValue>
            <Show when={!metadata.loading} fallback="Loading…">
              {formatDate(metadata()?.created ?? null)}
            </Show>
          </FieldValue>
        </FieldRow>

        <FieldRow label="Attributes" readOnly>
          <FieldValue>
            <Show when={!metadata.loading} fallback="Loading…">
              {metadata()?.readonly ? "Read-only" : "Read/Write"}
            </Show>
          </FieldValue>
        </FieldRow>

        {metadata.error && <p class="settings-error">{String(metadata.error)}</p>}
      </FieldGroup>
    </Modal>
  );
}
