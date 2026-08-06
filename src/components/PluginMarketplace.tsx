import { createMemo, createSignal, For, Show, onMount } from "solid-js";
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

  // ── GitHub install ──────────────────────────────────────────────────────

  const handleInstallFromGithub = async () => {
    const url = githubUrl().trim();
    if (!url) return;
    setLoadingId("__github__");
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
