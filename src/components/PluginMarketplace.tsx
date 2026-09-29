import { createMemo, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import {
  pluginRegistry,
  installPluginFromGithub,
  installPluginFromZip,
  uninstallPlugin,
  checkPluginUpdates,
  updatePlugin,
  linkPluginRepo,
} from "../lib/plugins";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type PluginMarketplaceProps = {
  disabledPlugins: string[];
  onDisabledPluginsChange: (disabled: string[]) => void;
  searchQuery: string;
};

type InstalledEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  repo?: string;
};

type UpdateInfo = {
  id: string;
  name: string;
  installedVersion: string;
  latestVersion: string;
  repo: string;
};

// Remote registry (AGENTS.md §1): a marketplace.json hosted in the main
// repo listing plugins available for one-click install. Fetched at mount;
// a failed fetch just hides the section (URL/ZIP installs still work).
type RegistryEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  repo: string;
};

const REGISTRY_URL = "https://raw.githubusercontent.com/sahuishan01/Flurer/main/marketplace.json";

export function PluginMarketplace(props: PluginMarketplaceProps) {
  const [githubUrl, setGithubUrl] = createSignal("");
  const [zipFilePath, setZipFilePath] = createSignal<string | null>(null);
  const [installed, setInstalled] = createSignal<InstalledEntry[]>([]);
  const [loadingId, setLoadingId] = createSignal<string | null>(null);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [updates, setUpdates] = createSignal<UpdateInfo[]>([]);
  const [checkingUpdates, setCheckingUpdates] = createSignal(false);
  const [linkingId, setLinkingId] = createSignal<string | null>(null);
  const [linkRepoUrl, setLinkRepoUrl] = createSignal("");
  const [registry, setRegistry] = createSignal<RegistryEntry[] | null>(null);
  const [registryError, setRegistryError] = createSignal<string | null>(null);
  const [registryLoading, setRegistryLoading] = createSignal(false);
  // Live install/update progress streamed from the backend as
  // `plugin-progress` events; only meaningful while an operation runs.
  const [progress, setProgress] = createSignal<{ stage: string; percent: number | null } | null>(null);

  onMount(() => {
    const p = listen<{ stage: string; percent: number | null }>("plugin-progress", (e) => {
      setProgress(e.payload);
    });
    onCleanup(() => void p.then((fn) => fn()));
  });

  const loadRegistry = async () => {
    setRegistryLoading(true);
    setRegistryError(null);
    try {
      const res = await fetch(REGISTRY_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRegistry(Array.isArray(data.plugins) ? data.plugins : []);
    } catch (err) {
      setRegistry(null);
      setRegistryError(String(err));
    } finally {
      setRegistryLoading(false);
    }
  };

  const refreshInstalled = async () => {
    try {
      const list = await invoke<InstalledEntry[]>("list_installed_plugins");
      setInstalled(list);
    } catch (err) {
      console.error("Failed to list installed plugins:", err);
    }
  };

  const checkForUpdates = async () => {
    const plugins = installed().filter((p) => p.repo);
    if (plugins.length === 0) return;
    setCheckingUpdates(true);
    try {
      const results = await checkPluginUpdates(plugins);
      setUpdates(results);
    } catch (err) {
      console.error("Failed to check for updates:", err);
    } finally {
      setCheckingUpdates(false);
    }
  };

  onMount(async () => {
    await refreshInstalled();
    // Auto-check for updates after installed list loads
    setTimeout(checkForUpdates, 500);
    void loadRegistry();
  });

  const updateMap = createMemo(() => {
    const map: Record<string, UpdateInfo> = {};
    for (const u of updates()) map[u.id] = u;
    return map;
  });

  const pluginsWithState = createMemo(() =>
    installed().map((p) => ({
      ...p,
      enabled: !props.disabledPlugins.includes(p.id),
    })),
  );

  // ── Registry browse ─────────────────────────────────────────────────────

  const handleInstallRegistry = async (entry: RegistryEntry) => {
    setLoadingId(`reg:${entry.id}`);
    setProgress(null);
    setErrorMsg(null);
    try {
      await installPluginFromGithub(entry.repo);
      await refreshInstalled();
      setTimeout(checkForUpdates, 500);
    } catch (err) {
      setErrorMsg(`Install failed: ${err}`);
    } finally {
      setLoadingId(null);
    }
  };

  // ── GitHub install ──────────────────────────────────────────────────────

  const handleInstallFromGithub = async () => {
    const url = githubUrl().trim();
    if (!url) return;
    setLoadingId("__github__");
    setProgress(null);
    setErrorMsg(null);
    try {
      await installPluginFromGithub(url);
      setGithubUrl("");
      await refreshInstalled();
      setTimeout(checkForUpdates, 500);
    } catch (err) {
      setErrorMsg(`Install failed: ${err}`);
    } finally {
      setLoadingId(null);
    }
  };

  // ── ZIP install ─────────────────────────────────────────────────────────

  const handleFileSelected = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setZipFilePath(null);
      return;
    }
    const path = (file as any).path;
    if (path) {
      setZipFilePath(path);
    } else {
      setErrorMsg("Could not resolve file path. Try using the GitHub URL method instead.");
    }
  };

  const handleInstallFromZip = async () => {
    const path = zipFilePath();
    if (!path) return;
    setLoadingId("__zip__");
    setProgress(null);
    setErrorMsg(null);
    try {
      await installPluginFromZip(path);
      setZipFilePath(null);
      await refreshInstalled();
    } catch (err) {
      setErrorMsg(`Install failed: ${err}`);
    } finally {
      setLoadingId(null);
    }
  };

  // ── Enable / Disable / Uninstall / Update ───────────────────────────────

  const handleToggleEnable = async (id: string) => {
    setErrorMsg(null);
    if (!props.disabledPlugins.includes(id)) {
      props.onDisabledPluginsChange([...props.disabledPlugins, id]);
      pluginRegistry.unregister(id);
    } else {
      const nextDisabled = props.disabledPlugins.filter((p) => p !== id);
      props.onDisabledPluginsChange(nextDisabled);
      setLoadingId(id);
      try {
        const code = await invoke<string>("load_plugin_code", { id });
        const runPlugin = new Function(code);
        runPlugin();
      } catch (err) {
        console.error(err);
        setErrorMsg(`Failed to load plugin code: ${err}`);
        props.onDisabledPluginsChange([...props.disabledPlugins, id]);
      } finally {
        setLoadingId(null);
      }
    }
  };

  const handleUninstall = async (id: string) => {
    setLoadingId(id);
    setErrorMsg(null);
    try {
      await uninstallPlugin(id);
      setUpdates((prev) => prev.filter((u) => u.id !== id));
      await refreshInstalled();
    } catch (err) {
      setErrorMsg(`Failed to uninstall plugin: ${err}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleUpdate = async (repo: string) => {
    setLoadingId("__update__");
    setProgress(null);
    setErrorMsg(null);
    try {
      await updatePlugin(repo);
      await refreshInstalled();
      setTimeout(checkForUpdates, 500);
    } catch (err) {
      setErrorMsg(`Update failed: ${err}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleLinkRepo = async (id: string) => {
    const url = linkRepoUrl().trim();
    if (!url) return;
    try {
      await linkPluginRepo(id, url);
      setLinkingId(null);
      setLinkRepoUrl("");
      await refreshInstalled();
      setTimeout(checkForUpdates, 500);
    } catch (err) {
      setErrorMsg(`Failed to link repo: ${err}`);
    }
  };

  const isBusy = (id: string) => loadingId() === id;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div class="settings-section">
      <div class="settings-section-header">
        <h3>Plugin Marketplace</h3>
        <span class="settings-section-subtitle">
          Install plugins from a GitHub repo or a ZIP file, then manage them below.
        </span>
      </div>

      <Show when={errorMsg()}>
        <div class="settings-error-alert">{errorMsg()}</div>
      </Show>

      {/* Live install/update progress (backend streams plugin-progress) */}
      <Show when={loadingId() !== null && progress()}>
        {(p) => (
          <div class="update-progress-container plugin-progress">
            <div class="update-progress-info">
              <span>{p().stage}</span>
              <span>{p().percent !== null ? `${Math.round(p().percent!)}%` : ""}</span>
            </div>
            <div class="update-progress-bar">
              <div
                class="update-progress-fill"
                classList={{ indeterminate: p().percent === null }}
                style={{ width: p().percent !== null ? `${Math.min(100, p().percent!)}%` : "100%" }}
              />
            </div>
          </div>
        )}
      </Show>

      {/* ── Install from GitHub ───────────────────────────────────── */}
      <div class="plugin-install-section">
        <h4>Install from GitHub</h4>
        <div class="plugin-install-row">
          <input
            type="text"
            placeholder="https://github.com/owner/repo or owner/repo"
            value={githubUrl()}
            onInput={(e) => setGithubUrl(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <button type="button" disabled={!githubUrl().trim() || isBusy("__github__")} onClick={handleInstallFromGithub}>
            {isBusy("__github__") ? "Installing…" : "Install"}
          </button>
        </div>
        <p class="plugin-install-hint">
          Fetches the latest release from the repo and installs the first <strong>.zip</strong> asset found.
        </p>
      </div>

      {/* ── Install from ZIP ──────────────────────────────────────── */}
      <div class="plugin-install-section">
        <h4>Install from ZIP</h4>
        <div class="plugin-install-row">
          <input type="file" accept=".zip" onChange={handleFileSelected} style={{ flex: 1 }} />
          <button type="button" disabled={!zipFilePath() || isBusy("__zip__")} onClick={handleInstallFromZip}>
            {isBusy("__zip__") ? "Installing…" : "Install"}
          </button>
        </div>
        <p class="plugin-install-hint">
          Select a <strong>.zip</strong> file that contains <code>plugin.json</code> and the plugin code.
        </p>
      </div>

      {/* ── Registry browse ───────────────────────────────────────── */}
      <div class="plugin-install-section">
        <div class="plugin-installed-header">
          <h4>Available Plugins</h4>
          <button type="button" disabled={registryLoading()} onClick={loadRegistry}>
            {registryLoading() ? "Loading…" : "Refresh"}
          </button>
        </div>
        <Show
          when={registry()}
          fallback={
            <div class="plugin-empty-state">
              {registryLoading()
                ? "Loading the plugin registry…"
                : `Couldn't load the plugin registry${registryError() ? ` (${registryError()})` : ""}. URL and ZIP installs below still work.`}
            </div>
          }
        >
          {(entries) => (
            <Show
              when={entries().length > 0}
              fallback={<div class="plugin-empty-state">The registry has no plugins listed yet.</div>}
            >
              <div class="plugin-list">
                <For each={entries()}>
                  {(entry) => {
                    const isInstalled = createMemo(() => installed().some((p) => p.id === entry.id));
                    return (
                      <div class="plugin-card">
                        <div class="plugin-card-body">
                          <div class="plugin-card-title-row">
                            <span class="plugin-name">{entry.name}</span>
                            <Show when={entry.version}>
                              <span class="plugin-meta">v{entry.version}</span>
                            </Show>
                          </div>
                          <div class="plugin-meta">
                            {entry.author ? `${entry.author} • ` : ""}
                            {entry.repo}
                          </div>
                          <Show when={entry.description}>
                            <div class="plugin-description">{entry.description}</div>
                          </Show>
                        </div>
                        <div class="plugin-actions">
                          <Show
                            when={!isInstalled()}
                            fallback={<span class="plugin-meta">Installed</span>}
                          >
                            <button
                              type="button"
                              disabled={isBusy(`reg:${entry.id}`)}
                              onClick={() => handleInstallRegistry(entry)}
                            >
                              {isBusy(`reg:${entry.id}`) ? "Installing…" : "Install"}
                            </button>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          )}
        </Show>
      </div>

      {/* ── Installed plugins ─────────────────────────────────────── */}
      <div class="plugin-installed-section">
        <div class="plugin-installed-header">
          <h4>Installed Plugins</h4>
          <button type="button" disabled={checkingUpdates()} onClick={checkForUpdates}>
            {checkingUpdates() ? "Checking…" : "Check for updates"}
          </button>
        </div>

        <Show
          when={installed().length > 0}
          fallback={<div class="plugin-empty-state">No plugins installed. Use the methods above to install one.</div>}
        >
          <div class="plugin-list">
            <For each={pluginsWithState()}>
              {(plugin) => {
                const update = createMemo(() => updateMap()[plugin.id]);
                return (
                  <div class="plugin-card" classList={{ "has-update": !!update(), disabled: !plugin.enabled }}>
                    <div class="plugin-card-body">
                      <div class="plugin-card-title-row">
                        <span class="plugin-status-dot" classList={{ enabled: plugin.enabled }} />
                        <span class="plugin-name">{plugin.name}</span>
                        <Show when={update()}>
                          <span class="plugin-update-badge">v{update()!.latestVersion} available</span>
                        </Show>
                      </div>
                      <div class="plugin-meta">
                        v{plugin.version} • {plugin.author}
                        {plugin.repo ? ` • ${plugin.repo}` : ""}
                      </div>
                      <Show when={!plugin.repo}>
                        <Show
                          when={linkingId() === plugin.id}
                          fallback={
                            <button
                              type="button"
                              class="plugin-link-repo-btn"
                              onClick={() => { setLinkingId(plugin.id); setLinkRepoUrl(""); }}
                            >
                              Link GitHub repo for updates
                            </button>
                          }
                        >
                          <div class="plugin-link-repo-row">
                            <input
                              type="text"
                              class="plugin-link-repo-input"
                              placeholder="owner/repo"
                              value={linkRepoUrl()}
                              onInput={(e) => setLinkRepoUrl(e.currentTarget.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleLinkRepo(plugin.id)}
                            />
                            <button type="button" onClick={() => handleLinkRepo(plugin.id)}>
                              Link
                            </button>
                            <button type="button" onClick={() => setLinkingId(null)}>
                              Cancel
                            </button>
                          </div>
                        </Show>
                      </Show>
                      <Show when={plugin.description}>
                        <div class="plugin-description">{plugin.description}</div>
                      </Show>
                    </div>

                    <div class="plugin-actions">
                      <Show when={update()}>
                        <button type="button" disabled={isBusy("__update__")} onClick={() => handleUpdate(update()!.repo)}>
                          {isBusy("__update__") ? "Updating…" : "Update"}
                        </button>
                      </Show>
                      <button type="button" disabled={isBusy(plugin.id)} onClick={() => handleToggleEnable(plugin.id)}>
                        {plugin.enabled ? "Disable" : "Enable"}
                      </button>
                      <button type="button" class="danger" disabled={isBusy(plugin.id)} onClick={() => handleUninstall(plugin.id)}>
                        {isBusy(plugin.id) ? "Removing…" : "Uninstall"}
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
