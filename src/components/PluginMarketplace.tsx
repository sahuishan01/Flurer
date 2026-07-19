import { createMemo, createSignal, For, Show, onMount } from "solid-js";
import {
  pluginRegistry,
  registeredPlugins,
  installPluginFromGithub,
  installPluginFromZip,
  uninstallPlugin,
  checkPluginUpdates,
  updatePlugin,
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
        <div
          class="settings-error-alert"
          style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid var(--error-color, #ef4444)",
            color: "#f87171",
            padding: "10px 14px",
            "border-radius": "6px",
            "margin-bottom": "16px",
            "font-size": "14px",
          }}
        >
          {errorMsg()}
        </div>
      </Show>

      {/* ── Install from GitHub ───────────────────────────────────── */}
      <div
        class="install-section"
        style={{
          background: "var(--panel-bg)",
          border: "1px solid var(--border-strong)",
          "border-radius": "8px",
          padding: "16px",
          "margin-bottom": "12px",
        }}
      >
        <h4 style={{ margin: "0 0 8px", "font-size": "14px", "font-weight": 600 }}>
          Install from GitHub
        </h4>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <input
            type="text"
            class="settings-text-input"
            placeholder="https://github.com/owner/repo or owner/repo"
            value={githubUrl()}
            onInput={(e) => setGithubUrl(e.currentTarget.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              "border-radius": "6px",
              border: "1px solid var(--border-strong)",
              background: "var(--bg-color, #1a1a2e)",
              color: "var(--text-color)",
              "font-size": "14px",
            }}
          />
          <button
            type="button"
            class="btn-primary"
            style={{
              padding: "8px 16px",
              "font-size": "13px",
              "border-radius": "6px",
              background: "var(--accent-color, #f59e0b)",
              color: "#000",
              border: "none",
              cursor: "pointer",
              "font-weight": 600,
              opacity: githubUrl().trim() && !isBusy("__github__") ? 1 : 0.5,
            }}
            disabled={!githubUrl().trim() || isBusy("__github__")}
            onClick={handleInstallFromGithub}
          >
            {isBusy("__github__") ? "Installing…" : "Install"}
          </button>
        </div>
        <p style={{ margin: "6px 0 0", "font-size": "12px", color: "var(--text-muted, #888)" }}>
          Fetches the latest release from the repo and installs the first <strong>.zip</strong> asset found.
        </p>
      </div>

      {/* ── Install from ZIP ──────────────────────────────────────── */}
      <div
        class="install-section"
        style={{
          background: "var(--panel-bg)",
          border: "1px solid var(--border-strong)",
          "border-radius": "8px",
          padding: "16px",
          "margin-bottom": "12px",
        }}
      >
        <h4 style={{ margin: "0 0 8px", "font-size": "14px", "font-weight": 600 }}>
          Install from ZIP
        </h4>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <input
            type="file"
            accept=".zip"
            onChange={handleFileSelected}
            style={{
              flex: 1,
              "font-size": "13px",
              color: "var(--text-color)",
            }}
          />
          <button
            type="button"
            class="btn-primary"
            style={{
              padding: "8px 16px",
              "font-size": "13px",
              "border-radius": "6px",
              background: "var(--accent-color, #f59e0b)",
              color: "#000",
              border: "none",
              cursor: "pointer",
              "font-weight": 600,
              opacity: zipFilePath() && !isBusy("__zip__") ? 1 : 0.5,
            }}
            disabled={!zipFilePath() || isBusy("__zip__")}
            onClick={handleInstallFromZip}
          >
            {isBusy("__zip__") ? "Installing…" : "Install"}
          </button>
        </div>
        <p style={{ margin: "6px 0 0", "font-size": "12px", color: "var(--text-muted, #888)" }}>
          Select a <strong>.zip</strong> file that contains <code>plugin.json</code> and the plugin code.
        </p>
      </div>

      {/* ── Installed plugins ─────────────────────────────────────── */}
      <div
        class="installed-section"
        style={{
          background: "var(--panel-bg)",
          border: "1px solid var(--border-strong)",
          "border-radius": "8px",
          padding: "16px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "12px" }}>
          <h4 style={{ margin: 0, "font-size": "14px", "font-weight": 600 }}>Installed Plugins</h4>
          <button
            type="button"
            style={{
              padding: "4px 10px",
              "font-size": "11px",
              "border-radius": "4px",
              background: "rgba(255,255,255,0.08)",
              color: "var(--text-muted, #888)",
              border: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
              cursor: checkingUpdates() ? "default" : "pointer",
              opacity: checkingUpdates() ? 0.5 : 1,
            }}
            disabled={checkingUpdates()}
            onClick={checkForUpdates}
          >
            {checkingUpdates() ? "Checking…" : "Check for updates"}
          </button>
        </div>

        <Show
          when={installed().length > 0}
          fallback={
            <div style={{ padding: "20px 0", "text-align": "center", color: "var(--text-muted, #888)", "font-size": "13px" }}>
              No plugins installed. Use the methods above to install one.
            </div>
          }
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <For each={pluginsWithState()}>
              {(plugin) => {
                const update = createMemo(() => updateMap()[plugin.id]);
                return (
                  <div
                    class="plugin-card"
                    style={{
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "space-between",
                      padding: "12px",
                      background: "var(--card-bg, rgba(255,255,255,0.03))",
                      "border-radius": "6px",
                      border: update()
                        ? "1px solid rgba(245,158,11,0.4)"
                        : "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
                      opacity: plugin.enabled ? 1 : 0.5,
                    }}
                  >
                    <div style={{ "min-width": 0 }}>
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            "border-radius": "50%",
                            background: plugin.enabled ? "#22c55e" : "#6b7280",
                            display: "inline-block",
                            "flex-shrink": 0,
                          }}
                        />
                        <span style={{ "font-size": "14px", "font-weight": 600, color: "var(--text-color)" }}>
                          {plugin.name}
                        </span>
                        <Show when={update()}>
                          <span
                            style={{
                              padding: "1px 6px",
                              "border-radius": "4px",
                              "font-size": "10px",
                              "font-weight": 600,
                              background: "rgba(245,158,11,0.2)",
                              color: "#f59e0b",
                            }}
                          >
                            v{update()!.latestVersion} available
                          </span>
                        </Show>
                      </div>
                      <div style={{ "font-size": "11px", color: "var(--text-muted, #888)", "margin-left": "16px", "font-family": "Space Mono, monospace" }}>
                        v{plugin.version} • {plugin.author}
                        {plugin.repo ? ` • ${plugin.repo}` : ""}
                      </div>
                      <Show when={plugin.description}>
                        <div style={{ "font-size": "12px", color: "var(--text-muted, #888)", "margin-left": "16px", "margin-top": "2px", "overflow": "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                          {plugin.description}
                        </div>
                      </Show>
                    </div>

                    <div style={{ display: "flex", gap: "6px", "flex-shrink": 0 }}>
                      <Show when={update()}>
                        <button
                          type="button"
                          style={{
                            padding: "5px 10px",
                            "font-size": "12px",
                            "border-radius": "4px",
                            background: "#f59e0b",
                            color: "#000",
                            border: "none",
                            cursor: "pointer",
                            "font-weight": 600,
                          }}
                          disabled={isBusy("__update__")}
                          onClick={() => handleUpdate(update()!.repo)}
                        >
                          {isBusy("__update__") ? "Updating…" : "Update"}
                        </button>
                      </Show>
                      <button
                        type="button"
                        class={plugin.enabled ? "btn-secondary" : "btn-primary"}
                        style={{
                          padding: "5px 10px",
                          "font-size": "12px",
                          "border-radius": "4px",
                          background: plugin.enabled ? "rgba(255,255,255,0.1)" : "var(--accent-color, #f59e0b)",
                          color: plugin.enabled ? "var(--text-color)" : "#000",
                          border: "none",
                          cursor: "pointer",
                        }}
                        disabled={isBusy(plugin.id)}
                        onClick={() => handleToggleEnable(plugin.id)}
                      >
                        {plugin.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        class="btn-danger"
                        style={{
                          padding: "5px 10px",
                          "font-size": "12px",
                          "border-radius": "4px",
                          background: "rgba(239, 68, 68, 0.2)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          cursor: "pointer",
                        }}
                        disabled={isBusy(plugin.id)}
                        onClick={() => handleUninstall(plugin.id)}
                      >
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
