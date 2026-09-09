import { createSignal, Show, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshIcon } from "./icons";
import { formatBytes } from "../lib/fs";

type UpdateInfo = {
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  releaseUrl: string;
  releaseBody: string;
  hasUpdate: boolean;
};

type UpdateProgressPayload = {
  downloaded: number;
  total: number;
  percent: number;
  stage: string;
};

type UpdatesViewProps = {
  autoCheckUpdates?: boolean;
  onAutoCheckUpdatesChange?: (enabled: boolean) => void;
  autoCheckUpdateIntervalSeconds?: number;
  onAutoCheckUpdateIntervalSecondsChange?: (seconds: number) => void;
  ignoredUpdateVersion?: string | null;
  onResetIgnoredUpdateVersion?: () => void;
};

export function UpdatesView(props: UpdatesViewProps) {
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null);
  const [checking, setChecking] = createSignal(false);
  const [error, setError] = createSignal("");
  const [downloading, setDownloading] = createSignal(false);
  const [appVersion, setAppVersion] = createSignal("");
  const [progress, setProgress] = createSignal<UpdateProgressPayload | null>(null);

  let unlistenProgress: (() => void) | undefined;

  onMount(async () => {
    try {
      const v = await getVersion();
      setAppVersion(v);
    } catch {
      setAppVersion("0.0.0");
    }

    try {
      unlistenProgress = await listen<UpdateProgressPayload>("update-progress", (event) => {
        setProgress(event.payload);
      });
    } catch (err) {
      console.error("Failed to listen for update progress", err);
    }
  });

  onCleanup(() => {
    unlistenProgress?.();
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
    setProgress(null);
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

        <label class="settings-checkbox" style={{ "margin-bottom": "1em" }}>
          <input
            type="checkbox"
            checked={props.autoCheckUpdates ?? true}
            onChange={(e) => props.onAutoCheckUpdatesChange?.(e.currentTarget.checked)}
          />
          <span>Automatically check & prompt for updates in the background</span>
        </label>

        <Show when={props.autoCheckUpdates ?? true}>
          <div class="settings-field-group" style={{ "margin-bottom": "1em" }}>
            <label class="settings-label">
              <span>Auto-check Interval (seconds, min 10s):</span>
              <input
                type="number"
                class="settings-number-input"
                min="10"
                step="5"
                value={props.autoCheckUpdateIntervalSeconds ?? 14400}
                onInput={(e) => {
                  const val = parseInt(e.currentTarget.value, 10);
                  if (!isNaN(val)) {
                    props.onAutoCheckUpdateIntervalSecondsChange?.(Math.max(10, val));
                  }
                }}
              />
            </label>
            <p class="settings-hint">Changing this value resets the update check timer immediately.</p>
          </div>
        </Show>

        <Show when={props.ignoredUpdateVersion}>
          <div class="settings-field-group" style={{ "margin-bottom": "1em" }}>
            <p class="settings-hint">
              Ignored update: <strong>v{props.ignoredUpdateVersion}</strong>
              <button
                type="button"
                style={{ "margin-left": "10px", padding: "2px 8px", "font-size": "12px" }}
                onClick={() => props.onResetIgnoredUpdateVersion?.()}
              >
                Clear / Reset Ignored Version
              </button>
            </p>
          </div>
        </Show>
        <div class="updates-actions">
          <button type="button" onClick={check} disabled={checking() || !appVersion() || downloading()}>
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

        <Show when={downloading() || progress()}>
          <div class="update-progress-container">
            <div class="update-progress-info">
              <span>{progress()?.stage || "Downloading update…"}</span>
              <Show when={progress() && progress()!.total > 0}>
                <span>
                  {formatBytes(progress()!.downloaded)} / {formatBytes(progress()!.total)} ({progress()!.percent.toFixed(1)}%)
                </span>
              </Show>
            </div>
            <div class="update-progress-bar">
              <div
                class="update-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress()?.percent || 0))}%` }}
              />
            </div>
          </div>
        </Show>

        <Show when={canUpdate()}>
          <p class="settings-hint">
            Installs silently in the background (you'll still see Windows' permission prompt) — no setup wizard. Flurer
            closes during the update and reopens on its own once it's done.
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
