import { createResource, createSignal, Show } from "solid-js";
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
  const [copyStatus, setCopyStatus] = createSignal<"idle" | "copied" | "failed">("idle");
  const [preview] = createResource(
    () => props.path,
    (path) => invoke<FilePreview>("get_file_preview", { path }),
  );

  function textContent(): string | null {
    const p = preview();
    return p?.kind === "text" ? p.content : null;
  }

  async function copyTextPreview() {
    const content = textContent();
    if (content === null) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard copy was rejected");
        textarea.remove();
      }
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch (error) {
      console.error("Failed to copy preview text", error);
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus("idle"), 2500);
    }
  }

  return (
    <div class="preview-panel">
      <div class="preview-panel-header">
        <span class="preview-panel-title" title={baseName(props.path)}>
          {baseName(props.path)}
        </span>
        <Show when={textContent() !== null}>
          <button type="button" class="preview-copy-button" onClick={copyTextPreview}>
            {copyStatus() === "copied" ? "Copied" : copyStatus() === "failed" ? "Copy failed" : "Copy"}
          </button>
        </Show>
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
