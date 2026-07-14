# Flurer — Design Review

Review date: 2026-07-13
Register: Product (file manager / storage visualizer)

---

## TL;DR

Flurer has a clear point of view — glassmorphism over dynamic backgrounds is a considered surface language that distinguishes it from flat file managers. The storage graph view is the differentiator and it works well. The weakest areas are focus/accessibility (no visible focus rings), empty states (nothing shown when folders are empty or sidebar sections are missing), and a conventional blue/cyan accent that doesn't carry much brand voice. The core interactions are solid; the polish layer has gaps.

**Primary recommendation:** Add visible focus rings and empty states. These are the highest-impact changes for the least code.

---

## Score: 33 / 50

| Heuristic | Score | Key Finding |
|-----------|-------|-------------|
| First impression | 7/10 | Glassmorphism + wallpaper system creates a distinctive look; "Flurer" name is generic for a storage tool |
| Hierarchy | 7/10 | Layout is clear; sidebar truncation is aggressive at 180px; graph toolbar feels cramped |
| Color voice | 6/10 | Accent is functional but conventional; dark-theme panel contrast risks being too low over wallpapers |
| Type voice | 7/10 | Inter is a solid choice; user-adjustable font-size is excellent; rendering quality is well-tuned |
| Interaction feel | 6/10 | Hover states are consistent; no visible focus rings; missing empty states; no loading skeleton for file list |

---

## Walkthrough

### First launch

The app shows a loading spinner over a glass panel while settings load and wallpaper is cached. This blocks the entire interface — the spinner is small (28px) against the full viewport and there's no progress indication. A cached wallpaper path works well to speed this up, but the gate function (`appReady()`) ties readiness to wallpaper availability, meaning a slow network would keep the user at a spinner even though the file system is available.

### Explorer mode

The layout stack is view rail → sidebar → content area. The command bar sits above with back/forward navigation, breadcrumb path, search, and progress indicator. This is a familiar pattern and works.

- Breadcrumb editing (click path → type → go) is cleanly implemented with an inline form swap.
- The file table is sparse but functional — sort headers, folder/file icons, size, modified date.
- Folder sizes load lazily via background computation, which is excellent UX. Pending folders show "Calculating…".
- Empty folders show a blank table with just the header row and no message. This is a miss — the user sees nothing and may think the folder failed to load.
- The context menu is feature-rich (copy, cut, paste, rename, recalculate, favourite, delete) with proper undo/delete-to-recycle-bin patterns.

### Graph mode

The storage graph is the hero feature. SVG nodes connected by bezier curves, pannable and zoomable (now cursor-aware after this session's fixes). Nodes show icon + label with expandable folders.

- The toolbar is compact — title, undo/redo, hint text, error messages. It works but the hint text ("Drag canvas…") is informational and pushes the title small.
- Graph node cards are clean (rounded rects, icon, label, chevron for expandable nodes, spinner for loading).
- The pulse animation for search/focus matches is well-judged (1.4s cycle with glow).
- The tooltip on hover is a nice detail showing node metadata.
- Dashed strokes for file nodes is a smart visual distinction from folder nodes.
- The fit-to-view button is correctly positioned bottom-right.

### Settings mode

Settings has its own nav sidebar and content area, matching the main layout pattern. Sections are grouped cleanly.

- Background settings (gradient builder, solid colors, Unsplash integration) are comprehensive.
- The API key management pattern (stored in OS credential store, not settings) is a good security choice.
- Font family and size controls are present with presets.
- The wallpaper auto-rotation feature with category and fixed-list modes is ambitious and well-implemented.

---

## Issues by Priority

### P1 — No visible focus rings

```css
input, button, select { outline: none; }
```

This removes the default focus indicator without providing a replacement. Keyboard users navigating the file list, sidebar, or settings controls have no visual cue of their position. This is an accessibility failure.

**Fix:** Add a focus ring style — 2px offset from the element with 3:1 contrast against its background. Use `:focus-visible` to avoid showing a ring on mouse clicks.

### P1 — Missing empty states

An empty folder shows a blank `<table>` with only the header row. No message, no illustration, no guidance. The user doesn't know if the folder loaded successfully (it's just empty) or if something failed (error messages are separate).

The `when` condition for sidebar sections (`Recents`, `Favourites`) hides the section entirely when empty — the user sees nothing and might not know the feature exists.

**Fix:** Add an empty state row to the file table: "This folder is empty" with an icon. For sidebar sections, show the section label with a subtle "No recent folders" or "No favourites yet" line below it instead of hiding the section.

### P2 — Wallpaper gate blocks UI on startup

The `appReady()` function waits for wallpaper cache to resolve before showing the interface:

```ts
function appReady(): boolean {
  return settingsLoaded() && !wallpaperPending();
}
```

The wallpaper fetch is fire-and-forget after the cached wallpaper is available, but if both cache and live fetch fail, the entire app is blocked at a spinner. The file system and graph are not dependent on wallpaper.

**Fix:** Separate the wallpaper loading from app readiness. Show the interface immediately with `settingsLoaded()` and let the wallpaper appear when ready.

### P2 — Sidebar truncation is aggressive

The sidebar is fixed at 180px. Long drive names (e.g., "C: (Windows with a long name)") or deep paths in recents are truncated with ellipsis. The `title` attribute provides the full path on hover, but this is not accessible for touch users.

**Fix:** Allow sidebar width to be slightly wider or add a tooltip that works on touch. Consider `min-width: 180px` with `width: auto` or a resizable sidebar.

### P2 — Accent color changes between themes

Light mode uses `#396cd8` (blue), dark mode uses `#24c8db` (cyan). This means the brand color changes depending on theme, which undermines visual recognition. Most apps keep the same hue and adjust lightness/saturation for theme contrast.

**Fix:** Pick one accent hue (either the blue or the cyan) and derive the dark/light variants from it. Keep the perceptual identity consistent.

### P3 — No loading state in file list

When navigating to a new folder, the file list effect triggers `refresh()` which shows a spinner as part of the Tauri invocation, but there's no skeleton or shimmer for the table rows. The table simply swaps from old content to new content.

**Fix:** Add a subtle loading state — either a row shimmer or keep the previous content visible during the transition.

### P3 — Graph toolbar hint text is permanent

The hint text "Drag canvas to pan · drag a node to reposition · scroll to zoom · click to expand" is always visible. After the first few seconds, returning users don't need it and it takes up toolbar space.

**Fix:** Show the hint on first visit, then fade it or collapse it after a timeout. Add a small "?" icon to bring it back.

---

## What's Working Well

- **Glassmorphism surface system** — The consistent use of `backdrop-filter: blur()` with opacity creates a cohesive, premium surface language that works over any background type (photo, gradient, solid).
- **Background wallpaper system** — Full-featured with Unsplash integration, auto-rotation, category and fixed-list modes, cached on disk for fast startup.
- **Storage graph view** — The differentiator. SVG rendering with bezier edges, draggable nodes, cursor-aware zoom, persistent state, and search highlighting. Execution is strong.
- **Inline breadcrumb editing** — Click-to-edit the path is a power-user feature that's well-implemented with a clean form swap.
- **Lazy folder size computation** — Background size calculation with "Calculating…" indicator is excellent UX. No blocking on folder loading.
- **Theme and font customization** — User-adjustable everything (theme, font, font-size, opacity, blur) with a comprehensive settings panel.
- **State handling for graph** — Pan, zoom, expanded nodes, and dragged positions are all persisted. Undo/redo for graph operations is a rare and welcome touch.

---

## Next Modes

| Mode | Target |
|------|--------|
| `interaction` | Add focus rings, empty states, loading states, touch tooltips |
| `surface` | Harden file list states, sidebar responsiveness, startup sequence |
| `recolor` | Unify accent across themes, tune dark-theme panel contrast |
| `refine` | Graph toolbar hint behavior, sidebar truncation treatment |

---

## Summary

Flurer is a considered application with real craft. The surface language is distinctive, the graph view is genuinely novel, and the background system is ambitious. The gaps that hold it back from feeling polished are specific and fixable — focus rings, empty states, and the wallpaper startup gate are the three changes that would move the needle most.
