import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./Modal";
import { RefreshIcon, TrashIcon, UndoIcon } from "./icons";
import type { TrashEntry } from "../lib/fs";

type TrashViewProps = {
  "data-bg-lightness"?: string;
};

function formatDeleted(timeDeleted: number): string {
  if (timeDeleted <= 0) return "";
  return new Date(timeDeleted * 1000).toLocaleString();
}

export function TrashView(props: TrashViewProps) {
  const [entries, setEntries] = createSignal<TrashEntry[]>([]);
  const [selected, setSelected] = createSignal<Set<string>>(new Set<string>());
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [confirmPurge, setConfirmPurge] = createSignal<"selected" | "all" | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<TrashEntry[]>("list_trash");
      // Newest-deleted first — the items someone's most likely to be
      // looking to restore right after a delete they regret.
      setEntries([...result].sort((a, b) => b.timeDeleted - a.timeDeleted));
      setSelected((prev) => {
        const ids = new Set(result.map((e) => e.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  onMount(refresh);

  const allSelected = createMemo(() => entries().length > 0 && selected().size === entries().length);

  function toggleAll() {
    setSelected(allSelected() ? new Set<string>() : new Set(entries().map((e) => e.id)));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function restoreSelected() {
    setError("");
    try {
      await invoke("restore_trash_items", { ids: [...selected()] });
      setSelected(new Set<string>());
      refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function purgeSelected() {
    setConfirmPurge(null);
    setError("");
    try {
      await invoke("delete_trash_items_forever", { ids: [...selected()] });
      setSelected(new Set<string>());
      refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function emptyTrash() {
    setConfirmPurge(null);
    setError("");
    try {
      await invoke("empty_trash");
      setSelected(new Set<string>());
      refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div class="trash-view" data-bg-lightness={props["data-bg-lightness"]}>
      <div class="trash-toolbar">
        <h2 class="trash-title">Recycle Bin</h2>
        <div class="trash-toolbar-actions">
          <button type="button" onClick={refresh} title="Refresh">
            <RefreshIcon size={14} /> Refresh
          </button>
          <button type="button" disabled={selected().size === 0} onClick={restoreSelected}>
            <UndoIcon size={14} /> Restore{selected().size > 0 ? ` (${selected().size})` : ""}
          </button>
          <button
            type="button"
            class="danger"
            disabled={selected().size === 0}
            onClick={() => setConfirmPurge("selected")}
          >
            <TrashIcon size={14} /> Delete Forever{selected().size > 0 ? ` (${selected().size})` : ""}
          </button>
          <button type="button" class="danger" disabled={entries().length === 0} onClick={() => setConfirmPurge("all")}>
            Empty Recycle Bin
          </button>
        </div>
      </div>

      {error() && <p class="file-list-error">{error()}</p>}

      <Show when={!loading()} fallback={<p class="settings-hint">Loading…</p>}>
        <Show
          when={entries().length > 0}
          fallback={<p class="settings-hint">The Recycle Bin is empty.</p>}
        >
          <table
            class="file-table trash-table"
            role="grid"
            aria-label="Recycle Bin"
            aria-multiselectable="true"
            aria-rowcount={1 + entries().length}
          >
            <thead>
              <tr aria-rowindex={1}>
                <th>
                  <input type="checkbox" checked={allSelected()} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th>Name</th>
                <th>Original location</th>
                <th>Deleted</th>
              </tr>
            </thead>
            <tbody>
              <For each={entries()}>
                {(entry, index) => (
                  <tr
                    class="file-row"
                    classList={{ "file-row-selected": selected().has(entry.id) }}
                    aria-selected={selected().has(entry.id)}
                    // The header row is row 1, so the first entry is row 2.
                    aria-rowindex={index() + 2}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected().has(entry.id)}
                        onChange={() => toggle(entry.id)}
                        aria-label={`Select ${entry.name}`}
                      />
                    </td>
                    <td>{entry.name}</td>
                    <td class="file-location">{entry.originalPath}</td>
                    <td>{formatDeleted(entry.timeDeleted)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>

      {confirmPurge() && (
        <Modal
          title={confirmPurge() === "all" ? "Empty Recycle Bin?" : "Delete forever?"}
          onClose={() => setConfirmPurge(null)}
        >
          <p>
            {confirmPurge() === "all"
              ? `All ${entries().length} item(s) in the Recycle Bin will be permanently deleted. This cannot be undone.`
              : `${selected().size} item(s) will be permanently deleted. This cannot be undone.`}
          </p>
          <div class="modal-actions">
            <button type="button" onClick={() => setConfirmPurge(null)}>
              Cancel
            </button>
            <button type="button" class="danger" onClick={confirmPurge() === "all" ? emptyTrash : purgeSelected}>
              <TrashIcon size={14} /> Delete Forever
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
