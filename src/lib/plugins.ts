import * as Solid from "solid-js";
import * as SolidStore from "solid-js/store";
import * as SolidWeb from "solid-js/web";
import * as TauriCore from "@tauri-apps/api/core";
import * as TauriEvent from "@tauri-apps/api/event";

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
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
    pluginSettings: any;
    onPluginSettingsChange: (patch: any) => void;
  }) => Solid.JSX.Element;
  settingsPanel?: (props: {
    dataBgLightness: string;
    pluginSettings: any;
    onPluginSettingsChange: (patch: any) => void;
  }) => Solid.JSX.Element;
}

// Reactive signal to store registered plugins
export const [registeredPlugins, setRegisteredPlugins] = Solid.createSignal<PluginInfo[]>([]);

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

// Expose APIs globally for plugins to import
(window as any).Solid = Solid;
(window as any).SolidStore = SolidStore;
(window as any).SolidWeb = SolidWeb;
(window as any).TauriCore = TauriCore;
(window as any).TauriEvent = TauriEvent;
(window as any).registerPlugin = (plugin: PluginInfo) => pluginRegistry.register(plugin);

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
        const runPlugin = new Function(code);
        runPlugin();
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
  const runPlugin = new Function(code);
  runPlugin();
}

export async function installPluginFromZip(filePath: string): Promise<void> {
  const manifest = await TauriCore.invoke<any>("install_plugin_from_zip", { zipPath: filePath });

  // Auto-load after install
  const code = await TauriCore.invoke<string>("load_plugin_code", { id: manifest.id });
  const runPlugin = new Function(code);
  runPlugin();
}

export async function uninstallPlugin(id: string) {
  await TauriCore.invoke("uninstall_plugin", { id });
  pluginRegistry.unregister(id);
}
