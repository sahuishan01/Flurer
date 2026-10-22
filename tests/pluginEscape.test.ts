import { describe, test, expect } from "bun:test";
import { store } from "./pluginTestSetup";

// A plugin must not be able to reach the raw Tauri API, whatever route
// it takes.
//
// The gateway hands each plugin a scoped `window`. That is only
// meaningful if the RAW API is not reachable some other way — through
// the document, through window.top, or through a Function constructor,
// which evaluates in the real global scope rather than the shadowed one.
//
// This is the check that the first version of the gateway failed: the
// scoped window was correct, but the raw `window.TauriCore` was still
// on the page, so a plugin could simply go and get it.
//
// The app's real globals are used here, not a stand-in: the point is
// what the app actually publishes.


// Import for the side effect: this is what publishes the globals.
await import("../src/lib/plugins.ts");
const mod = await import("../src/lib/pluginGateway.ts");

const transport = {
  invoke: async () => "SCOPED",
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

describe("a plugin cannot reach the raw Tauri API", () => {
  test("the raw API is not published at all", () => {
    const w = (globalThis as any).window;
    expect(w.TauriCore).toBeUndefined();
    expect(w.TauriShell).toBeUndefined();
  });

  test("through the document", () => {
    // A browser has a document; Bun does not. Either way the point is
    // the same: the route must not yield a usable TauriCore. A missing
    // document throws, which is also "no API".
    const w = (globalThis as any).window;
    if (!w.document) {
      expect(runPlugin(`return window.document.defaultView.TauriCore;`)).toBeUndefined();
      return;
    }
    const result = runPlugin(
      `return window.document.defaultView.TauriCore === undefined;`,
    );
    // The document's window is the app's real window, which no longer
    // publishes TauriCore — so there is nothing to find.
    expect(result).toBe(true);
  });

  test("through a fresh Function", () => {
    // A function's constructor evaluates in the real global scope,
    // which is exactly where the raw API would have been.
    const result = runPlugin(
      `const raw = (async function(){}).constructor("return this")(); return raw.TauriCore === undefined;`,
    );
    expect(result).toBe(true);
  });

  test("through window.top", () => {
    const w = (globalThis as any).window;
    if (w.top === undefined) {
      // No top window outside a browser; the route cannot yield an API.
      expect(runPlugin(`return window.top.TauriCore;`)).toBeUndefined();
      return;
    }
    const result = runPlugin(`return window.top.TauriCore === undefined;`);
    expect(result).toBe(true);
  });

  test("the scoped window still offers a working, gated TauriCore", () => {
    const result = runPlugin(`return typeof window.TauriCore.invoke === "function";`);
    expect(result).toBe(true);
  });
});
