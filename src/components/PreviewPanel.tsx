import { createResource, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { CloseIcon, FileIcon } from "./icons";
import { baseName } from "../lib/fs";

type FilePreview =
  | { kind: "image"; dataUrl: string }
  | { kind: "text"; content: string; truncated: boolean }
  | { kind: "tooLarge" }
  | { kind: "unsupported" };

type PreviewPanelProps = {
  path: string;
  onClose: () => void;
};

export function PreviewPanel(props: PreviewPanelProps) {
  const [preview] = createResource(
    () => props.path,
    (path) => invoke<FilePreview>("get_file_preview", { path }),
  );

  return (
    <div class="preview-panel">
      <div class="preview-panel-header">
        <span class="preview-panel-title" title={baseName(props.path)}>
          {baseName(props.path)}
        </span>
        <button type="button" class="icon-btn" title="Close preview" aria-label="Close preview" onClick={props.onClose}>
          <CloseIcon size={14} />
        </button>
      </div>

      <div class="preview-panel-body">
        <Show when={!preview.loading} fallback={<p class="preview-panel-hint">Loading…</p>}>
          <Show when={!preview.error} fallback={<p class="preview-panel-hint">{String(preview.error)}</p>}>
            {(() => {
              const p = preview();
              if (!p) return null;
              if (p.kind === "image") {
                return <img class="preview-panel-image" src={p.dataUrl} alt={baseName(props.path)} />;
              }
              if (p.kind === "text") {
                return (
                  <>
                    <pre class="preview-panel-text">{p.content}</pre>
                    <Show when={p.truncated}>
                      <p class="preview-panel-hint">Showing the first part of this file only.</p>
                    </Show>
                  </>
                );
              }
              if (p.kind === "tooLarge") {
                return <p class="preview-panel-hint">Too large to preview.</p>;
              }
              return (
                <div class="preview-panel-empty">
                  <FileIcon size={28} />
                  <p class="preview-panel-hint">No preview available for this file type.</p>
                </div>
              );
            })()}
          </Show>
        </Show>
      </div>
    </div>
  );
}
