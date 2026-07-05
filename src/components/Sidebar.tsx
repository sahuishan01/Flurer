import { createSignal, For, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

type QuickAccessEntry = {
  label: string;
  path: string;
};

const ICONS: Record<string, string> = {
  Desktop: "🖥️",
  Documents: "📄",
  Downloads: "⬇️",
  Pictures: "🖼️",
  Music: "🎵",
  Videos: "🎬",
};

type SidebarProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

export function Sidebar(props: SidebarProps) {
  const [entries, setEntries] = createSignal<QuickAccessEntry[]>([]);

  onMount(async () => {
    try {
      const result = await invoke<QuickAccessEntry[]>("get_quick_access");
      setEntries(result);
    } catch (err) {
      console.error("Failed to load quick access entries", err);
    }
  });

  return (
    <nav class="sidebar">
      <For each={entries()}>
        {(entry) => (
          <button
            type="button"
            class="sidebar-item"
            classList={{ active: props.currentPath === entry.path }}
            onClick={() => props.onNavigate(entry.path)}
          >
            <span class="sidebar-icon">{ICONS[entry.label] ?? "📁"}</span>
            {entry.label}
          </button>
        )}
      </For>
    </nav>
  );
}
