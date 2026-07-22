import { createSignal, Show, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshIcon, DownloadIcon } from "./icons";

type UpdateInfo = {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  releaseUrl: string;
  releaseBody: string;
  hasUpdate: boolean;
};

const btn = {
  base: {
    display: "inline-flex",
    "align-items": "center",
    gap: "6px",
    padding: "8px 14px",
    "font-size": "12px",
    "font-weight": 600,
    "border-radius": "6px",
    border: "none",
    cursor: "pointer",
    "font-family": "inherit",
    transition: "all 0.15s ease",
  } as any,
  primary: { background: "var(--accent)", color: "#fff" } as any,
  secondary: { background: "rgba(255,255,255,0.08)", color: "var(--text-color)" } as any,
  update: { background: "rgba(0,120,212,0.15)", color: "var(--accent, #0078d4)" } as any,
  disabled: { opacity: 0.4, cursor: "default" } as any,
};

export function UpdatesView() {
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null);
  const [checking, setChecking] = createSignal(false);
  const [error, setError] = createSignal("");
  const [downloading, setDownloading] = createSignal(false);
  const [appVersion, setAppVersion] = createSignal("");

  onMount(async () => {
    try {
      const v = await getVersion();
      setAppVersion(v);
    } catch {
      setAppVersion("0.0.0");
    }
  });

  async function check() {
    const version = appVersion();
    if (!version) return;
    setChecking(true);
    setError("");
    setUpdateInfo(null);
    try {
      const result = await invoke<UpdateInfo>("check_for_updates", {
        currentVersion: version,
      });
      setUpdateInfo(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  }

  async function downloadAndInstall() {
    const info = updateInfo();
    if (!info || !info.hasUpdate) return;
    setDownloading(true);
    setError("");
    try {
      await invoke("download_and_install_update", { url: info.downloadUrl });
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloading(false);
    }
  }

  function openRelease() {
    const info = updateInfo();
    if (info?.releaseUrl) {
      openUrl(info.releaseUrl);
    }
  }

  const info = () => updateInfo();
  const canUpdate = () => info()?.hasUpdate && info()!.latestVersion !== info()!.currentVersion;

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <div class="settings-section">
        <h3 style={{ margin: "0 0 12px", "font-size": "14px", "font-weight": 600 }}>App Updates</h3>
        <p style={{ "font-size": "13px", opacity: 0.7, margin: "0 0 12px" }}>
          Current version: <strong>v{appVersion()}</strong>
        </p>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
          <button
            type="button"
            style={{ ...btn.base, ...btn.primary, ...(checking() || !appVersion() ? btn.disabled : {}) }}
            onClick={check}
            disabled={checking() || !appVersion()}
          >
            <RefreshIcon size={14} />
            {checking() ? "Checking…" : "Check for Updates"}
          </button>
          <Show when={canUpdate()}>
            <button
              type="button"
              style={{ ...btn.base, ...btn.update, ...(downloading() ? btn.disabled : {}) }}
              onClick={downloadAndInstall}
              disabled={downloading()}
            >
              {downloading() ? "Downloading…" : "Download & Install"}
            </button>
            <button
              type="button"
              style={{ ...btn.base, ...btn.secondary }}
              onClick={openRelease}
            >
              View on GitHub
            </button>
          </Show>
        </div>
      </div>

      <Show when={error()}>
        <div class="settings-error" style={{ "font-size": "13px", padding: "8px 12px" }}>
          {error()}
        </div>
      </Show>

      {/* Up to date — use signal directly, not Show function-child, so version renders */}
      <Show when={info() && !canUpdate() && !error()}>
        <div class="settings-section">
          <p style={{ "font-size": "13px", color: "var(--success, #4a8c5c)", margin: 0, display: "flex", "align-items": "center", gap: "6px" }}>
            ✓ You're up to date — Flurer <strong>v{info()!.currentVersion}</strong>
          </p>
        </div>
      </Show>

      {/* Update available */}
      <Show when={canUpdate()}>
        <div class="settings-section">
          <h3 style={{ margin: "0 0 8px", "font-size": "14px", "font-weight": 600 }}>
            v{info()!.latestVersion} Available
          </h3>
          <p style={{ "font-size": "12px", opacity: 0.6, margin: "0 0 8px" }}>
            Current: <strong>v{info()!.currentVersion}</strong> → Latest: <strong>v{info()!.latestVersion}</strong>
          </p>
          <Show when={info()!.releaseBody}>
            <div style={{ "font-size": "12px", "white-space": "pre-wrap", "max-height": "200px", overflow: "auto", "line-height": "1.6", "border-top": "1px solid var(--border-color)", "padding-top": "8px" }}>
              {info()!.releaseBody}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}