import type { JSX } from "solid-js";
import { ArrowLeftIcon, ArrowRightIcon, LayersIcon, SearchIcon } from "./icons";
import { ProgressIndicator } from "./ProgressIndicator";

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
};

export function CommandBar(props: CommandBarProps) {
  return (
    <div class="command-bar">
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

      <div class="search-field">
        <SearchIcon size={15} />
        <input
          type="text"
          class="search-input"
          placeholder="Search…"
          value={props.searchQuery}
          onInput={(e) => props.onSearchQueryChange(e.currentTarget.value)}
        />
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

      <ProgressIndicator />
    </div>
  );
}
