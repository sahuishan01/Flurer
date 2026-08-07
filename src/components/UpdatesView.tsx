import { createSignal, Show, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshIcon } from "./icons";

type UpdateInfo = {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  releaseUrl: string;
  releaseBody: string;
  hasUpdate: boolean;
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
    <div class="updates-view">
      <div class="settings-section">
        <h3>App Updates</h3>
        <p class="updates-meta">
          Current version: <strong>v{appVersion()}</strong>
        </p>
        <div class="updates-actions">
          <button type="button" onClick={check} disabled={checking() || !appVersion()}>
            <RefreshIcon size={14} />
            {checking() ? "Checking…" : "Check for Updates"}
          </button>
          <Show when={canUpdate()}>
            <button type="button" class="btn-accent" onClick={downloadAndInstall} disabled={downloading()}>
              {downloading() ? "Updating…" : "Update Now"}
            </button>
            <button type="button" onClick={openRelease}>
              View on GitHub
            </button>
          </Show>
        </div>
        <Show when={canUpdate()}>
          <p class="settings-hint">
            Installs silently in the background (you'll still see Windows' permission prompt) — no setup wizard. Flurer
            will close during the update; reopen it once it's done.
          </p>
        </Show>
      </div>

      <Show when={error()}>
        <div class="settings-error-alert">{error()}</div>
      </Show>

      {/* Up to date — use signal directly, not Show function-child, so version renders */}
      <Show when={info() && !canUpdate() && !error()}>
        <div class="settings-section">
          <p class="settings-success">✓ You're up to date — Flurer <strong>v{info()!.currentVersion}</strong></p>
        </div>
      </Show>

      {/* Update available */}
      <Show when={canUpdate()}>
        <div class="settings-section">
          <h3>v{info()!.latestVersion} Available</h3>
          <p class="updates-meta">
            Current: <strong>v{info()!.currentVersion}</strong> → Latest: <strong>v{info()!.latestVersion}</strong>
          </p>
          <Show when={info()!.releaseBody}>
            <div class="updates-release-notes">{info()!.releaseBody}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
