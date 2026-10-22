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
// The assignment is unconditional rather than guarded: Bun on Windows
// already defines a `window` that is NOT `globalThis`, and a guarded
// assignment would leave the two different — the app's globals would
// land on one object and the test would look at the other.
(globalThis as any).window = globalThis;

export { store };
