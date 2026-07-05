import { createEffect, createSignal, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
};

type FileListProps = {
  path: string;
  onNavigate: (path: string) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatModified(modified: number | null): string {
  if (modified === null) return "";
  return new Date(modified * 1000).toLocaleString();
}

export function FileList(props: FileListProps) {
  const [entries, setEntries] = createSignal<DirEntry[]>([]);
  const [error, setError] = createSignal("");

  createEffect(() => {
    const path = props.path;
    invoke<DirEntry[]>("list_directory", { path })
      .then((result) => {
        setError("");
        setEntries(result);
      })
      .catch((err) => setError(String(err)));
  });

  return (
    <div class="file-list">
      {error() && <p class="file-list-error">{error()}</p>}
      <table class="file-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Modified</th>
          </tr>
        </thead>
        <tbody>
          <For each={entries()}>
            {(entry) => (
              <tr
                class="file-row"
                classList={{ "file-row-dir": entry.isDir }}
                onDblClick={() => entry.isDir && props.onNavigate(entry.path)}
              >
                <td>
                  {entry.isDir ? "📁" : "📄"} {entry.name}
                </td>
                <td>{entry.isDir ? "" : formatSize(entry.size)}</td>
                <td>{formatModified(entry.modified)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
