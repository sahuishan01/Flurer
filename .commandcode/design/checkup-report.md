# Flurer — Design Checkup

Checkup date: 2026-07-14
Register: Product (file manager / storage visualizer)

---

## Score: 50 / 60

| Vital | Score | Status |
|-------|-------|--------|
| Intentionality | 10/10 | Healthy |
| Readability | 10/10 | Healthy |
| Usability | 10/10 | Healthy |
| Responsiveness | 5/10 | Watch |
| Speed | 10/10 | Healthy |
| Accessibility | 5/10 | Watch |

---

## Intentionality — 10/10 (Healthy)

The Grounded Warmth direction is consistent across every surface. Warm matte panels, amber accent, soft shadows. The glassmorphism was removed in the redesign and replaced with authored matte — nothing looks like a framework default. The panel-tint variant for sidebar and settings nav breaks up the surface hierarchy intentionally. Every radius, shadow, and hover state draws from the same token set.

---

## Readability — 10/10 (Healthy)

Body text at `1em` with `1.5` line-height on a warm cream background is comfortable. Dark mode uses warm charcoal with slightly higher contrast text. The file table header uses `0.85em` uppercase with good opacity spacing — scannable without dominating. Empty states exist ("This folder is empty", "No recent folders", "No favourites yet"). Font size is user-adjustable via settings. The sidebar truncation at narrow widths is handled with the floating tooltip overlay.

---

## Usability — 10/10 (Healthy)

The primary task (browse → navigate → manage files) flows without friction. Breadcrumb editing, history back/forward, recursive search, folder size computation in background, context menu with copy/cut/paste/rename/delete, undo via recycle bin pattern, favourites and recents. The graph view adds a genuinely useful differentiator with pan, zoom, node drag, search focus, and persistent layout. Keyboard shortcuts exist for core operations (Ctrl+C/V/X, Delete, F2, Ctrl+A).

---

## Responsiveness — 5/10 (Watch)

Breakpoints at 900px and 600px handle the sidebar collapse (icon-only at 52px) and command bar wrapping. Touch targets are 44px for coarse pointers. The sidebar tooltip correctly uses `position: fixed` to avoid clipping.

**Watch items:**
- RTL not supported — layout uses `left`/`right` instead of `start`/`end`. Icons don't mirror for right-to-left reading direction.
- Container queries not used — components don't adapt to their container width.
- Settings nav at 600px only has one category, but the pattern wouldn't gracefully collapse with more.

---

## Speed — 10/10 (Healthy)

No layout shift on load. Settings read from local backend (quick disk read). Wallpaper system caches to disk so startup never waits on network — the cached image shows immediately while the fresh Unsplash fetch runs silently in the background. Folder sizes compute lazily with a "Calculating…" indicator — never blocks the listing. Progress panel shows live copy/move/delete status. Skeleton shimmer is present for loading states.

---

## Accessibility — 5/10 (Watch)

**What's good:**
- Focus-visible outlines (2px accent, offset 2px) on inputs, buttons, selects.
- Touch targets at 44px for `pointer: coarse`.
- Keyboard shortcuts for file operations (Ctrl+C/V/X, Delete, F2, Ctrl+A).
- Context menu items have disabled states.
- Empty states provide screen context.

**Watch items:**
- No `prefers-reduced-motion` support. The loading spinner, skeleton shimmer, and graph node pulse animation all run unconditionally.
- File table rows (`<tr>`) are not keyboard-focusable. Tab navigation skips them; they rely on global keydown listeners.
- Icon-only buttons (command bar nav, view rail items) lack `aria-label` in some places.
- No `role` or `aria-` attributes on the file table for screen reader context.
- Color contrast on accent: `#c48a3a` on white is ~2.8:1 — fine for decorative active states, but would fail AA if used for body text.

---

## Prescriptions

| Issue | Severity | Fix |
|-------|----------|-----|
| File rows not keyboard-focusable | Watch | Make `file-row` elements tabbable (`tabindex="0"`) or use `<button>` rows. |
| No reduced-motion | Watch | Add `@media (prefers-reduced-motion)` to disable animations and transitions. |
| RTL not supported | Watch | Replace `left/right` with CSS logical properties (`inset-inline-start/end`). |
| Accent contrast for UI text | Watch | Reserve accent for decorative/border use only; never for body text. |

---

## What's Working Well

- **Grounded Warmth surface language** — matte warm panels with amber accent are cohesive and authored.
- **Empty states** — every section (file table, recents, favourites) shows something when empty.
- **Background folder size** — lazy computation with "Calculating…" is excellent UX.
- **Wallpaper caching** — startup never blocks on network.
- **Responsive sidebar** — collapses cleanly to icon-only; tooltip overlay doesn't clip.
- **Focus-visible outlines** — implemented with proper offset and accent color.
