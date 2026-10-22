import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandPermission } from "../src/lib/pluginPermissions";

// The permission map and the Rust command list must agree.
//
// A command that exists in Rust but is missing from the map is one a
// plugin can call with no permission at all — a hole. A command in the
// map that no longer exists in Rust is dead weight, and a sign the map
// was written against a stale list.
//
// The check reads src-tauri/src/lib.rs directly rather than duplicating
// the command list here, so it cannot drift.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

/** The commands the app registers with Tauri. */
function registeredCommands(): Set<string> {
  const lib = read("src-tauri/src/lib.rs");
  const start = lib.indexOf("generate_handler![");
  expect(start).toBeGreaterThan(-1);
  const block = lib.slice(start, lib.indexOf("]", start));
  const names = [...block.matchAll(/(?:commands::)?([a-z_][a-z0-9_]*)\s*,/g)].map((m) => m[1]);
  return new Set(names);
}

describe("the plugin permission map", () => {
  test("it names commands the app actually registers", () => {
    const registered = registeredCommands();
    // Every command in the map must exist, or the map is describing
    // an API that is no longer there.
    const mapSource = read("src/lib/pluginPermissions.ts");
    const block = mapSource.slice(
      mapSource.indexOf("const COMMAND_PERMISSIONS"),
      mapSource.indexOf("};", mapSource.indexOf("const COMMAND_PERMISSIONS")),
    );
    const mapped = [...block.matchAll(/^\s*([a-z_][a-z0-9_]*):\s*"[a-z:]+"/gm)].map((m) => m[1]);
    expect(mapped.length).toBeGreaterThan(20);
    for (const cmd of mapped) {
      expect(registered.has(cmd), `${cmd} is in the permission map but not registered in Rust`).toBe(true);
    }
  });

  test("the commands that touch the user's files are all gated", () => {
    // Every command below reads or changes the user's files, settings
    // or plugins. None of them may be ungated.
    const mustBeGated = [
      // Filesystem reads.
      "list_directory", "list_directory_streamed", "search_directory", "search_content",
      "search_index_query", "get_path_metadata", "get_file_preview", "get_quick_access",
      "get_disk_topology", "get_folder_size", "get_folder_size_cache_stats",
      "recompute_folder_size", "clear_folder_size_cache", "list_graph_children",
      "get_metric_devices", "watch_directory", "unwatch_directory",
      "get_filesystem_environment", "list_trash", "search_index_status",
      // Filesystem writes.
      "copy_items", "move_items", "delete_items", "delete_items_forever",
      "rename_item", "create_folder", "create_file", "restore_trash_items",
      "delete_trash_items_forever", "empty_trash", "compress_to_zip",
      "extract_archive", "rebuild_search_index", "clear_search_index",
      // Settings.
      "get_settings", "set_settings", "has_unsplash_api_key", "set_unsplash_api_key",
      "check_for_updates", "download_and_install_update", "relaunch_as_admin",
      "set_external_drop_allowed", "add_to_system_path",
      // Plugin management.
      "list_installed_plugins", "load_plugin_code", "install_plugin_from_github",
      "install_plugin_from_zip", "uninstall_plugin", "check_plugin_updates",
      "update_plugin", "link_plugin_repo",
    ];
    for (const cmd of mustBeGated) {
      expect(commandPermission(cmd), `${cmd} is not gated`).not.toBeNull();
    }
  });

  test("the gated commands are ones the app registers", () => {
    const registered = registeredCommands();
    const mapSource = read("src/lib/pluginPermissions.ts");
    const block = mapSource.slice(
      mapSource.indexOf("const COMMAND_PERMISSIONS"),
      mapSource.indexOf("};", mapSource.indexOf("const COMMAND_PERMISSIONS")),
    );
    const mapped = [...block.matchAll(/^\s*([a-z_][a-z0-9_]*):\s*"[a-z:]+"/gm)].map((m) => m[1]);
    for (const cmd of mapped) {
      expect(registered.has(cmd), `${cmd} is gated but not registered`).toBe(true);
    }
  });

  test("the git commands all need the shell permission", () => {
    // They drive git through the shell plugin's allowed `git` binary.
    expect(commandPermission("git_log")).toBe("shell");
    expect(commandPermission("git_commit")).toBe("shell");
    expect(commandPermission("git_push")).toBe("shell");
    expect(commandPermission("git_worktree_remove")).toBe("shell");
  });
});
