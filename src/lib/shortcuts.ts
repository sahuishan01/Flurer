// Shared by the OS-global shortcut recorder (CustomizationSettings' "Global
// shortcut to open Flurer") and the in-app shortcut recorder/matcher (Delete,
// Rename, Copy, Cut, Paste, Select all in FileList) — same "Ctrl+Alt+E" style
// combo string, same recording UX, just a different requireModifier rule:
// an OS-wide hotkey without a modifier would hijack a plain letter key
// system-wide, but an in-app shortcut like bare "Delete" or "F2" is normal
// and was already how these five acted before they became configurable.

export function formatKeyCombo(e: KeyboardEvent, opts?: { requireModifier?: boolean }): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  if (opts?.requireModifier && parts.length === 0) return null;
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("+");
}

// Matches a live KeyboardEvent against a stored combo string. Modifiers must
// match exactly (a "Ctrl+C" binding does not fire on Ctrl+Shift+C) so two
// bindings that only differ by an extra modifier stay distinguishable.
export function matchesKeyCombo(e: KeyboardEvent, combo: string | undefined): boolean {
  if (!combo) return false;
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  if (e.ctrlKey !== mods.has("Ctrl")) return false;
  if (e.altKey !== mods.has("Alt")) return false;
  if (e.shiftKey !== mods.has("Shift")) return false;
  if (e.metaKey !== mods.has("Super")) return false;
  const eventKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return eventKey.toLowerCase() === key.toLowerCase();
}

export type InAppShortcutAction = "delete" | "rename" | "copy" | "cut" | "paste" | "selectAll";

export const IN_APP_SHORTCUT_LABELS: Record<InAppShortcutAction, string> = {
  delete: "Delete selected item(s)",
  rename: "Rename",
  copy: "Copy",
  cut: "Cut",
  paste: "Paste",
  selectAll: "Select all",
};

// Matches the behavior FileList's handleKeyDown hardcoded before this became
// configurable — a user who never opens the new Settings section sees no
// change at all.
export const DEFAULT_IN_APP_SHORTCUTS: Record<InAppShortcutAction, string> = {
  delete: "Delete",
  rename: "F2",
  copy: "Ctrl+C",
  cut: "Ctrl+X",
  paste: "Ctrl+V",
  selectAll: "Ctrl+A",
};
