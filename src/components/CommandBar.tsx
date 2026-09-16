import { Show, type JSX } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, RecursiveIcon, SearchIcon } from "./icons";
import { ProgressIndicator } from "./ProgressIndicator";
import { createPopover } from "../lib/popover";

// Native title bar is replaced by the command bar itself (decorations are
// off) — it carries the OS drag region and the min/max/close controls so
// the window chrome blends into the app instead of rendering as an
// unstyleable black strip above the acrylic shell.
function WindowControls() {
  const win = getCurrentWindow();
  return (
    <div class="window-controls">
      <button type="button" class="window-control-btn" aria-label="Minimize" title="Minimize" onClick={() => win.minimize()}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 6h10" stroke="currentColor" stroke-width="1.4" /></svg>
      </button>
      <button type="button" class="window-control-btn" aria-label="Maximize" title="Maximize / Restore" onClick={() => win.toggleMaximize()}>
        <svg width="11" height="11" viewBox="0 0 10 10"><rect x="0.7" y="0.7" width="8.6" height="8.6" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
      </button>
      <button type="button" class="window-control-btn window-control-close" aria-label="Close" title="Close" onClick={() => win.close()}>
        <svg width="11" height="11" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.4" /></svg>
      </button>
    </div>
  );
}

type CommandBarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp?: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp?: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchRecursive: boolean;
  onSearchRecursiveChange: (recursive: boolean) => void;
  // Whatever the active view needs inline in this bar (e.g. the Explorer's
  // path breadcrumb) — the bar itself stays generic and doesn't know what a
  // path or a breadcrumb is.
  viewControls?: JSX.Element;
  showProgressWhenIdle?: boolean;
  "data-bg-lightness"?: string;
};

export function CommandBar(props: CommandBarProps) {
  const { open: searchOpen, pos, containerRef, panelRef, toggle, close } = createPopover();
  let inputRef: HTMLInputElement | undefined;

  function openSearch(btn: HTMLElement) {
    toggle(btn);
    if (searchOpen()) queueMicrotask(() => inputRef?.focus());
  }

  return (
    <div class="command-bar" data-tauri-drag-region data-bg-lightness={props["data-bg-lightness"]}>
      <div class="command-bar-nav">
        <button type="button" class="icon-btn" aria-label="Back" title="Back" disabled={!props.canGoBack} onClick={props.onBack}>
          <ArrowLeftIcon size={18} />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Forward"
          title="Forward"
          disabled={!props.canGoForward}
          onClick={props.onForward}
        >
          <ArrowRightIcon size={18} />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Up"
          title="Up (Go to parent folder)"
          disabled={!props.canGoUp}
          onClick={props.onUp}
        >
          <ArrowUpIcon size={18} />
        </button>
      </div>

      <div class="command-bar-slot" data-tauri-drag-region>{props.viewControls}</div>

      <div class="search-trigger" ref={containerRef}>
        <button
          type="button"
          class="icon-btn"
          classList={{ active: searchOpen() || props.searchQuery.length > 0 }}
          title="Search"
          aria-label="Search"
          aria-expanded={searchOpen()}
          onClick={(e) => openSearch(e.currentTarget)}
        >
          <SearchIcon size={16} />
        </button>

        <Show when={searchOpen()}>
          <div class="search-popover" style={pos()} ref={panelRef}>
            <div class="search-popover-row">
              <SearchIcon size={15} class="search-icon" />
              <input
                ref={inputRef}
                type="text"
                class="search-input"
                placeholder="Search…"
                value={props.searchQuery}
                onInput={(e) => props.onSearchQueryChange(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") close();
                }}
              />
              <button
                type="button"
                class="icon-btn search-subfolder-btn"
                classList={{ active: props.searchRecursive }}
                title="Include subfolders"
                aria-label="Include subfolders"
                aria-pressed={props.searchRecursive}
                onClick={() => props.onSearchRecursiveChange(!props.searchRecursive)}
              >
                <RecursiveIcon size={15} />
              </button>
            </div>
          </div>
        </Show>
      </div>

      <ProgressIndicator showWhenIdle={props.showProgressWhenIdle} />
      <WindowControls />
    </div>
  );
}
