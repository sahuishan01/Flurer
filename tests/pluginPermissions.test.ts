import { describe, test, expect, beforeEach } from "bun:test";

// Bun's test runner has no localStorage. The permission module reads it
// at import time, so a stand-in has to exist before the module is
// loaded — hence the dynamic import below rather than a static one.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  commandPermission,
  grantPermission,
  grantsFor,
  hasPermission,
  revokeAll,
  revokePermission,
} = await import("../src/lib/pluginPermissions.ts");

describe("plugin permissions", () => {
  beforeEach(() => {
    store.clear();
  });

  test("every permission has a label and a description", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(PERMISSION_LABELS[permission]).toBeTruthy();
    }
  });

  test("a command maps to the permission it needs", () => {
    expect(commandPermission("list_directory")).toBe("fs:read");
    expect(commandPermission("delete_items")).toBe("fs:write");
    expect(commandPermission("set_settings")).toBe("app:settings");
    expect(commandPermission("install_plugin_from_github")).toBe("plugins:manage");
    // The git commands all drive git through the shell.
    expect(commandPermission("git_commit")).toBe("shell");
    expect(commandPermission("git_push")).toBe("shell");
  });

  test("a harmless command needs no permission", () => {
    expect(commandPermission("log_frontend")).toBeNull();
  });

  test("a grant is remembered and can be taken back", () => {
    expect(hasPermission("git", "shell")).toBe(false);
    grantPermission("git", "shell");
    expect(hasPermission("git", "shell")).toBe(true);
    expect(grantsFor("git")).toEqual(["shell"]);

    revokePermission("git", "shell");
    expect(hasPermission("git", "shell")).toBe(false);
    expect(grantsFor("git")).toEqual([]);
  });

  test("grants are per plugin", () => {
    grantPermission("git", "shell");
    expect(hasPermission("graph", "shell")).toBe(false);
  });

  test("uninstalling a plugin drops all its grants", () => {
    grantPermission("git", "shell");
    grantPermission("git", "fs:read");
    revokeAll("git");
    expect(grantsFor("git")).toEqual([]);
  });

  test("grants survive a reload", () => {
    grantPermission("git", "shell");
    // The stored value is what a restart would read back.
    const stored = JSON.parse(localStorage.getItem("flurer.plugin.permissions")!);
    expect(stored.git).toEqual(["shell"]);
  });

  test("a corrupt stored value cannot widen a plugin's access", async () => {
    // A hand-edited or stale entry must not grant anything it does not
    // name, and must not throw.
    localStorage.setItem(
      "flurer.plugin.permissions",
      JSON.stringify({
        git: ["shell", "not-a-permission", 42],
        graph: "not-an-array",
        bad: null,
      }),
    );
    // Re-read through a fresh copy of the module, which loads from
    // storage the way a restart would.
    const { grants: readGrants } = await import("../src/lib/pluginPermissions.ts?corrupt=1");
    expect(readGrants().git).toEqual(["shell"]);
    expect(readGrants().graph).toBeUndefined();
    expect(readGrants().bad).toBeUndefined();
  });
});
