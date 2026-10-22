// Shared test setup for the plugin-permission tests.
//
// Bun's test runner has no `window` and no `localStorage`, and the
// modules under test use both at import time. This installs the
// stand-ins, and does it the same way in every file that needs them:
// `window` and `globalThis` must be the SAME object, or a plugin
// reaching for `globalThis.TauriCore` would look somewhere the app
// never published to.
//
// Import this BEFORE importing the module under test — the globals are
// published as a side effect of the import, so the stand-in has to be
// in place first.

const store = new Map<string, string>();

if (!(globalThis as any).localStorage) {
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
}

// `window` and `globalThis` must be the SAME object. The app publishes
// its globals on `window`; a test that reads `globalThis` has to be
// looking at the same place.
//
// The replacement is done with defineProperty, not an assignment: Bun on
// Windows already defines a `window` that is NOT `globalThis`, and
// that property is getter-only — a plain assignment throws in a module
// (modules are strict), which would leave the setup half-loaded.
//
// If the property turns out to be non-configurable, the assignment is
// attempted anyway and any failure is swallowed: the tests then use
// whatever `window` is, and the app's globals are published onto it
// below regardless.
try {
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    writable: true,
    configurable: true,
    enumerable: true,
  });
} catch {
  try {
    (globalThis as any).window = globalThis;
  } catch {
    // Leave the existing window alone; the globals below still land on
    // it, and the tests read from it.
  }
}

// The window the app publishes on: `window` if the host has one that
// is not globalThis, otherwise globalThis.
const appWindow: any = (globalThis as any).window ?? globalThis;

// Publish the plugin globals the way the app does, so the tests check
// what the app actually publishes. The UI kit is stood in for: the real
// one is a Solid component, and Bun's test transpiler cannot compile
// Solid's JSX (it expects the automatic JSX runtime; Solid ships a
// Babel transform).
const { publishPluginGlobals } = await import("../src/lib/pluginGlobals.ts");
publishPluginGlobals({
  registerPlugin: () => {},
  attachChildWebviewShortcuts: () => {},
  uiKit: { FieldRow: () => null },
});

export { store, appWindow };
