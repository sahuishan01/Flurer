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


/**
 * The window the app publishes its globals on.
 *
 * Read through `window` rather than `globalThis`, because that is where
 * the app puts them — and on Windows Bun's `window` is not the same
 * object as `globalThis`.
 */
function appWindow(): any {
  return (globalThis as any).window;
}

/** The globals the app deliberately does NOT publish. */
describe("the raw Tauri API is not published globally", () => {
  test("TauriCore and TauriShell are not on the window", async () => {
    // The module that publishes the globals is imported for its side
    // effect, so importing it here sets up the same window the app has.
    await import("../src/lib/plugins.ts");
    const w = appWindow();
    expect(w.TauriCore, "window.TauriCore must not be published — a plugin could call it directly").toBeUndefined();
    expect(w.TauriShell, "window.TauriShell must not be published — a plugin could run commands").toBeUndefined();
  });

  test("the globals that plugins do need are still published", async () => {
    await import("../src/lib/plugins.ts");
    const w = appWindow();
    expect(w.Solid).toBeDefined();
    expect(w.SolidWeb).toBeDefined();
    expect(w.SolidStore).toBeDefined();
    expect(w.TauriEvent).toBeDefined();
    expect(typeof w.registerPlugin).toBe("function");
    expect(w.FlurerUI).toBeDefined();
  });
});
