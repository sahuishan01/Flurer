/**
 * The globals a plugin bundle reaches for.
 *
 * A plugin is an IIFE bundle with no module loader, so everything it
 * needs from the app has to be on the global object. This module
 * publishes them.
 *
 * It is separate from plugins.ts for one reason: this file can be
 * imported by a test without pulling in Solid's JSX, which Bun's test
 * transpiler cannot compile (it expects the automatic JSX runtime, and
 * Solid ships a Babel transform instead). The tests need to check what
 * is published — and what is NOT — so they have to be able to import
 * this without dragging the UI kit in.
 *
 * TauriCore and TauriShell are deliberately NOT published. They used
 * to be, which meant a plugin could reach the raw `invoke` — and the
 * raw `shell` — no matter what the permission gateway said. The
 * gateway (see pluginGateway.ts) hands each plugin its own scoped copy
 * instead, and a plugin that digs for the real one through `document`
 * or `window.top` finds nothing to dig for.
 *
 * The app's own code imports those modules directly, so removing the
 * globals costs nothing here.
 */
import * as Solid from "solid-js";
import * as SolidStore from "solid-js/store";
import * as SolidWeb from "solid-js/web";
import * as TauriEvent from "@tauri-apps/api/event";

/**
 * Publish the plugin globals on the window.
 *
 * The registry hook is passed in rather than imported, so this module
 * stays free of the plugin registry (and of Solid's JSX).
 */
export function publishPluginGlobals<TPlugin>(hooks: {
  registerPlugin: (plugin: TPlugin) => void;
  attachChildWebviewShortcuts: (label: string, pluginId?: string) => void;
  /** The shared UI kit, for a plugin's own settings panel. */
  uiKit: Record<string, unknown>;
}) {
  const w = globalThis as any;
  w.Solid = Solid;
  w.SolidStore = SolidStore;
  w.SolidWeb = SolidWeb;
  w.TauriEvent = TauriEvent;
  w.registerPlugin = hooks.registerPlugin;
  w.attachChildWebviewShortcuts = hooks.attachChildWebviewShortcuts;
  // The shared UI kit, so a plugin's settings panel can use the same
  // collapsible card and label/control row as the core settings. Plugins
  // are loaded as IIFE bundles with no module loader, so a plugin cannot
  // import from src/ — it reaches these through the global instead, the
  // same way it reaches Solid.
  w.FlurerUI = hooks.uiKit;
}
