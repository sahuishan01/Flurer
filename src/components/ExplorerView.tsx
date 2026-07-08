import { createSignal } from "solid-js";
import { FileList } from "./FileList";
import type { ClipboardState, SortDirection, SortKey } from "../lib/fs";

type ExplorerViewProps = {
  path: string;
  pathInput: string;
  onPathInputChange: (value: string) => void;
  onNavigate: (path: string) => void;
  searchQuery: string;
  searchRecursive: boolean;
};

export function ExplorerView(props: ExplorerViewProps) {
  const [sortKey, setSortKey] = createSignal<SortKey>("name");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("ascending");
  const [clipboard, setClipboard] = createSignal<ClipboardState>(null);

  function handleSortChange(key: SortKey) {
    if (key === sortKey()) {
      setSortDirection((d) => (d === "ascending" ? "descending" : "ascending"));
    } else {
      setSortKey(key);
      setSortDirection("ascending");
    }
  }

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
          <button type="submit">Go</button>
        </form>
      </div>

      <FileList
        path={props.path}
        onNavigate={props.onNavigate}
        sortKey={sortKey()}
        sortDirection={sortDirection()}
        onSortChange={handleSortChange}
        clipboard={clipboard()}
        onClipboardChange={setClipboard}
        searchQuery={props.searchQuery}
        searchRecursive={props.searchRecursive}
      />
    </div>
  );
}
