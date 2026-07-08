import { createSignal, For, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { GearIcon, GraphIcon } from "./icons";
import type { MainView } from "../lib/view";

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
  activeView: MainView;
  onSelectView: (view: MainView) => void;
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
      <div class="sidebar-top">
        <button
          type="button"
          class="sidebar-item"
          classList={{ active: props.activeView === "graph" }}
          onClick={() => props.onSelectView("graph")}
        >
          <span class="sidebar-icon">
            <GraphIcon size={16} />
          </span>
          Graph
        </button>

        <div class="sidebar-divider" />

        <For each={entries()}>
          {(entry) => (
            <button
              type="button"
              class="sidebar-item"
              classList={{ active: props.activeView === "explorer" && props.currentPath === entry.path }}
              onClick={() => props.onNavigate(entry.path)}
            >
              <span class="sidebar-icon">{ICONS[entry.label] ?? "📁"}</span>
              {entry.label}
            </button>
          )}
        </For>
      </div>

      <div class="sidebar-bottom">
        <button type="button" class="sidebar-item" onClick={() => props.onSelectView("settings")}>
          <span class="sidebar-icon">
            <GearIcon size={16} />
          </span>
          Settings
        </button>
      </div>
    </nav>
  );
}
