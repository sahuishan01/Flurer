import { Show, type JSX } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, RecursiveIcon, SearchIcon } from "./icons";
import { ProgressIndicator } from "./ProgressIndicator";
import { createPopover } from "../lib/popover";

// Native title bar is replaced by the command bar itself (decorations are
// off) — it carries the OS drag region and the min/max/close controls so
// the window chrome blends into the app instead of rendering as an
// unstyleable black strip above the acrylic shell.
// Window control glyphs are CSS-drawn solid blocks rather than stroked
// SVGs — thin strokes render too faintly at this size on some DPIs, while
// filled bars/boxes keep a solid, high-contrast shape.
function WindowControls() {
  const win = getCurrentWindow();
  return (
    <div class="window-controls">
      <button type="button" class="window-control-btn" aria-label="Minimize" title="Minimize" onClick={() => win.minimize()}>
        <span class="wc-glyph wc-min" />
      </button>
      <button type="button" class="window-control-btn" aria-label="Maximize" title="Maximize / Restore" onClick={() => win.toggleMaximize()}>
        <span class="wc-glyph wc-max" />
      </button>
      <button type="button" class="window-control-btn window-control-close" aria-label="Close" title="Close" onClick={() => win.close()}>
        <span class="wc-glyph wc-close" />
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
  // Self-contained widgets rendered between the progress indicator and the
  // window controls (e.g. the top-bar system-metrics widgets) — same
  // "bar stays generic" convention as viewControls above.
  rightExtras?: JSX.Element;
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
      {/* Left zone — always pinned: history navigation. */}
      <div class="command-bar-left">
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
      </div>

      {/* Center zone — the active view's own controls (path breadcrumb). Takes
          all remaining width and can shrink/scroll independently of the
          pinned zones on either side. */}
      <div class="command-bar-center" data-tauri-drag-region>{props.viewControls}</div>

      {/* Metrics widgets are a SEPARATE direct child of the bar (not part of
          the tools zone) — at narrow widths only this element wraps onto a
          second row; progress, search and window controls always stay on
          row one. */}
      <Show when={props.rightExtras}>
        <div class="command-bar-metrics">
          {props.rightExtras}
          <span class="command-bar-divider" />
        </div>
      </Show>

      {/* Tools zone — progress + search, fixed order, never wraps. */}
      <div class="command-bar-right">
        <ProgressIndicator showWhenIdle={props.showProgressWhenIdle} />
        <span class="command-bar-divider" />

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
      </div>

      <WindowControls />
    </div>
  );
}
