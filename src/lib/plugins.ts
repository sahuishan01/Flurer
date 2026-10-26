import * as Solid from "solid-js";
import * as TauriCore from "@tauri-apps/api/core";
import { CollapsibleSection } from "../components/ui/CollapsibleSection";
import { FieldGroup, FieldRow } from "../components/ui/Field";
import { publishPluginGlobals } from "./pluginGlobals";
import { runPluginScoped } from "./pluginGateway";
import { revokeAll } from "./pluginPermissions";
import type { ExplorerViewType } from "./view";

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  // When true, this plugin's own settingsPanel already exposes a
  // surfaceOpacity/surfaceBlur control (see pluginSettings below) — Core's
  // generic per-plugin appearance slider in the Settings > Plugins tab is
  // skipped for it, so there's only ever one UI writing that plugin's
  // opacity/blur, never two fighting over the same value. Absent/false
  // means Core renders the generic slider so every plugin gets a working
  // control even if its author never builds one. See plugin-spec.md.
  hasCustomAppearanceSettings?: boolean;
  // UI contributions
  viewRailButton?: (props: { active: boolean; onClick: () => void }) => Solid.JSX.Element;
  sidebar?: (props: { currentPath: string; onSelectPath: (path: string) => void }) => Solid.JSX.Element;
  mainPanel?: (props: {
    currentPath: string;
    navigateTo: (path: string) => void;
    searchQuery: string;
    focusPath: any;
    active: boolean;
    dataBgLightness: string;
    settingsLoaded: boolean;
    // Flurer's current shell opacity/blur (settings.uiTintOpacity/uiBlurPx)
    // — plugins that want to derive their own value (e.g. "never go below
    // 0.4") do the math off these rather than hardcoding a base. The
    // actual per-plugin override, if any, lives in pluginSettings below
    // and is also what Core applies to this panel's own wrapper element
    // as --plugin-surface-opacity/--plugin-surface-blur — see
    // plugin-spec.md for the full contract.
    baseSurfaceOpacity: number;
    baseSurfaceBlur: number;
    pluginSettings: any;
    onPluginSettingsChange: (patch: any) => void;
  }) => Solid.JSX.Element;
  fullPanel?: (props: {
    currentPath: string;
    navigateTo: (path: string) => void;
    searchQuery: string;
    focusPath: any;
    active: boolean;
    dataBgLightness: string;
    settingsLoaded: boolean;
    baseSurfaceOpacity: number;
    baseSurfaceBlur: number;
    pluginSettings: any;
    onPluginSettingsChange: (patch: any) => void;
  }) => Solid.JSX.Element;
  settingsPanel?: (props: {
    dataBgLightness: string;
    pluginSettings: any;
    onPluginSettingsChange: (patch: any) => void;
  }) => Solid.JSX.Element;

  // Explorer listing view types contributed to the view-type selector (the
  // dropdown next to "Group by"). Core registers `details` and `grid`; plugins
  // add their own with unique ids. A type that includes a `render` component
  // is mounted by FileList in place of the built-in table/grid — see
  // ExplorerViewType / ExplorerListViewContext in `src/lib/view.ts` and
  // plugin-spec.md §4.
  explorerViewTypes?: ExplorerViewType[];
}

// Reactive signal to store registered plugins
export const [registeredPlugins, setRegisteredPlugins] = Solid.createSignal<PluginInfo[]>([]);

/**
 * Sorts plugins according to a custom order array of plugin IDs.
 * Plugins found in `customOrder` are positioned first according to their index,
 * followed by any remaining plugins maintaining their original order.
 */
export function getOrderedPlugins<T extends { id: string }>(plugins: T[], customOrder?: string[]): T[] {
  if (!customOrder || customOrder.length === 0) return plugins;
  const orderMap = new Map(customOrder.map((id, index) => [id, index]));
  return [...plugins].sort((a, b) => {
    const aIndex = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity;
    const bIndex = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity;
    if (aIndex === bIndex) return 0;
    return aIndex - bIndex;
  });
}

/**
 * Plugins whose panel translucency can be overridden from Settings.
 *
 * Plugins that bring their own appearance controls are excluded —
 * having two UIs write the same surfaceOpacity/surfaceBlur fields would
 * just be confusing, not additive.
 */
export function pluginsWithAppearanceOverride(order?: string[]): PluginInfo[] {
  const filtered = registeredPlugins().filter((p) => (p.mainPanel || p.fullPanel) && !p.hasCustomAppearanceSettings);
  return getOrderedPlugins(filtered, order);
}

// Track loaded plugin IDs
const loadedPluginIds = new Set<string>();

export const pluginRegistry = {
  register(plugin: PluginInfo) {
    if (loadedPluginIds.has(plugin.id)) {
      setRegisteredPlugins((prev) => prev.filter((p) => p.id !== plugin.id).concat(plugin));
    } else {
      loadedPluginIds.add(plugin.id);
      setRegisteredPlugins((prev) => [...prev, plugin]);
    }
    console.log(`Plugin registered: ${plugin.name} (v${plugin.version})`);
  },
  
  unregister(id: string) {
    loadedPluginIds.delete(id);
    setRegisteredPlugins((prev) => prev.filter((p) => p.id !== id));
    console.log(`Plugin unregistered: ${id}`);
  },
  
  getPlugins() {
    return registeredPlugins();
  },
  
  getPlugin(id: string) {
    return registeredPlugins().find((p) => p.id === id);
  }
};

// Expose APIs globally for plugins to import.
//
// The publishing itself lives in pluginGlobals.ts, so that the tests
// can check what is (and is not) published without importing Solid's
// JSX — which Bun's test transpiler cannot compile.
publishPluginGlobals({
  registerPlugin: (plugin: PluginInfo) => pluginRegistry.register(plugin),
  attachChildWebviewShortcuts: (label: string, pluginId?: string) =>
    TauriCore.invoke("attach_child_webview_shortcuts", { label, pluginId }),
  uiKit: { CollapsibleSection, FieldRow, FieldGroup },
});

/**
 * Attaches native OS-level accelerator key interception to any child/docked webview.
 * Intercepts shortcuts (Ctrl+T, Ctrl+W, Ctrl+R, Ctrl+L, Ctrl+P, Command Palette, etc.)
 * even when the child webview has exclusive native OS focus, and dispatches them
 * to the global "flurer:webview-shortcut" event as well as "<pluginId>:shortcut".
 */
export async function attachChildWebviewShortcuts(label: string, pluginId?: string): Promise<void> {
  try {
    await TauriCore.invoke("attach_child_webview_shortcuts", { label, pluginId });
  } catch (err) {
    console.warn(`[plugins] Failed to attach child webview shortcuts for ${label}:`, err);
  }
}

export async function loadInstalledPlugins(disabledPlugins: string[] = []) {
  try {
    const installed = await TauriCore.invoke<any[]>("list_installed_plugins");
    for (const plugin of installed) {
      if (disabledPlugins.includes(plugin.id)) {
        console.log(`Plugin ${plugin.id} is disabled, skipping load`);
        continue;
      }
      try {
        const code = await TauriCore.invoke<string>("load_plugin_code", { id: plugin.id });
        // Scoped, so the plugin's calls are attributed to it and gated
        // by the permissions the user has granted it.
        runPluginScoped(code, plugin.id, plugin.name ?? plugin.id);
      } catch (err) {
        console.error(`Failed to load plugin ${plugin.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Failed to list installed plugins:", err);
  }
}

export async function installPluginFromGithub(repoUrl: string): Promise<void> {
  const manifest = await TauriCore.invoke<any>("install_plugin_from_github", { repoUrl });

  // Auto-load after install
  const code = await TauriCore.invoke<string>("load_plugin_code", { id: manifest.id });
  runPluginScoped(code, manifest.id, manifest.name ?? manifest.id);
}

export async function installPluginFromZip(filePath: string): Promise<void> {
  const manifest = await TauriCore.invoke<any>("install_plugin_from_zip", { zipPath: filePath });

  // Auto-load after install
  const code = await TauriCore.invoke<string>("load_plugin_code", { id: manifest.id });
  runPluginScoped(code, manifest.id, manifest.name ?? manifest.id);
}

export async function uninstallPlugin(id: string) {
  await TauriCore.invoke("uninstall_plugin", { id });
  pluginRegistry.unregister(id);
  // A plugin that is gone must not leave its grants behind for the
  // next plugin with the same id to inherit.
  revokeAll(id);
}

export async function checkPluginUpdates(
  plugins: { id: string; version: string; repo?: string }[],
): Promise<{ id: string; name: string; installedVersion: string; latestVersion: string; repo: string }[]> {
  return TauriCore.invoke("check_plugin_updates", { plugins });
}

export async function updatePlugin(repoUrl: string): Promise<void> {
  const manifest = await TauriCore.invoke<any>("update_plugin", { repoUrl });

  // Unregister old version, then load the new one
  pluginRegistry.unregister(manifest.id);
  const code = await TauriCore.invoke<string>("load_plugin_code", { id: manifest.id });
  runPluginScoped(code, manifest.id, manifest.name ?? manifest.id);
}

export async function linkPluginRepo(id: string, repoUrl: string): Promise<void> {
  await TauriCore.invoke("link_plugin_repo", { id, repoUrl });
}
