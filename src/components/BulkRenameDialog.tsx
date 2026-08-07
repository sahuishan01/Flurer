import { createMemo, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import type { DirEntry } from "../lib/fs";

type BulkRenameDialogProps = {
  entries: DirEntry[];
  onClose: () => void;
  // Reports the from/to pairs that actually succeeded so the caller can
  // push a single undo entry and refresh the listing — mirrors how the
  // other batch operations in FileList report back via BatchResult.
  onRenamed: (renamed: { from: string; to: string }[], failures: { path: string; error: string }[]) => void;
};

type NumberPosition = "prefix" | "suffix";

// Splits "photo.jpg" into ("photo", ".jpg"); a name with no extension (or a
// dotfile like ".gitignore", where the leading dot isn't an extension
// marker) keeps the whole thing as the stem.
function splitName(name: string, isDir: boolean): { stem: string; ext: string } {
  if (isDir) return { stem: name, ext: "" };
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dotIndex), ext: name.slice(dotIndex) };
}

export function BulkRenameDialog(props: BulkRenameDialogProps) {
  const [findText, setFindText] = createSignal("");
  const [replaceText, setReplaceText] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [numbering, setNumbering] = createSignal(false);
  const [startAt, setStartAt] = createSignal(1);
  const [padding, setPadding] = createSignal(2);
  const [position, setPosition] = createSignal<NumberPosition>("suffix");
  const [applying, setApplying] = createSignal(false);
  const [applyError, setApplyError] = createSignal("");

  const preview = createMemo(() => {
    const find = findText();
    const results: { path: string; oldName: string; newName: string }[] = [];
    let counter = startAt();

    for (const entry of props.entries) {
      const { stem, ext } = splitName(entry.name, entry.isDir);
      let newStem = stem;

      if (find) {
        if (caseSensitive()) {
          newStem = newStem.split(find).join(replaceText());
        } else {
          // Case-insensitive split/join: find every match ignoring case but
          // preserve everything else in the original casing.
          const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          newStem = newStem.replace(re, replaceText());
        }
      }

      if (numbering()) {
        const numStr = String(counter).padStart(padding(), "0");
        newStem = position() === "prefix" ? `${numStr}-${newStem}` : `${newStem}-${numStr}`;
        counter++;
      }

      results.push({ path: entry.path, oldName: entry.name, newName: `${newStem}${ext}` });
    }
    return results;
  });

  // Conflicts within the batch itself (two items landing on the same new
  // name) are the only ones checked up front — a conflict with something
  // already sitting in the folder outside the selection still surfaces,
  // just per-item via rename_item's own "already exists" error when Apply
  // runs, the same way any other rename failure is reported.
  const duplicateNames = createMemo(() => {
    const seen = new Map<string, number>();
    for (const { newName } of preview()) {
      const key = newName.toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name));
  });

  const changedCount = createMemo(() => preview().filter((p) => p.newName !== p.oldName).length);

  async function applyRename() {
    if (changedCount() === 0 || duplicateNames().size > 0) return;
    setApplying(true);
    setApplyError("");
    const renamed: { from: string; to: string }[] = [];
    const failures: { path: string; error: string }[] = [];
    try {
      for (const { path, oldName, newName } of preview()) {
        if (newName === oldName) continue;
        try {
          const newPath = await invoke<string>("rename_item", { path, newName });
          renamed.push({ from: path, to: newPath });
        } catch (err) {
          failures.push({ path, error: String(err) });
        }
      }
      props.onRenamed(renamed, failures);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal title={`Bulk rename (${props.entries.length} items)`} onClose={props.onClose}>
      <div class="bulk-rename-controls">
        <label class="bulk-rename-field">
          Find
          <input type="text" value={findText()} onInput={(e) => setFindText(e.currentTarget.value)} placeholder="Text to find" />
        </label>
        <label class="bulk-rename-field">
          Replace with
          <input type="text" value={replaceText()} onInput={(e) => setReplaceText(e.currentTarget.value)} />
        </label>
        <label class="bulk-rename-checkbox">
          <input type="checkbox" checked={caseSensitive()} onChange={(e) => setCaseSensitive(e.currentTarget.checked)} />
          Case-sensitive
        </label>

        <div class="bulk-rename-divider" />

        <label class="bulk-rename-checkbox">
          <input type="checkbox" checked={numbering()} onChange={(e) => setNumbering(e.currentTarget.checked)} />
          Number sequentially
        </label>
        <Show when={numbering()}>
          <div class="bulk-rename-numbering-row">
            <label class="bulk-rename-field bulk-rename-field-small">
              Start at
              <input
                type="number"
                min="0"
                value={startAt()}
                onInput={(e) => setStartAt(Math.max(0, Number(e.currentTarget.value) || 0))}
              />
            </label>
            <label class="bulk-rename-field bulk-rename-field-small">
              Digits
              <input
                type="number"
                min="1"
                max="6"
                value={padding()}
                onInput={(e) => setPadding(Math.min(6, Math.max(1, Number(e.currentTarget.value) || 1)))}
              />
            </label>
            <label class="bulk-rename-field bulk-rename-field-small">
              Position
              <select value={position()} onChange={(e) => setPosition(e.currentTarget.value as NumberPosition)}>
                <option value="suffix">Suffix</option>
                <option value="prefix">Prefix</option>
              </select>
            </label>
          </div>
        </Show>
      </div>

      <div class="bulk-rename-preview">
        <For each={preview()}>
          {(item) => (
            <div class="bulk-rename-preview-row" classList={{ conflict: duplicateNames().has(item.newName.toLowerCase()) }}>
              <span class="bulk-rename-old" title={item.oldName}>
                {item.oldName}
              </span>
              <span class="bulk-rename-arrow">→</span>
              <span class="bulk-rename-new" title={item.newName}>
                {item.newName}
              </span>
            </div>
          )}
        </For>
      </div>

      <Show when={duplicateNames().size > 0}>
        <p class="settings-error">Two or more items would end up with the same name — adjust the pattern above.</p>
      </Show>
      {applyError() && <p class="settings-error">{applyError()}</p>}

      <div class="modal-actions">
        <button type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn-accent"
          disabled={changedCount() === 0 || duplicateNames().size > 0 || applying()}
          onClick={applyRename}
        >
          {applying() ? "Renaming…" : `Rename ${changedCount()} item${changedCount() === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}
