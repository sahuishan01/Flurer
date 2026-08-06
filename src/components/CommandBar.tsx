import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ArrowLeftIcon, ArrowRightIcon, LayersIcon, SearchIcon } from "./icons";
import { ProgressIndicator } from "./ProgressIndicator";
import { clampPopoverPosition } from "../lib/popover";

type CommandBarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
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
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [popoverPos, setPopoverPos] = createSignal<Record<string, string>>({});
  let containerRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let anchorRect: DOMRect | undefined;

  function positionPopover(panelEl: HTMLDivElement) {
    if (!anchorRect) return;
    setPopoverPos(clampPopoverPosition(anchorRect, panelEl.getBoundingClientRect()));
  }

  function openSearch(btn: HTMLElement) {
    anchorRect = btn.getBoundingClientRect();
    setSearchOpen(true);
    queueMicrotask(() => inputRef?.focus());
  }

  function handlePointerDown(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) setSearchOpen(false);
  }
  onMount(() => document.addEventListener("mousedown", handlePointerDown));
  onCleanup(() => document.removeEventListener("mousedown", handlePointerDown));

  return (
    <div class="command-bar" data-bg-lightness={props["data-bg-lightness"]}>
      <div class="command-bar-nav">
        <button type="button" class="icon-btn" aria-label="Back" disabled={!props.canGoBack} onClick={props.onBack}>
          <ArrowLeftIcon size={18} />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Forward"
          disabled={!props.canGoForward}
          onClick={props.onForward}
        >
          <ArrowRightIcon size={18} />
        </button>
      </div>

      <div class="command-bar-slot">{props.viewControls}</div>

      <div class="search-trigger" ref={containerRef}>
        <button
          type="button"
          class="icon-btn"
          classList={{ active: searchOpen() || props.searchQuery.length > 0 }}
          title="Search"
          aria-label="Search"
          aria-expanded={searchOpen()}
          onClick={(e) => (searchOpen() ? setSearchOpen(false) : openSearch(e.currentTarget))}
        >
          <SearchIcon size={16} />
        </button>

        <Show when={searchOpen()}>
          <div class="search-popover" style={popoverPos()} ref={(el) => positionPopover(el)}>
            <div class="search-field">
              <SearchIcon size={15} />
              <input
                ref={inputRef}
                type="text"
                class="search-input"
                placeholder="Search…"
                value={props.searchQuery}
                onInput={(e) => props.onSearchQueryChange(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                  if (e.key === "Enter") setSearchOpen(false);
                }}
              />
            </div>
          </div>
        </Show>
      </div>

      <button
        type="button"
        class="icon-btn"
        classList={{ active: props.searchRecursive }}
        title="Include subfolders"
        aria-label="Include subfolders"
        aria-pressed={props.searchRecursive}
        onClick={() => props.onSearchRecursiveChange(!props.searchRecursive)}
      >
        <LayersIcon size={16} />
      </button>

      <ProgressIndicator showWhenIdle={props.showProgressWhenIdle} />
    </div>
  );
}
