import { createSignal } from "solid-js";
import { FileList } from "./FileList";
import type { ClipboardState, SortDirection, SortKey } from "../lib/fs";

type ExplorerViewProps = {
  path: string;
  onNavigate: (path: string) => void;
  searchQuery: string;
  searchRecursive: boolean;
  favouritePaths: string[];
  onToggleFavourite: (path: string) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortChange: (key: SortKey) => void;
  "data-bg-lightness"?: string;
};

export function ExplorerView(props: ExplorerViewProps) {
  const [clipboard, setClipboard] = createSignal<ClipboardState>(null);

  return (
    <div class="explorer-content">
      <FileList
        data-bg-lightness={props["data-bg-lightness"]}
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
