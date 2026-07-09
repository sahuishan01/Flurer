import { createSignal } from "solid-js";
import { FileList } from "./FileList";
import { EnterIcon, StarIcon } from "./icons";
import type { ClipboardState, SortDirection, SortKey } from "../lib/fs";

type ExplorerViewProps = {
  path: string;
  pathInput: string;
  onPathInputChange: (value: string) => void;
  onNavigate: (path: string) => void;
  searchQuery: string;
  searchRecursive: boolean;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortChange: (key: SortKey) => void;
};

export function ExplorerView(props: ExplorerViewProps) {
  const [clipboard, setClipboard] = createSignal<ClipboardState>(null);

  return (
    <div class="explorer-content">
      <div class="toolbar">
        <form
          class="path-form"
          onSubmit={(e) => {
            e.preventDefault();
            props.onNavigate(props.pathInput);
          }}
        >
          <input
            class="path-input"
            value={props.pathInput}
            onInput={(e) => props.onPathInputChange(e.currentTarget.value)}
          />
          <button type="submit" class="icon-btn" title="Go" aria-label="Go">
            <EnterIcon size={16} />
          </button>
        </form>
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

      <FileList
        path={props.path}
        onNavigate={props.onNavigate}
        sortKey={props.sortKey}
        sortDirection={props.sortDirection}
        onSortChange={props.onSortChange}
        clipboard={clipboard()}
        onClipboardChange={setClipboard}
        searchQuery={props.searchQuery}
        searchRecursive={props.searchRecursive}
        favouritePaths={props.favouritePaths}
        onToggleFavourite={props.onToggleFavourite}
      />
    </div>
  );
}
