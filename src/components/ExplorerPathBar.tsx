import { createEffect, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { EnterIcon, FolderIcon, StarIcon } from "./icons";
import { parentDir, pathSegments, type DirListing } from "../lib/fs";
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
      setSuggestions([]);
      queueMicrotask(() => inputRef?.focus());
    }
  }

  // Address-bar autocomplete: suggests subfolders of whatever's typed so
  // far. Keyed by parent directory rather than the whole typed string so
  // narrowing the partial segment (typing more letters after the last
  // separator) reuses the same listing instead of re-invoking Rust on every
  // keystroke.
  const [suggestions, setSuggestions] = createSignal<string[]>([]);
  const [highlightIndex, setHighlightIndex] = createSignal(-1);
  let listingCache = new Map<string, string[]>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function joinPath(parent: string, name: string): string {
    const withSep = /[\\/]$/.test(parent) ? parent : `${parent}\\`;
    return `${withSep}${name}\\`;
  }

  async function loadSuggestions(value: string) {
    const parent = parentDir(value);
    if (!parent || parent === value) {
      setSuggestions([]);
      return;
    }
    const partial = value
      .slice(parent.length)
      .replace(/^[\\/]+/, "")
      .toLowerCase();

    let names = listingCache.get(parent);
    if (names === undefined) {
      try {
        const listing = await invoke<DirListing>("list_directory", {
          path: parent,
          sortKey: "name",
          sortDirection: "ascending",
        });
        names = listing.entries.filter((e) => e.isDir).map((e) => e.name);
      } catch {
        names = [];
      }
      listingCache.set(parent, names);
    }

    // Stale response guard: the input may have moved on to a different
    // parent directory by the time this resolves.
    if (parentDir(props.pathInput) !== parent) return;
    const filtered = (partial ? names.filter((n) => n.toLowerCase().startsWith(partial)) : names).slice(0, 8);
    setSuggestions(filtered);
    setHighlightIndex(-1);
  }

  function handlePathInput(value: string) {
    props.onPathInputChange(value);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadSuggestions(value), 120);
  }

  function acceptSuggestion(name: string) {
    const full = joinPath(parentDir(props.pathInput), name);
    props.onPathInputChange(full);
    setSuggestions([]);
    props.onNavigate(full);
    close();
  }

  function handleInputKeyDown(e: KeyboardEvent) {
    const list = suggestions();
    if (list.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % list.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? list.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setSuggestions([]);
    } else if (e.key === "Enter" && highlightIndex() >= 0) {
      e.preventDefault();
      acceptSuggestion(list[highlightIndex()]);
    }
  }

  return (
    <div class="explorer-path-bar selectable-text" ref={containerRef}>
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
                    data-drop-path={segment.path}
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
              const list = suggestions();
              const idx = highlightIndex();
              if (idx >= 0 && idx < list.length) {
                acceptSuggestion(list[idx]);
                return;
              }
              props.onNavigate(props.pathInput);
              close();
            }}
          >
            <input
              ref={inputRef}
              class="path-input"
              value={props.pathInput}
              onInput={(e) => handlePathInput(e.currentTarget.value)}
              onKeyDown={handleInputKeyDown}
              autocomplete="off"
              spellcheck={false}
            />
            <button type="submit" class="icon-btn" title="Go" aria-label="Go">
              <EnterIcon size={16} />
            </button>
          </form>

          <Show when={suggestions().length > 0}>
            <ul class="path-suggestions" role="listbox">
              <For each={suggestions()}>
                {(name, index) => (
                  <li
                    role="option"
                    aria-selected={highlightIndex() === index()}
                    classList={{ highlighted: highlightIndex() === index() }}
                    onMouseEnter={() => setHighlightIndex(index())}
                    onMouseDown={(e) => {
                      // mousedown, not click — fires before the input's blur,
                      // so the popover doesn't close itself out from under
                      // the click first.
                      e.preventDefault();
                      acceptSuggestion(name);
                    }}
                  >
                    <FolderIcon size={13} />
                    {name}
                  </li>
                )}
              </For>
            </ul>
          </Show>
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
