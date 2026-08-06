import { createSignal, onCleanup, onMount } from "solid-js";

// Shared positioning for small fixed-position overlays (search box, path
// input, progress panel, …) that are anchored to a trigger button. Anchoring
// naively off one edge of the button breaks once that button can end up
// anywhere in the window — wrapped to a new toolbar row, hugging an edge,
// etc. — so every overlay clamps against the real viewport and its own
// rendered size instead.
const MARGIN = 8;

export function clampPopoverPosition(anchorRect: DOMRect, panelRect: DOMRect, gap = 6): { top: string; left: string } {
  const width = panelRect.width || panelRect.right - panelRect.left;
  const height = panelRect.height || panelRect.bottom - panelRect.top;

  let left = anchorRect.right - width;
  left = Math.min(left, window.innerWidth - width - MARGIN);
  left = Math.max(left, MARGIN);

  let top = anchorRect.bottom + gap;
  if (top + height > window.innerHeight - MARGIN) {
    top = anchorRect.top - height - gap;
  }
  top = Math.min(top, window.innerHeight - height - MARGIN);
  top = Math.max(top, MARGIN);

  return { top: `${top}px`, left: `${left}px` };
}

// A trigger-button-anchored overlay (dropdown/popover) that stays correctly
// placed no matter what changes around it: window resizes, the trigger
// button itself reflowing to a new toolbar row, or the panel's own content
// growing/shrinking (e.g. more progress tasks appearing). Anything that can
// move the anchor or resize the panel re-runs the same clamp, rather than
// computing a position once at open time and leaving it stale.
//
// Usage: call once per component. Wire `containerRef` to the element
// wrapping both the trigger button and the panel (for outside-click
// detection), `panelRef` to the panel element itself, and call
// `toggle(button)`/`close()` from the trigger button's handlers.
export function createPopover() {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal<Record<string, string>>({});
  let anchorEl: HTMLElement | undefined;
  let panelEl: HTMLElement | undefined;
  let containerEl: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  function reposition() {
    if (!anchorEl || !panelEl) return;
    setPos(clampPopoverPosition(anchorEl.getBoundingClientRect(), panelEl.getBoundingClientRect()));
  }

  function openAt(btn: HTMLElement) {
    anchorEl = btn;
    setOpen(true);
  }

  function toggle(btn: HTMLElement) {
    if (open()) {
      setOpen(false);
      return;
    }
    openAt(btn);
  }

  function close() {
    setOpen(false);
  }

  function containerRef(el: HTMLElement) {
    containerEl = el;
  }

  // The panel only exists in the DOM while open (it's behind a <Show>), so
  // this ref fires fresh on every open — reposition immediately against its
  // real rendered size, then keep watching it for size changes for as long
  // as it's mounted (e.g. a task list growing taller while the panel is up).
  function panelRef(el: HTMLElement) {
    resizeObserver?.disconnect();
    panelEl = el;
    reposition();
    resizeObserver = new ResizeObserver(() => reposition());
    resizeObserver.observe(el);
  }

  function handlePointerDown(e: MouseEvent) {
    if (containerEl && !containerEl.contains(e.target as Node)) close();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  onMount(() => {
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    // Covers both the window changing size and the anchor button moving
    // within it (toolbar reflow at a breakpoint counts as a resize too).
    const onWindowResize = () => reposition();
    window.addEventListener("resize", onWindowResize);
    onCleanup(() => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onWindowResize);
      resizeObserver?.disconnect();
    });
  });

  return { open, pos, containerRef, panelRef, openAt, toggle, close };
}
