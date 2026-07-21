import { createSignal, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
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

  async function check() {
    setChecking(true);
    setError("");
    setUpdateInfo(null);
    try {
      const result = await invoke<UpdateInfo>("check_for_updates", {
        currentVersion: "0.4.26",
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

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <div class="settings-section">
        <h3 style={{ margin: "0 0 12px", "font-size": "14px", "font-weight": 600 }}>App Updates</h3>
        <p style={{ "font-size": "13px", opacity: 0.7, margin: "0 0 12px" }}>
          Check for new versions of Flurer. Updates are distributed as MSI/NSIS installers from GitHub Releases.
        </p>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
          <button
            type="button"
            style={{ ...btn.base, ...btn.primary, ...(checking() ? btn.disabled : {}) }}
            onClick={check}
            disabled={checking()}
          >
            <RefreshIcon size={14} />
            {checking() ? "Checking…" : "Check for Updates"}
          </button>
          <Show when={updateInfo()?.hasUpdate}>
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

      <Show when={updateInfo() && !updateInfo()!.hasUpdate && !error()}>
        <div class="settings-section">
          <p style={{ "font-size": "13px", color: "var(--success, #4a8c5c)", margin: 0, display: "flex", "align-items": "center", gap: "6px" }}>
            ✓ You're up to date — Flurer v{updateInfo()!.currentVersion}
          </p>
        </div>
      </Show>

      <Show when={updateInfo()?.hasUpdate}>
        {(info) => (
          <div class="settings-section">
            <h3 style={{ margin: "0 0 8px", "font-size": "14px", "font-weight": 600 }}>
              v{info().latestVersion} Available
            </h3>
            <p style={{ "font-size": "12px", opacity: 0.6, margin: "0 0 8px" }}>
              Current: v{info().currentVersion} → Latest: v{info().latestVersion}
            </p>
            <Show when={info().releaseBody}>
              <div style={{ "font-size": "12px", "white-space": "pre-wrap", "max-height": "200px", overflow: "auto", "line-height": "1.6", "border-top": "1px solid var(--border-color)", "padding-top": "8px" }}>
                {info().releaseBody}
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}