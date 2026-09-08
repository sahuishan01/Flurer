import { createSignal, For, Show } from "solid-js";
import {
  DEFAULT_IN_APP_SHORTCUTS,
  formatKeyCombo,
  IN_APP_SHORTCUT_CATEGORIES,
  IN_APP_SHORTCUT_LABELS,
  type InAppShortcutAction,
} from "../lib/shortcuts";
import { DEFAULT_GLOBAL_SHORTCUT } from "../lib/settings";

type ShortcutsSettingsProps = {
  globalShortcut: string;
  onGlobalShortcutChange: (shortcut: string) => void;
  inAppShortcuts: Partial<Record<InAppShortcutAction, string>>;
  onInAppShortcutChange: (action: InAppShortcutAction, combo: string) => void;
  onResetInAppShortcut: (action: InAppShortcutAction) => void;
};

export function ShortcutsSettings(props: ShortcutsSettingsProps) {
  const [recordingShortcut, setRecordingShortcut] = createSignal(false);
  const [recordingInAppAction, setRecordingInAppAction] = createSignal<InAppShortcutAction | null>(null);

  function formatShortcutFromEvent(e: KeyboardEvent): string | null {
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");
    if (parts.length === 0) return null; // require at least one modifier
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    return parts.join("+");
  }

  function handleShortcutRecorderKeyDown(e: KeyboardEvent) {
    e.preventDefault();
    if (e.key === "Escape") {
      setRecordingShortcut(false);
      return;
    }
    const shortcut = formatShortcutFromEvent(e);
    if (!shortcut) return;
    props.onGlobalShortcutChange(shortcut);
    setRecordingShortcut(false);
  }

  function handleInAppShortcutRecorderKeyDown(e: KeyboardEvent, action: InAppShortcutAction) {
    e.preventDefault();
    if (e.key === "Escape") {
      setRecordingInAppAction(null);
      return;
    }
    const combo = formatKeyCombo(e);
    if (!combo) return;
    props.onInAppShortcutChange(action, combo);
    setRecordingInAppAction(null);
  }

  return (
    <div class="shortcuts-settings">
      <section class="settings-section">
        <h3>System & Global</h3>
        <p class="settings-hint">
          Control how Flurer integrates with your system shortcuts.
        </p>

        <div class="shortcut-card">
          <div class="shortcut-card-info">
            <span class="shortcut-title">Global hotkey to open Flurer</span>
            <span class="shortcut-description">
              Opens a new window from anywhere across Windows, even when Flurer is minimized or in the background.
            </span>
          </div>
          <div class="shortcut-recorder-row">
            <button
              type="button"
              class="shortcut-recorder"
              classList={{ recording: recordingShortcut() }}
              onClick={() => setRecordingShortcut(true)}
              onKeyDown={(e) => recordingShortcut() && handleShortcutRecorderKeyDown(e)}
              onBlur={() => setRecordingShortcut(false)}
            >
              {recordingShortcut()
                ? "Press key combo… (Esc to cancel)"
                : props.globalShortcut || "Click to set shortcut"}
            </button>
            <Show when={props.globalShortcut}>
              <button type="button" class="danger" onClick={() => props.onGlobalShortcutChange("")}>
                Clear
              </button>
            </Show>
            <Show when={props.globalShortcut !== DEFAULT_GLOBAL_SHORTCUT}>
              <button type="button" onClick={() => props.onGlobalShortcutChange(DEFAULT_GLOBAL_SHORTCUT)}>
                Reset
              </button>
            </Show>
          </div>
        </div>
      </section>

      <For each={IN_APP_SHORTCUT_CATEGORIES}>
        {(group) => (
          <section class="settings-section">
            <h3>{group.category}</h3>
            <div class="shortcut-grid">
              <For each={group.actions}>
                {(action) => {
                  const currentCombo = () =>
                    props.inAppShortcuts[action] || DEFAULT_IN_APP_SHORTCUTS[action];
                  const isModified = () =>
                    currentCombo() !== DEFAULT_IN_APP_SHORTCUTS[action];

                  return (
                    <div class="shortcut-card">
                      <div class="shortcut-card-info">
                        <span class="shortcut-title">{IN_APP_SHORTCUT_LABELS[action]}</span>
                        <span class="shortcut-default-hint">
                          Default: {DEFAULT_IN_APP_SHORTCUTS[action]}
                        </span>
                      </div>
                      <div class="shortcut-recorder-row">
                        <button
                          type="button"
                          class="shortcut-recorder"
                          classList={{ recording: recordingInAppAction() === action }}
                          onClick={() => setRecordingInAppAction(action)}
                          onKeyDown={(e) =>
                            recordingInAppAction() === action &&
                            handleInAppShortcutRecorderKeyDown(e, action)
                          }
                          onBlur={() =>
                            setRecordingInAppAction((cur) => (cur === action ? null : cur))
                          }
                        >
                          {recordingInAppAction() === action
                            ? "Press keys… (Esc)"
                            : currentCombo()}
                        </button>
                        <Show when={isModified()}>
                          <button
                            type="button"
                            class="shortcut-reset-btn"
                            title="Reset to default"
                            onClick={() => props.onResetInAppShortcut(action)}
                          >
                            Reset
                          </button>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
