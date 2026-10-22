import { Show } from "solid-js";
import { Modal } from "./Modal";
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS,
  currentPermissionRequest,
  grantPermission,
} from "../lib/pluginPermissions";

/**
 * The permission prompt.
 *
 * A plugin asking for something it has not been granted raises a
 * request; this dialog asks the user, and the answer is remembered
 * (see pluginPermissions.ts). Until it is answered the plugin's call
 * waits — the plugin cannot proceed on its own.
 *
 * Rendered once, near the app root, so it appears above whatever the
 * plugin was doing.
 */
export function PluginPermissionPrompt() {
  return (
    <Show when={currentPermissionRequest()}>
      {(request) => (
        <Modal
          title="Plugin permission request"
          onClose={() => request().resolve(false)}
        >
          <p class="plugin-permission-lead">
            <strong>{request().pluginName}</strong> is asking to{" "}
            {PERMISSION_LABELS[request().permission].toLowerCase()}.
          </p>
          <p class="settings-hint">{PERMISSION_DESCRIPTIONS[request().permission]}</p>
          <p class="settings-hint">
            Plugins run with your account's access. Only allow this if you trust the plugin.
          </p>
          <div class="modal-actions">
            <button type="button" onClick={() => request().resolve(false)}>
              Deny
            </button>
            <button
              type="button"
              class="danger"
              onClick={() => {
                grantPermission(request().pluginId, request().permission);
                request().resolve(true);
              }}
            >
              Allow
            </button>
          </div>
        </Modal>
      )}
    </Show>
  );
}
