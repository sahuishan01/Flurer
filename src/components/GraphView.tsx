import { createSignal, For, Show, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes } from "../lib/fs";
import type { PhysicalDisk } from "../lib/graph";
import { FolderTreeNode } from "./FolderTreeNode";
import { DiskIcon, VolumeIcon } from "./icons";

export function GraphView() {
  const [disks, setDisks] = createSignal<PhysicalDisk[]>([]);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const result = await invoke<PhysicalDisk[]>("get_disk_topology");
      setDisks(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  });

  function usedFraction(volume: PhysicalDisk["volumes"][number]): number {
    if (volume.totalSpace <= 0) return 0;
    return (volume.totalSpace - volume.freeSpace) / volume.totalSpace;
  }

  return (
    <div class="graph-view">
      <h2 class="graph-title">Storage graph</h2>

      <Show when={loading()}>
        <p class="graph-hint">Reading disk layout…</p>
      </Show>

      <Show when={error()}>
        <p class="graph-error">{error()}</p>
      </Show>

      <div class="graph-tree">
        <For each={disks()}>
          {(disk) => (
            <div class="graph-node graph-node-disk">
              <div class="graph-node-header">
                <DiskIcon />
                <span class="graph-node-title">
                  Disk {disk.index}: {disk.model || "Unknown disk"}
                </span>
                <span class="graph-node-meta">
                  {formatBytes(disk.size)} · {disk.mediaType}
                  {disk.interfaceType ? ` · ${disk.interfaceType}` : ""}
                </span>
              </div>

              <div class="graph-children">
                <Show when={disk.volumes.length === 0}>
                  <p class="graph-hint">No volumes on this disk</p>
                </Show>
                <For each={disk.volumes}>
                  {(volume) => (
                    <div class="graph-node graph-node-volume">
                      <div class="graph-node-header">
                        <VolumeIcon />
                        <span class="graph-node-title">
                          {volume.driveLetter} {volume.volumeName ? `(${volume.volumeName})` : ""}
                        </span>
                        <span class="graph-node-meta">
                          {formatBytes(volume.totalSpace - volume.freeSpace)} of {formatBytes(volume.totalSpace)} used
                          {volume.fileSystem ? ` · ${volume.fileSystem}` : ""}
                        </span>
                      </div>
                      <div class="graph-usage-bar">
                        <div class="graph-usage-fill" style={{ width: `${usedFraction(volume) * 100}%` }} />
                      </div>

                      <div class="graph-children folder-tree-root">
                        <FolderTreeNode name={volume.driveLetter} path={`${volume.driveLetter}\\`} />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
