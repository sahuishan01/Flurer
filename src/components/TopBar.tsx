import { ArrowLeftIcon, ArrowRightIcon, SearchIcon } from "./icons";

type TopBarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchRecursive: boolean;
  onSearchRecursiveChange: (recursive: boolean) => void;
};

export function TopBar(props: TopBarProps) {
  return (
    <div class="top-bar">
      <div class="top-bar-nav">
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

      <label class="search-recursive">
        <input
          type="checkbox"
          checked={props.searchRecursive}
          onChange={(e) => props.onSearchRecursiveChange(e.currentTarget.checked)}
        />
        Include subfolders
      </label>
    </div>
  );
}
