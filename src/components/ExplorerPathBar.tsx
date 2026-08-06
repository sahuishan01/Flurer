import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { EnterIcon, FolderIcon, StarIcon } from "./icons";
import { pathSegments } from "../lib/fs";
import { clampPopoverPosition } from "../lib/popover";

type ExplorerPathBarProps = {
  path: string;
  pathInput: string;
  onPathInputChange: (value: string) => void;
  onNavigate: (path: string) => void;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
};

export function ExplorerPathBar(props: ExplorerPathBarProps) {
  const [open, setOpen] = createSignal(false);
  const [popoverPos, setPopoverPos] = createSignal<Record<string, string>>({});
  let containerRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let anchorRect: DOMRect | undefined;

  // Navigating away (breadcrumb click, sidebar, back/forward) should always
  // close the overlay rather than leaving it open pointed at a stale path.
  createEffect(() => {
    props.path;
    setOpen(false);
  });

  function positionPopover(panelEl: HTMLDivElement) {
    if (!anchorRect) return;
    setPopoverPos(clampPopoverPosition(anchorRect, panelEl.getBoundingClientRect()));
  }

  function openPopover(btn: HTMLElement) {
    anchorRect = btn.getBoundingClientRect();
    props.onPathInputChange(props.path);
    setOpen(true);
    queueMicrotask(() => inputRef?.focus());
  }

  function handlePointerDown(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) setOpen(false);
  }
  onMount(() => document.addEventListener("mousedown", handlePointerDown));
  onCleanup(() => document.removeEventListener("mousedown", handlePointerDown));

  return (
    <div class="explorer-path-bar" ref={containerRef}>
      <button
        type="button"
        class="icon-btn"
        classList={{ active: open() }}
        title={props.path}
        aria-label="Go to path"
        aria-expanded={open()}
        onClick={(e) => (open() ? setOpen(false) : openPopover(e.currentTarget))}
      >
        <FolderIcon size={16} />
      </button>

      <Show when={open()}>
        <div class="path-popover" style={popoverPos()} ref={(el) => positionPopover(el)}>
          <div class="breadcrumb">
            <For each={pathSegments(props.path)}>
              {(segment, index) => (
                <>
                  <Show when={index() > 0}>
                    <span class="breadcrumb-sep">›</span>
                  </Show>
                  <button
                    type="button"
                    class="breadcrumb-segment"
                    onClick={() => {
                      props.onNavigate(segment.path);
                      setOpen(false);
                    }}
                  >
                    {segment.label}
                  </button>
                </>
              )}
            </For>
          </div>
          <form
            class="path-form"
            onSubmit={(e) => {
              e.preventDefault();
              props.onNavigate(props.pathInput);
              setOpen(false);
            }}
          >
            <input
              ref={inputRef}
              class="path-input"
              value={props.pathInput}
              onInput={(e) => props.onPathInputChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <button type="submit" class="icon-btn" title="Go" aria-label="Go">
              <EnterIcon size={16} />
            </button>
          </form>
        </div>
      </Show>

      <button
        type="button"
        class="icon-btn"
        classList={{ active: props.favouritePaths.includes(props.path) }}
        title={props.favouritePaths.includes(props.path) ? "Remove from Favourites" : "Add to Favourites"}
        aria-label={props.favouritePaths.includes(props.path) ? "Remove from Favourites" : "Add to Favourites"}
        onClick={() => props.onToggleFavourite(props.path)}
      >
        <StarIcon size={16} filled={props.favouritePaths.includes(props.path)} />
      </button>
    </div>
  );
}
