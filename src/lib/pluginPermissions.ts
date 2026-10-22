/**
 * Plugin permissions — the API gateway from AGENTS.md §4.
 *
 * Until now a plugin was handed the raw `window.TauriCore` and
 * `window.TauriShell`, and the Tauri capability file grants
 * `shell:allow-execute` (sh, git) to every window. A plugin could
 * therefore run `sh -c "..."` with no prompt and no record of it.
 *
 * This module is the gate. A plugin's globals are replaced with ones
 * whose `invoke` routes through here, so every call is attributed to
 * the plugin that made it and checked against the permissions the user
 * has granted that plugin. Nothing sensitive happens without a grant.
 *
 * The model is deliberately coarse — a handful of capabilities rather
 * than per-command entries — because a user asked "may this plugin run
 * shell commands?" should be able to answer without reading a list of
 * fifty command names.
 */

import { createSignal } from "solid-js";

/** The capabilities a plugin can hold. */
export type PluginPermission =
  /** Read the filesystem: list, stat, search, preview. */
  | "fs:read"
  /** Create, rename, move or delete files. */
  | "fs:write"
  /** Run shell commands (sh, git). */
  | "shell"
  /** Read and change Flurer's own settings. */
  | "app:settings"
  /** Install, update or remove other plugins. */
  | "plugins:manage";

export const ALL_PERMISSIONS: PluginPermission[] = [
  "fs:read",
  "fs:write",
  "shell",
  "app:settings",
  "plugins:manage",
];

export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  "fs:read": "Read files and folders",
  "fs:write": "Create, rename, move and delete files",
  shell: "Run shell commands",
  "app:settings": "Read and change Flurer's settings",
  "plugins:manage": "Install and remove plugins",
};

export const PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> = {
  "fs:read": "List folders, read file details and search inside them.",
  "fs:write": "Create, rename, move and delete files on your disk.",
  shell: "Run commands such as git through your system's shell.",
  "app:settings": "Read and change Flurer's settings, including other plugins' settings.",
  "plugins:manage": "Install, update and remove other plugins.",
};

/**
 * Commands that require a permission. Anything not listed here is
 * allowed without a grant: it neither touches the user's files nor
 * changes the app's state.
 */
const COMMAND_PERMISSIONS: Record<string, PluginPermission> = {
  // Filesystem reads.
  list_directory: "fs:read",
  list_directory_streamed: "fs:read",
  search_directory: "fs:read",
  search_content: "fs:read",
  search_index_query: "fs:read",
  get_path_metadata: "fs:read",
  get_file_preview: "fs:read",
  get_quick_access: "fs:read",
  get_disk_topology: "fs:read",
  get_folder_size: "fs:read",
  get_folder_size_cache_stats: "fs:read",
  recompute_folder_size: "fs:read",
  clear_folder_size_cache: "fs:read",
  list_graph_children: "fs:read",
  get_metric_devices: "fs:read",
  watch_directory: "fs:read",
  unwatch_directory: "fs:read",
  get_filesystem_environment: "fs:read",
  list_trash: "fs:read",
  search_index_status: "fs:read",

  // Filesystem writes.
  copy_items: "fs:write",
  move_items: "fs:write",
  delete_items: "fs:write",
  delete_items_forever: "fs:write",
  rename_item: "fs:write",
  create_folder: "fs:write",
  create_file: "fs:write",
  restore_trash_items: "fs:write",
  delete_trash_items_forever: "fs:write",
  empty_trash: "fs:write",
  compress_to_zip: "fs:write",
  extract_archive: "fs:write",
  rebuild_search_index: "fs:write",
  clear_search_index: "fs:write",
  find_duplicates: "fs:read",
  add_to_system_path: "app:settings",

  // Settings.
  get_settings: "app:settings",
  set_settings: "app:settings",
  has_unsplash_api_key: "app:settings",
  set_unsplash_api_key: "app:settings",
  check_for_updates: "app:settings",
  download_and_install_update: "app:settings",
  relaunch_as_admin: "app:settings",
  set_external_drop_allowed: "app:settings",

  // Plugin management.
  list_installed_plugins: "plugins:manage",
  load_plugin_code: "plugins:manage",
  install_plugin_from_github: "plugins:manage",
  install_plugin_from_zip: "plugins:manage",
  uninstall_plugin: "plugins:manage",
  check_plugin_updates: "plugins:manage",
  update_plugin: "plugins:manage",
  link_plugin_repo: "plugins:manage",
};

/**
 * The git_* commands all drive git through the shell plugin's allowed
 * `git` binary, so they need the shell permission — but they are
 * scoped to git, which is worth knowing when a grant is explained.
 */
function permissionForCommand(command: string): PluginPermission | null {
  if (COMMAND_PERMISSIONS[command]) return COMMAND_PERMISSIONS[command];
  if (command.startsWith("git_")) return "shell";
  return null;
}

/** The permission a command needs, or null if it needs none. */
export function commandPermission(command: string): PluginPermission | null {
  return permissionForCommand(command);
}

/**
 * The shell plugin's own API is not a Tauri command — it is a separate
 * plugin whose `execute` runs a program. Plugins reach it through
 * `window.TauriShell`, so the gateway has to intercept it there too.
 */
export const SHELL_PERMISSION: PluginPermission = "shell";

/** Where granted permissions are kept, per plugin id. */
const STORAGE_KEY = "flurer.plugin.permissions";

export type PluginGrants = Record<string, PluginPermission[]>;

function load(): PluginGrants {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Only keep well-formed entries: a hand-edited or stale value must
    // not widen a plugin's access.
    const out: PluginGrants = {};
    for (const [id, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const perms = list.filter(
        (p): p is PluginPermission => typeof p === "string" && (ALL_PERMISSIONS as string[]).includes(p),
      );
      if (perms.length) out[id] = perms;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(next: PluginGrants) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable; the grant then lasts for this session
    // only, which is the safe direction to fail in.
  }
}

/**
 * The grants, read once at startup.
 *
 * Loaded eagerly rather than on first use: the first use could well be
 * inside a render, and writing a signal during a render is how Solid
 * ends up complaining about updates in the middle of an effect.
 */
const [grants_, setGrants] = createSignal<PluginGrants>(load());

/** Every grant, by plugin id. */
export function grants(): PluginGrants {
  return grants_();
}

/** The permissions a plugin currently holds. */
export function grantsFor(pluginId: string): PluginPermission[] {
  return grants()[pluginId] ?? [];
}

/** Whether a plugin holds a permission. */
export function hasPermission(pluginId: string, permission: PluginPermission): boolean {
  return grantsFor(pluginId).includes(permission);
}

/** Grant a permission to a plugin and remember it. */
export function grantPermission(pluginId: string, permission: PluginPermission) {
  const current = grants();
  if (current[pluginId]?.includes(permission)) return;
  const next: PluginGrants = {
    ...current,
    [pluginId]: [...(current[pluginId] ?? []), permission],
  };
  setGrants(next);
  persist(next);
}

/** Revoke a permission from a plugin. */
export function revokePermission(pluginId: string, permission: PluginPermission) {
  const current = grants();
  const remaining = (current[pluginId] ?? []).filter((p) => p !== permission);
  const next: PluginGrants = { ...current };
  if (remaining.length) next[pluginId] = remaining;
  else delete next[pluginId];
  setGrants(next);
  persist(next);
}

/** Revoke every permission a plugin holds — used when it is uninstalled. */
export function revokeAll(pluginId: string) {
  const current = grants();
  if (!(pluginId in current)) return;
  const next: PluginGrants = { ...current };
  delete next[pluginId];
  setGrants(next);
  persist(next);
}

/**
 * A pending request for a permission. The prompt UI raises one of
 * these and resolves it.
 */
export type PermissionRequest = {
  pluginId: string;
  pluginName: string;
  permission: PluginPermission;
  /** Resolve the request. True grants it (and remembers it). */
  resolve: (granted: boolean) => void;
};

const [pendingRequest, setPendingRequest] = createSignal<PermissionRequest | null>(null);

/** The request waiting for the user, if any. */
export function currentPermissionRequest(): PermissionRequest | null {
  return pendingRequest();
}

/**
 * Ask the user for a permission. Resolves true if granted.
 *
 * If a request for the same plugin and permission is already pending,
 * the new one is folded into it — a plugin that calls three gated
 * commands in a row should produce one prompt, not three.
 */
export function requestPermission(
  pluginId: string,
  pluginName: string,
  permission: PluginPermission,
): Promise<boolean> {
  const existing = pendingRequest();
  if (existing && existing.pluginId === pluginId && existing.permission === permission) {
    return new Promise<boolean>((resolve) => {
      const previous = existing.resolve;
      existing.resolve = (granted) => {
        previous(granted);
        resolve(granted);
      };
    });
  }

  return new Promise<boolean>((resolve) => {
    setPendingRequest({
      pluginId,
      pluginName,
      permission,
      resolve: (granted) => {
        setPendingRequest(null);
        resolve(granted);
      },
    });
  });
}

/** The error a denied plugin call throws. */
export class PermissionDeniedError extends Error {
  constructor(pluginName: string, permission: PluginPermission) {
    super(
      `"${pluginName}" was not allowed to ${PERMISSION_LABELS[permission].toLowerCase()}. ` +
        `Grant it in Settings → Plugins if you trust this plugin.`,
    );
    this.name = "PermissionDeniedError";
  }
}
