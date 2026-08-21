import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderPlusIcon, RefreshIcon, TrashIcon } from "./icons";

type IndexStatus = {
  roots: string[];
  entryCount: number;
  rebuilding: boolean;
};

type IndexProgress = {
  indexed: number;
  done: boolean;
};

type SearchIndexSettingsProps = {
  roots: string[];
  onRootsChange: (roots: string[]) => void;
};

/**
 * Controls for the name-search index. Indexing is opt-in and per-root
 * rather than automatic over every drive: building one costs a full walk,
 * and silently indexing everything a user has mounted — network shares,
 * external drives, someone else's profile — is not a decision to make on
 * their behalf.
 */
export function SearchIndexSettings(props: SearchIndexSettingsProps) {
  const [status, setStatus] = createSignal<IndexStatus | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal("");

  async function refreshStatus() {
    try {
      setStatus(await invoke<IndexStatus>("search_index_status"));
    } catch (err) {
      setError(String(err));
    }
  }

  onMount(() => {
    refreshStatus();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<IndexProgress>("search-index-progress", (event) => {
      setProgress(event.payload.indexed);
      if (event.payload.done) refreshStatus();
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
  });

  async function addRoot() {
    setError("");
    try {
      const picked = await invoke<string | null>("pick_folder");
      if (!picked || props.roots.includes(picked)) return;
      const next = [...props.roots, picked];
      props.onRootsChange(next);
      await rebuild(next);
    } catch (err) {
      setError(String(err));
    }
  }

  async function removeRoot(root: string) {
    const next = props.roots.filter((r) => r !== root);
    props.onRootsChange(next);
    // Removing the last root clears rather than rebuilds: an index with no
    // roots is just a stale copy of files nobody asked us to track.
    if (next.length === 0) {
      await invoke("clear_search_index").catch((err) => setError(String(err)));
      refreshStatus();
      return;
    }
    await rebuild(next);
  }

  async function rebuild(roots: string[]) {
    setError("");
    setProgress(0);
    try {
      await invoke("rebuild_search_index", { roots });
      refreshStatus();
    } catch (err) {
      setError(String(err));
    }
  }

  const busy = () => status()?.rebuilding ?? false;

  return (
    <section class="settings-section">
      <h3>Search index</h3>
      <p class="settings-hint">
        Indexed folders are searched from memory instead of being walked on every keystroke, which is what makes
        searching a whole drive feel instant. The index is kept current as files change; rebuild it if it ever
        looks out of date.
      </p>

      <Show when={error()}>
        <p class="file-list-error selectable-text">{error()}</p>
      </Show>

      <div class="search-index-status">
        <Show
          when={!busy()}
          fallback={<span>Indexing… {progress().toLocaleString()} items found</span>}
        >
          <Show
            when={(status()?.entryCount ?? 0) > 0}
            fallback={<span>No index yet — add a folder below to build one.</span>}
          >
            <span>{status()!.entryCount.toLocaleString()} items indexed</span>
          </Show>
        </Show>
      </div>

      <ul class="search-index-roots">
        <For each={props.roots}>
          {(root) => (
            <li>
              <span class="search-index-root-path selectable-text">{root}</span>
              <button type="button" class="icon-btn" aria-label={`Stop indexing ${root}`} onClick={() => removeRoot(root)}>
                <TrashIcon />
              </button>
            </li>
          )}
        </For>
      </ul>

      <div class="search-index-actions">
        <button type="button" onClick={addRoot} disabled={busy()}>
          <FolderPlusIcon /> Add folder
        </button>
        <button type="button" onClick={() => rebuild(props.roots)} disabled={busy() || props.roots.length === 0}>
          <RefreshIcon /> Rebuild
        </button>
        <button
          type="button"
          disabled={busy() || (status()?.entryCount ?? 0) === 0}
          onClick={async () => {
            props.onRootsChange([]);
            await invoke("clear_search_index").catch((err) => setError(String(err)));
            refreshStatus();
          }}
        >
          <TrashIcon /> Clear index
        </button>
      </div>
    </section>
  );
}
