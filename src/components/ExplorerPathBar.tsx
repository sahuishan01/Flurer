import { createEffect, For, Show } from "solid-js";
import { EnterIcon, FolderIcon, StarIcon } from "./icons";
import { pathSegments } from "../lib/fs";
import { createPopover } from "../lib/popover";

type ExplorerPathBarProps = {
  path: string;
  pathInput: string;
  onPathInputChange: (value: string) => void;
  onNavigate: (path: string) => void;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
};

export function ExplorerPathBar(props: ExplorerPathBarProps) {
  const { open, pos, containerRef, panelRef, toggle, close } = createPopover();
  let inputRef: HTMLInputElement | undefined;

  // Navigating away (breadcrumb click, sidebar, back/forward) should always
  // close the overlay rather than leaving it open pointed at a stale path.
  createEffect(() => {
    props.path;
    close();
  });

  function openPopover(btn: HTMLElement) {
    toggle(btn);
    if (open()) {
      props.onPathInputChange(props.path);
      queueMicrotask(() => inputRef?.focus());
    }
  }

  return (
    <div class="explorer-path-bar" ref={containerRef}>
      <button
        type="button"
        class="icon-btn"
        classList={{ active: open() }}
        title={props.path}
        aria-label="Go to path"
        aria-expanded={open()}
        onClick={(e) => openPopover(e.currentTarget)}
      >
        <FolderIcon size={16} />
      </button>

      <Show when={open()}>
        <div class="path-popover" style={pos()} ref={panelRef}>
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
                      close();
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
              close();
            }}
          >
            <input
              ref={inputRef}
              class="path-input"
              value={props.pathInput}
              onInput={(e) => props.onPathInputChange(e.currentTarget.value)}
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
