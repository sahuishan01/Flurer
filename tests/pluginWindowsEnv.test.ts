import { describe, test, expect } from "bun:test";

// The plugin tests must work in the environment the Windows CI runner
// has: a `globalThis.window` that is not `globalThis` and is
// getter-only.
//
// This is not hypothetical. The Windows leg failed at
// `w.__result = undefined` because the setup's
// `globalThis.window = globalThis` threw: modules are strict, and a
// getter-only property cannot be assigned. The setup module then
// failed to load, and every test that depended on it failed with a
// confusing "cannot read property of undefined".
//
// The setup has to survive that window, and it has to publish the
// globals onto whatever window the host ends up with.
//
// The window is installed here before the setup runs — but the setup
// may already have been loaded by another test file in the same run,
// in which case it has already replaced the window. Both outcomes are
// fine; what matters is that the globals are on the window the tests
// read.

const windowsWindow: any = {};
Object.defineProperty(windowsWindow, "window", {
  get: () => windowsWindow,
  configurable: true,
});
try {
  Object.defineProperty(globalThis, "window", {
    get: () => windowsWindow,
    configurable: true,
  });
} catch {
  // The setup already replaced it; that is the other valid outcome.
}

describe("the plugin tests under a Windows-like window", () => {
  test("the globals land on the window the tests read", async () => {
    const { appWindow } = await import("./pluginTestSetup.ts");
    expect(appWindow.Solid).toBeDefined();
    expect(appWindow.FlurerUI).toBeDefined();
    expect(typeof appWindow.registerPlugin).toBe("function");
    expect(appWindow.TauriCore).toBeUndefined();
  });

  test("the setup never throws on a getter-only window", async () => {
    // Whether the setup replaced the window or left it alone, it must
    // not have thrown — and the globals must be reachable either way.
    await import("./pluginTestSetup.ts");
    const w = globalThis as any;
    expect(w.Solid).toBeDefined();
  });

  test("the gateway can still scope a plugin's window", async () => {
    const { appWindow } = await import("./pluginTestSetup.ts");
    const mod = await import("../src/lib/pluginGateway.ts");
    const transport = {
      invoke: async () => "SCOPED",
      createCommand: () => ({ execute: async () => "ran", spawn: async () => "spawned" }),
    };
    mod.runPluginScoped(
      `window.__result = (function () { return typeof window.TauriCore.invoke; })();`,
      "p",
      "P",
      appWindow,
      transport,
    );
    expect(appWindow.__result).toBe("function");
  });
});
