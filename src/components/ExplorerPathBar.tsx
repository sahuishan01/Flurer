import { createEffect, createSignal, For, Show } from "solid-js";
import { EnterIcon, PencilIcon, StarIcon } from "./icons";
import { pathSegments } from "../lib/fs";

type ExplorerPathBarProps = {
  path: string;
  pathInput: string;
  onPathInputChange: (value: string) => void;
  onNavigate: (path: string) => void;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
};

export function ExplorerPathBar(props: ExplorerPathBarProps) {
  const [editing, setEditing] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  // Navigating away (breadcrumb click, sidebar, back/forward) should always
  // drop back to the breadcrumb view rather than leaving a stale edit form
  // pointed at whatever the user was mid-typing.
  createEffect(() => {
    props.path;
    setEditing(false);
  });

  function startEditing() {
    props.onPathInputChange(props.path);
    setEditing(true);
    queueMicrotask(() => inputRef?.focus());
  }

  return (
    <div class="explorer-path-bar">
      <Show
        when={!editing()}
        fallback={
          <form
            class="path-form"
            onSubmit={(e) => {
              e.preventDefault();
              props.onNavigate(props.pathInput);
              setEditing(false);
            }}
          >
            <input
              ref={inputRef}
              class="path-input"
              value={props.pathInput}
              onInput={(e) => props.onPathInputChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button type="submit" class="icon-btn" title="Go" aria-label="Go">
              <EnterIcon size={16} />
            </button>
          </form>
        }
      >
        <div class="breadcrumb" onClick={startEditing}>
          <For each={pathSegments(props.path)}>
            {(segment, index) => (
              <>
                <Show when={index() > 0}>
                  <span class="breadcrumb-sep">›</span>
                </Show>
                <button
                  type="button"
                  class="breadcrumb-segment"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onNavigate(segment.path);
                  }}
                >
                  {segment.label}
                </button>
              </>
            )}
          </For>
          <button type="button" class="icon-btn breadcrumb-edit-btn" title="Edit path" aria-label="Edit path">
            <PencilIcon size={13} />
          </button>
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
