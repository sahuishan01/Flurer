import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { formatBytes, type BatchResult } from "../lib/fs";
import { TrashIcon } from "./icons";

type DuplicateEntry = { path: string; modified: number | null };
type DuplicateGroup = { size: number; entries: DuplicateEntry[] };

type DuplicateFinderModalProps = {
  rootPath: string;
  onClose: () => void;
  // Called after a successful delete so the folder listing behind this
  // modal picks up the removed files instead of showing stale entries.
  onDeleted: () => void;
};

export function DuplicateFinderModal(props: DuplicateFinderModalProps) {
  const [groups, setGroups] = createSignal<DuplicateGroup[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [selected, setSelected] = createSignal<Set<string>>(new Set<string>());
  const [deleting, setDeleting] = createSignal(false);

  onMount(async () => {
    try {
      setGroups(await invoke<DuplicateGroup[]>("find_duplicates", { root: props.rootPath }));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  });

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // The common "clean up duplicates" action: keep one copy per group
  // (whichever the backend listed first — no particular ordering promise,
  // just "some one of them"), select every other copy for deletion.
  function selectAllButFirst() {
    const next = new Set<string>();
    for (const g of groups()) {
      for (const e of g.entries.slice(1)) next.add(e.path);
    }
    setSelected(next);
  }

  const totalWaste = createMemo(() => groups().reduce((sum, g) => sum + g.size * (g.entries.length - 1), 0));
  const selectedSize = createMemo(() => {
    const sel = selected();
    let sum = 0;
    for (const g of groups()) for (const e of g.entries) if (sel.has(e.path)) sum += g.size;
    return sum;
  });

  async function deleteSelected() {
    if (selected().size === 0) return;
    setDeleting(true);
    setError("");
    try {
      const result = await invoke<BatchResult>("delete_items", { paths: [...selected()] });
      if (result.failed.length > 0) {
        setError(result.failed.map((f) => `${f.path}: ${f.error}`).join("; "));
      }
      const deletedSet = new Set(result.succeeded);
      // Drop deleted entries locally rather than re-scanning — a rescan
      // would re-hash everything remaining just to remove a few rows, and
      // a group with only one surviving copy is no longer a duplicate.
      setGroups((prev) =>
        prev
          .map((g) => ({ ...g, entries: g.entries.filter((e) => !deletedSet.has(e.path)) }))
          .filter((g) => g.entries.length > 1),
      );
      setSelected(new Set<string>());
      props.onDeleted();
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal title="Find Duplicate Files" onClose={props.onClose}>
      <Show when={!loading()} fallback={<p class="settings-hint">Scanning…</p>}>
        <Show when={groups().length > 0} fallback={<p class="settings-hint">No duplicate files found.</p>}>
          <p class="settings-hint">
            {groups().length} group{groups().length === 1 ? "" : "s"} — {formatBytes(totalWaste())} could be freed.
          </p>
          <div class="duplicate-groups">
            <For each={groups()}>
              {(group) => (
                <div class="duplicate-group">
                  <div class="duplicate-group-header">
                    {formatBytes(group.size)} each · {group.entries.length} copies
                  </div>
                  <For each={group.entries}>
                    {(entry) => (
                      <label class="duplicate-entry">
                        <input type="checkbox" checked={selected().has(entry.path)} onChange={() => toggle(entry.path)} />
                        <span class="duplicate-entry-path" title={entry.path}>
                          {entry.path}
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
      {error() && <p class="file-list-error">{error()}</p>}
      <div class="modal-actions">
        <Show when={groups().length > 0}>
          <button type="button" onClick={selectAllButFirst} disabled={deleting()}>
            Select all but first in each group
          </button>
        </Show>
        <button type="button" onClick={props.onClose} disabled={deleting()}>
          Close
        </button>
        <button type="button" class="danger" disabled={selected().size === 0 || deleting()} onClick={deleteSelected}>
          <TrashIcon size={14} /> Delete selected{selected().size > 0 ? ` (${formatBytes(selectedSize())})` : ""}
        </button>
      </div>
    </Modal>
  );
}
