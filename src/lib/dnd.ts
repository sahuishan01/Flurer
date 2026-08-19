import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startDrag, type CursorPosition, type DragResult } from "@crabnebula/tauri-plugin-drag";
import type { BatchResult } from "./fs";

// Custom MIME type carrying the set of paths being dragged, for drops that
// land on another row/sidebar entry/breadcrumb segment *inside* Flurer's own
// DOM — kept alongside (not instead of) the native OS drag in startRowDrag
// below, since a plain string payload on the DataTransfer is how a drop
// target elsewhere in this same webview reads back what's being dragged.
// Native OS drag sessions (see startRowDrag) don't carry DataTransfer data at
// all — an external drop target (Explorer, another app) never sees this.
export const FLURER_PATHS_MIME = "application/x-flurer-paths";

export function readDraggedPaths(dataTransfer: DataTransfer | null): string[] | null {
  if (!dataTransfer || !dataTransfer.types.includes(FLURER_PATHS_MIME)) return null;
  try {
    const raw = dataTransfer.getData(FLURER_PATHS_MIME);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Shared by both the internal-drop path (FileList/Sidebar reacting to a
// plain HTML5 drop) and the native-drag-out path (App.tsx reacting to
// startRowDrag's onEvent callback landing back inside our own window) — one
// place that calls move_items/copy_items and shapes the result the same way
// pasteClipboard already does.
export async function transferItems(
  sources: string[],
  destinationDir: string,
  mode: "move" | "copy",
): Promise<BatchResult> {
  const command = mode === "copy" ? "copy_items" : "move_items";
  return invoke<BatchResult>(command, { sources, destinationDir });
}

// Resolved once and cached — every drag reuses the same bundled icon rather
// than re-resolving the resource path per drag. A generic file icon rather
// than a per-file-type preview: startDrag's `icon` needs a real filesystem
// path, and generating/caching a distinct preview image per file type is a
// lot of complexity for a drag cursor decoration, not a functional need.
let dragIconPath: Promise<string> | null = null;
function getDragIconPath(): Promise<string> {
  if (!dragIconPath) {
    dragIconPath = resolveResource("icons/drag-icon.png");
  }
  return dragIconPath;
}

export type RowDragResult = { result: DragResult; cursorPos: CursorPosition };

// Starts a native OS-level drag carrying `paths` — this is what makes
// dragging a row out to Explorer/the desktop/another app actually work
// (a plain HTML5 `draggable` attribute doesn't reliably hand real files to
// the OS from a webview). Deliberately the *only* drag mechanism for file
// rows (see FileList.tsx) rather than layering this on top of HTML5 DnD:
// once a native OS drag session starts there's no way to fall back to a
// DOM-level one mid-gesture, so trying to run both from the same gesture
// would race unpredictably. A drop that lands back inside Flurer's own
// window is detected by the caller checking `cursorPos` against
// document.elementFromPoint after this resolves, not by any DOM dragover/
// drop event — those never fire during a native OS drag.
// Windows only (no-op elsewhere, see set_external_drop_allowed): WebView2
// keeps its own OS-level drop target registered on this window the whole
// time, for Explorer→Flurer drag-in (FileList.tsx's onDragDropEvent). Left
// registered while startDrag's own DoDragDrop session is in flight, it
// stops *other* top-level windows (a browser tab, Teams) from ever seeing a
// drag-enter for that session — so it's switched off for the duration of
// the drag and back on once it settles, drop or cancel either way.
export async function startRowDrag(paths: string[], mode: "copy" | "move"): Promise<RowDragResult> {
  const icon = await getDragIconPath();
  await invoke("set_external_drop_allowed", { allowed: false });
  try {
    return await new Promise((resolve) => {
      startDrag({ item: paths, icon, mode }, (payload) => resolve(payload));
    });
  } finally {
    await invoke("set_external_drop_allowed", { allowed: true });
  }
}

// The plugin only hands back a screen-space cursor position (there's no
// concept of "our window" once the drag has left it), so telling a drop
// that landed back inside Flurer's own window apart from one that landed on
// the real desktop/another app means converting that point ourselves —
// subtract this window's screen position, no window API does that for us.
// Best-effort: outerPosition/innerSize are physical pixels, scaleFactor
// converts the plugin's logical cursorPos to match. If anything here throws
// (e.g. window closed mid-drag) the caller treats it as an external drop,
// which is the safe default — we'd rather miss an internal-drop highlight
// than accidentally run a filesystem op the user didn't intend.
export async function elementAtDropPoint(cursorPos: CursorPosition): Promise<Element | null> {
  const win = getCurrentWindow();
  const [scaleFactor, outerPosition, innerSize] = await Promise.all([
    win.scaleFactor(),
    win.outerPosition(),
    win.innerSize(),
  ]);
  const physicalX = Number(cursorPos.x) * scaleFactor;
  const physicalY = Number(cursorPos.y) * scaleFactor;
  // innerSize/outerPosition are both physical; the visible content area's
  // top-left sits at outerPosition plus whatever the title bar/border eats,
  // which we don't have a direct number for — approximating with the
  // window's own physical position is close enough for a drop-target
  // lookup (a handful of pixels off just means a border pixel misses the
  // row, not a wrong file being moved).
  const localX = (physicalX - outerPosition.x) / scaleFactor;
  const localY = (physicalY - outerPosition.y) / scaleFactor;
  if (localX < 0 || localY < 0 || localX > innerSize.width / scaleFactor || localY > innerSize.height / scaleFactor) {
    return null;
  }
  return document.elementFromPoint(localX, localY);
}
