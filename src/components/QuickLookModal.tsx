import { createResource, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { baseName } from "../lib/fs";

// Mirrors PreviewPanel's FilePreview.
type FilePreview =
  | { kind: "image"; dataUrl: string }
  | { kind: "text"; content: string; truncated: boolean }
  | { kind: "tooLarge" }
  | { kind: "unsupported" };

type QuickLookModalProps = {
  path: string;
  onClose: () => void;
};

// macOS-style transient preview: one key (Space) opens a centered overlay
// with the file's image or text content, Escape closes it. Reuses the same
// backend command as the PreviewPanel, so oversized/unsupported files fall
// back to a message instead of reading something huge into the UI.
export function QuickLookModal(props: QuickLookModalProps) {
  const [preview] = createResource(
    () => props.path,
    (path) => invoke<FilePreview>("get_file_preview", { path }),
  );

  return (
    <div class="modal-backdrop quick-look-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="quick-look-panel" role="dialog" aria-modal="true" aria-label={`Quick look: ${baseName(props.path)}`}>
        <div class="quick-look-title">{baseName(props.path)}</div>
        <div class="quick-look-body">
          <Show
            when={preview()}
            fallback={<div class="quick-look-status">Loading…</div>}
          >
            {(p) => (
              <Show
                when={p().kind === "image" || p().kind === "text"}
                fallback={<div class="quick-look-status">No preview available for this file type</div>}
              >
                <Show
                  when={p().kind === "image"}
                  fallback={<pre class="quick-look-text selectable-text">{(p() as { kind: "text"; content: string }).content}</pre>}
                >
                  <img class="quick-look-image" src={(p() as { kind: "image"; dataUrl: string }).dataUrl} alt="" draggable={false} />
                </Show>
              </Show>
            )}
          </Show>
        </div>
        <div class="quick-look-footer">Space or Esc to close</div>
      </div>
    </div>
  );
}
