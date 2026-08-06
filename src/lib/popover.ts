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
