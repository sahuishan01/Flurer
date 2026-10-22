import { describe, test, expect } from "bun:test";
import { store } from "./pluginTestSetup";

// A real plugin bundle, running against the scoped window.
//
// The reference plugins are IIFE bundles that read window.Solid,
// window.TauriCore and window.registerPlugin. This checks that the
// scoped window gives a plugin everything it needs, and that the
// TauriCore it gets is the gated one.

await import("../src/lib/plugins.ts");
const mod = await import("../src/lib/pluginGateway.ts");
const perms = await import("../src/lib/pluginPermissions.ts");

const scopedCalls: string[] = [];
const transport = {
  invoke: async (cmd: string) => {
    scopedCalls.push(cmd);
    return `ok:${cmd}`;
  },
  createCommand: () => ({ execute: async () => "ran", spawn: async () => "spawned" }),
};

function runPlugin(code: string) {
  const w = (globalThis as any).window;
  w.__result = undefined;
  w.__error = undefined;
  mod.runPluginScoped(
    `try { window.__result = (function () { ${code} })(); } catch (e) { window.__error = e; }`,
    "p",
    "P",
    w,
    transport,
  );
  return w.__result;
}

describe("a plugin bundle finds everything it needs", () => {
  test("the globals a plugin bundle reads are all present", () => {
    const result = runPlugin(`
      return {
        solid: typeof window.Solid,
        solidWeb: typeof window.SolidWeb,
        core: typeof window.TauriCore,
        invoke: typeof window.TauriCore.invoke,
        register: typeof window.registerPlugin,
        event: typeof window.TauriEvent,
        ui: typeof window.FlurerUI,
      };
    `);
    expect(result.solid).toBe("object");
    expect(result.solidWeb).toBe("object");
    expect(result.core).toBe("object");
    expect(result.invoke).toBe("function");
    expect(result.register).toBe("function");
    expect(result.event).toBe("object");
    expect(result.ui).toBe("object");
  });

  test("the TauriCore it gets is the gated one", () => {
    // An ungated command goes through the transport...
    runPlugin(`return window.TauriCore.invoke("log_frontend", {});`);
    expect(scopedCalls).toContain("log_frontend");
  });

  test("a gated command waits for an answer instead of going through", async () => {
    const before = scopedCalls.length;
    const result = runPlugin(`return window.TauriCore.invoke("delete_items", {});`);
    // The call is still waiting for the user to answer — it has not
    // reached the transport.
    expect(scopedCalls.length).toBe(before);
    expect(result).toBeInstanceOf(Promise);
    // And a request is pending for the user to answer.
    const request = perms.currentPermissionRequest();
    expect(request).not.toBeNull();
    expect(request!.permission).toBe("fs:write");
    // Answer it so the next test starts clean.
    request!.resolve(false);
    await result.catch(() => {});
  });

  test("allowing the request lets the plugin's call through", async () => {
    // What the git plugin does: every git_* command needs the shell
    // permission, and the first one prompts.
    const result = runPlugin(`return window.TauriCore.invoke("git_commit", {});`);
    expect(scopedCalls).not.toContain("git_commit");
    const request = perms.currentPermissionRequest();
    expect(request).not.toBeNull();
    expect(request!.permission).toBe("shell");
    request!.resolve(true);
    await result;
    expect(scopedCalls).toContain("git_commit");
  });

  test("the bundle can register itself", () => {
    const result = runPlugin(`
      const info = { id: "probe", name: "Probe", description: "", version: "1", author: "t" };
      window.registerPlugin(info);
      return typeof window.registerPlugin;
    `);
    expect(result).toBe("function");
  });
});
