import { createSignal, onCleanup, onMount } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBarControls() {
  const [isMaximized, setIsMaximized] = createSignal(false);

  async function checkMaximized() {
    try {
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch {
      // Not running in Tauri (dev mode) — silently noop.
    }
  }

  onMount(() => {
    checkMaximized();
    // ResizeObserver is more reliable than Tauri's onResized which may not
    // exist in all Tauri v2 versions.
    const observer = new ResizeObserver(() => checkMaximized());
    observer.observe(document.body);
    onCleanup(() => observer.disconnect());
  });

  function minimize() {
    getCurrentWindow().minimize();
  }

  function toggleMaximize() {
    getCurrentWindow().toggleMaximize();
  }

  function closeWindow() {
    getCurrentWindow().close();
  }

  return (
    <div class="titlebar-controls">
      <button
        type="button"
        class="titlebar-btn titlebar-btn-minimize"
        aria-label="Minimize"
        onClick={minimize}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        class="titlebar-btn titlebar-btn-maximize"
        aria-label={isMaximized() ? "Restore" : "Maximize"}
        onClick={toggleMaximize}
      >
        {isMaximized() ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="0" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.8" />
            <rect x="0" y="3" width="7" height="7" rx="0.5" fill="var(--panel-bg)" stroke="currentColor" stroke-width="0.8" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0" y="0" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="0.8" />
          </svg>
        )}
      </button>

      <button
        type="button"
        class="titlebar-btn titlebar-btn-close"
        aria-label="Close"
        onClick={closeWindow}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>
  );
}