import { describe, test, expect, beforeEach } from "bun:test";
import { store } from "./pluginTestSetup";

// The gateway's whole job is to stop a plugin reaching something it
// was not granted. That has to be proven, not asserted: the test runs
// real plugin-shaped code and checks that a gated call is refused, that
// an ungated one goes through, and that a grant makes the gated call
// work.

/**
 * A stand-in for the browser window. The gateway needs a real object
 * to proxy, and this test checks the gate in isolation — the real
 * window's globals are covered by pluginGlobals.test.ts.
 *
 * It is passed to the gateway explicitly rather than installed as the
 * global `window`, because the other test files rely on the global
 * being the same object as `globalThis`.
 */
const fakeWindow: any = {
  __solidMarker: "solid",
  registerPlugin: () => {},
  FlurerUI: { FieldRow: () => null },
};

// The plain module paths, deliberately: a query string would load a
// SECOND copy of the module, and the gateway would then be checking
// its own copy of the permission state rather than the one this test
// is looking at.
const mod = await import("../src/lib/pluginGateway.ts");
const perms = await import("../src/lib/pluginPermissions.ts");

// Record what the gateway let through.
const invoked: string[] = [];
const transport = {
  invoke: async (cmd: string) => {
    invoked.push(cmd);
    return `ok:${cmd}`;
  },
  createCommand: () => ({
    execute: async () => "ran",
    spawn: async () => "spawned",
  }),
};

/**
 * Run plugin code and get its result back.
 *
 * `new Function` does not return the body's value, so the plugin
 * assigns it to `__result` on the window instead — which is also how a
 * real plugin would hand something back.
 */
async function runPlugin(code: string, pluginId: string, pluginName: string) {
  (fakeWindow as any).__result = undefined;
  (fakeWindow as any).__error = undefined;
  const wrapped = `
    try {
      window.__result = (async () => { ${code} })();
      window.__result.catch((e) => { window.__error = e; });
    } catch (e) { window.__error = e; }
  `;
  mod.runPluginScoped(wrapped, pluginId, pluginName, fakeWindow, transport);
  // Let the plugin's async body settle, and the prompt watcher answer.
  await new Promise((r) => setTimeout(r, 60));
  if ((fakeWindow as any).__error) throw (fakeWindow as any).__error;
  const result = (fakeWindow as any).__result;
  return result instanceof Promise ? await result : result;
}

/**
 * Answer the permission prompt without a UI: the module owns the
 * pending request, so the test resolves it the way the prompt dialog
 * would.
 */
let promptAnswers: boolean[] = [];
let promptCount = 0;

/**
 * Answer the next request as it appears.
 *
 * A single long-lived poller watches the pending request and answers
 * it. It is started once — a per-test poller would leave the previous
 * one running, and two pollers would race to answer the same request.
 */
function startPromptWatcher() {
  const tick = () => {
    const request = perms.currentPermissionRequest();
    if (request) {
      promptCount++;
      const answer = promptAnswers.shift() ?? false;
      request.resolve(answer);
    }
    setTimeout(tick, 1);
  };
  setTimeout(tick, 1);
}
startPromptWatcher();

describe("the plugin API gateway", () => {
  beforeEach(() => {
    store.clear();
    invoked.length = 0;
    promptCount = 0;
    promptAnswers = [];
  });

  test("an ungated command goes straight through", async () => {
    const result = await runPlugin(
      `return window.TauriCore.invoke("log_frontend", {});`,
      "harmless",
      "Harmless",
    );
    expect(result).toBe("ok:log_frontend");
    expect(invoked).toContain("log_frontend");
    expect(promptCount).toBe(0);
  });

  test("a gated command is refused when the user denies it", async () => {
    promptAnswers = [false];
    let error: any = null;
    try {
      await runPlugin(`return window.TauriCore.invoke("delete_items", { path: "/tmp/x" });`, "evil", "Evil Plugin");
    } catch (e) {
      error = e;
    }
    expect(promptCount).toBe(1);
    // The call never reached the transport.
    expect(invoked).not.toContain("delete_items");
    // And the refusal names the plugin, so it is not a mystery error.
    expect(String(error)).toContain("Evil Plugin");
  });

  test("a granted permission lets the call through", async () => {
    perms.grantPermission("trusted", "fs:write");
    const result = await runPlugin(
      `return window.TauriCore.invoke("delete_items", { path: "/tmp/x" });`,
      "trusted",
      "Trusted",
    );
    expect(result).toBe("ok:delete_items");
    expect(invoked).toContain("delete_items");
    // No prompt: the grant was already held.
    expect(promptCount).toBe(0);
  });

  test("a grant for one plugin does not help another", async () => {
    perms.grantPermission("trusted", "fs:write");
    promptAnswers = [false];
    await runPlugin(`return window.TauriCore.invoke("delete_items", {});`, "other", "Other").catch(() => {});
    expect(promptCount).toBe(1);
    expect(invoked).not.toContain("delete_items");
  });

  test("the plugin keeps the scoped window, so a later call is still gated", async () => {
    // The whole point of scoping rather than patching: a plugin that
    // stashes the API and calls it long after loading is still gated.
    promptAnswers = [false];
    await runPlugin(
      `
        globalThis.__stash = window.TauriCore;
        return "stashed";
      `,
      "later",
      "Later",
    );
    expect(promptCount).toBe(0);

    // Call it now, well after the plugin loaded.
    const stashed = (fakeWindow as any).__stash;
    await stashed.invoke("delete_items", {}).catch(() => {});
    await new Promise((r) => setTimeout(r, 40));
    expect(promptCount).toBe(1);
    expect(invoked).not.toContain("delete_items");
  });

  test("a shell command is gated too", async () => {
    promptAnswers = [false];
    let error: any = null;
    try {
      await runPlugin(
        `
          const cmd = window.TauriShell.Command.create("sh", ["-c", "echo pwned"]);
          return cmd.execute();
        `,
        "evil",
        "Evil",
      );
    } catch (e) {
      error = e;
    }
    expect(promptCount).toBe(1);
    expect(String(error)).toContain("Evil");
  });

  test("the rest of the window is untouched for the plugin", async () => {
    const result = await runPlugin(
      `
        return {
          marker: window.__solidMarker,
          hasRegister: typeof window.registerPlugin === "function",
          hasUI: !!window.FlurerUI,
        };
      `,
      "p",
      "P",
    );
    expect(result.marker).toBe("solid");
    expect(result.hasRegister).toBe(true);
    expect(result.hasUI).toBe(true);
  });

  test("a plugin cannot reach the real window's TauriCore", async () => {
    // Inside the plugin, window and globalThis are the same scoped
    // object, and that object is not the real window.
    const same = await runPlugin(`return window.TauriCore === globalThis.TauriCore;`, "p", "P");
    expect(same).toBe(true);
    // The real window was not given a TauriCore of its own.
    expect((fakeWindow as any).TauriCore).toBeUndefined();
  });

  test("a grant that is revoked stops working again", async () => {
    perms.grantPermission("p", "fs:write");
    const code = `return window.TauriCore.invoke("delete_items", {});`;
    expect(await runPlugin(code, "p", "P")).toBe("ok:delete_items");

    perms.revokePermission("p", "fs:write");
    promptAnswers = [false];
    await runPlugin(code, "p", "P").catch(() => {});
    expect(promptCount).toBe(1);
    // Only the first call got through.
    expect(invoked.filter((c) => c === "delete_items").length).toBe(1);
  });
});
