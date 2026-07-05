import { createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { SubfolderEntry } from "../lib/graph";
import { ChevronRightIcon, FolderIcon } from "./icons";

type FolderTreeNodeProps = {
  name: string;
  path: string;
};

export function FolderTreeNode(props: FolderTreeNodeProps) {
  const [expanded, setExpanded] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [children, setChildren] = createSignal<SubfolderEntry[]>([]);

  async function toggle() {
    if (!expanded() && !loaded()) {
      setLoading(true);
      setError("");
      try {
        const result = await invoke<SubfolderEntry[]>("list_subfolders", { path: props.path });
        setChildren(result);
        setLoaded(true);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }

  return (
    <div class="folder-tree-node">
      <button type="button" class="folder-tree-row" onClick={toggle}>
        <span classList={{ "chevron-wrap": true, expanded: expanded() }}>
          <ChevronRightIcon size={12} />
        </span>
        <FolderIcon size={15} />
        <span class="folder-tree-label">{props.name}</span>
        <Show when={loading()}>
          <span class="folder-tree-hint">loading…</span>
        </Show>
      </button>

      <Show when={error()}>
        <p class="folder-tree-error">{error()}</p>
      </Show>

      <Show when={expanded() && loaded()}>
        <div class="folder-tree-children">
          <Show when={children().length === 0}>
            <p class="folder-tree-hint">No subfolders</p>
          </Show>
          <For each={children()}>{(child) => <FolderTreeNode name={child.name} path={child.path} />}</For>
        </div>
      </Show>
    </div>
  );
}
