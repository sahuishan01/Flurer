---
version: alpha
name: Flurer
description: A lightweight Windows file manager built on Windows 11 Fluent Design principles — acrylic, mica, and glass materials with transparent surfaces and subtle blur.
colors:
  primary: "#1C1C1C"
  primary-light: "#1C1C1C"
  primary-dark: "#FFFFFF"
  on-primary: "#FFFFFF"
  secondary-light: "#5F5F5F"
  secondary-dark: "#C0C0C0"
  accent-light: "#0078D4"
  accent-dark: "#60CDFF"
  danger: "#BC483A"
  success: "#4A8C5C"
typography:
  display:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 1.35em
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 1.1em
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 1em
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'zero' 1"
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 0.875em
    fontWeight: 500
    lineHeight: 1.4
  secondary:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 0.875em
    fontWeight: 400
    lineHeight: 1.4
    opacity: 0.7
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 0.75em
    fontWeight: 400
    lineHeight: 1.3
  section:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 0.7em
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
    textTransform: uppercase
  badge:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 0.875em
    fontWeight: 400
rounded:
  sm: 6px
  md: 8px
  lg: 10px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
breakpoints:
  mobile: 600px
shadows:
  sm: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)"
  md: "0 4px 16px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)"
  lg: "0 8px 24px rgba(0,0,0,0.1)"
  dark-sm: "0 1px 3px rgba(0,0,0,0.2)"
  dark-md: "0 4px 16px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15)"
  dark-lg: "0 8px 24px rgba(0,0,0,0.4)"
components:
  icon-btn:
    backgroundColor: "rgba(255,255,255,calc(var(--surface-opacity,0.5)*0.4))"
    textColor: "{colors.primary-light}"
    rounded: "{rounded.sm}"
    padding: "0.5em"
  icon-btn-hover:
    backgroundColor: "rgba(255,255,255,0.7)"
    textColor: "{colors.primary-light}"
  icon-btn-active:
    backgroundColor: "rgba(255,255,255,0.35)"
  icon-btn-active-view:
    backgroundColor: "rgba(0,120,212,0.08)"
    textColor: "{colors.accent-light}"
    rounded: "{rounded.sm}"
  context-menu-item:
    backgroundColor: transparent
    textColor: "{colors.primary-light}"
    rounded: "{rounded.sm}"
    padding: "0.5em 0.8em"
  context-menu-item-hover:
    backgroundColor: "rgba(0,0,0,0.04)"
  context-menu-item-danger:
    textColor: "{colors.danger}"
  card:
    rounded: "{rounded.md}"
    backgroundColor: "rgba(255,255,255,0.75)"
    padding: "0.75em 1em"
  modal:
    rounded: "{rounded.lg}"
    size: 320px
    backgroundColor: "rgba(255,255,255,0.85)"
  modal-backdrop:
    backgroundColor: "rgba(0,0,0,0.35)"
  danger-button:
    backgroundColor: "{colors.danger}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "0.5em 1em"
  progress-bar:
    height: 4px
    rounded: 2px
    backgroundColor: "rgba(0,0,0,0.08)"
  progress-bar-fill:
    backgroundColor: "{colors.accent-light}"
    height: 100%
    rounded: 2px
  progress-bar-fill-error:
    backgroundColor: "{colors.danger}"
  progress-badge:
    size: 14px
    rounded: 7px
    backgroundColor: "{colors.accent-light}"
    textColor: "#FFFFFF"
  search-field:
    rounded: "{rounded.lg}"
    backgroundColor: "rgba(255,255,255,0.2)"
    padding: "0.35em 0.8em"
  drive-usage-bar:
    height: 4px
    rounded: 2px
    backgroundColor: "rgba(0,0,0,0.08)"
  drive-usage-fill:
    height: 100%
    rounded: 2px
    backgroundColor: "{colors.accent-light}"
  drive-usage-fill-low:
    backgroundColor: "{colors.danger}"
  skeleton-shimmer:
    height: "0.8em"
    rounded: 4px
---

## Overview

Flurer is a lightweight Windows file manager that brings the Windows 11 Fluent Design language to the desktop. The interface is built from layered, translucent materials — **Mica** for the top-level shell, **Acrylic** for navigational elements like the sidebar, and **Glass** for content areas. Every surface is configurable in opacity, blur radius, and tint, and the entire UI supports both light and dark themes with full wallpaper integration.

The visual tone is **crisp, quiet, and purposeful** — surfaces recede, letting file content and system accent color lead the composition. No solid fills. No hard edges. Every interaction communicates through subtle translucency and 1px chiseled borders.

## Colors

### Semantic palette

- **Primary Light (#1C1C1C) / Dark (#FFFFFF):** Core text, headlines, high-emphasis labels. Flips with theme.
- **Secondary Light (#5F5F5F) / Dark (#C0C0C0):** Metadata, timestamps, file sizes, hints. Lower emphasis.
- **Accent Light (#0078D4) / Dark (#60CDFF):** The sole interaction driver. Selected states, active view indicators, focused inputs, progress fills, link colors, badge backgrounds. Fluent Blue in light mode, Sky Blue in dark.
- **Danger (#BC483A):** Delete operations, error text, error progress bars, failed-task indicators.
- **Success (#4A8C5C):** Confirmation states (API key configured, operation completed).

### Surface palette

Colors are expressed as translucent `rgba()` values layered over the wallpaper or base panel. The light/dark switch toggles:

- **Panel tint RGB:** `255,255,255` light → `32,32,32` dark — base for glass, mica, and control surfaces.
- **Acrylic tint RGB:** `243,243,243` light → `32,32,32` dark — the sidebar's distinct tint.
- **Control opacity:** `~0.2` light → `~0.175` dark — inset controls are slightly more transparent in dark mode.
- **Surface opacity:** Configurable at runtime via `--surface-opacity` (default `0.5`). The user controls how opaque every surface is.

### Text shadows

All text over translucent backgrounds carries a text shadow for legibility against unpredictable wallpaper content:

- **Light:** `0 1px 1px rgba(255,255,255,0.7)` — white backplate glow
- **Dark:** `0 1px 2px rgba(0,0,0,0.6), 0 0 1px rgba(0,0,0,0.5)` — stronger black shadow

## Typography

The type system uses **Segoe UI Variable Text** (Windows 11's default) as the primary face on Windows, with a fallback chain for other platforms. The entire app uses a single font family — hierarchy is carried by weight and size alone.

### Type scale (relative to 16px base)

| Token       | Size     | Weight | Use                                              |
|-------------|----------|--------|--------------------------------------------------|
| `display`   | 1.35em   | 600    | Page headings (settings title, graph title)       |
| `title`     | 1.1em    | 600    | Section headings (settings section h3, dialog h3) |
| `body`      | 1em      | 400    | Base body, file names                             |
| `label`     | 0.875em  | 500    | Buttons, controls, inputs                         |
| `secondary` | 0.875em  | 400    | Metadata, timestamps, breadcrumb separators       |
| `caption`   | 0.75em   | 400    | Hints, drive usage text, error messages           |
| `section`   | 0.7em    | 700    | Sidebar section labels (uppercase, wide tracked)  |
| `badge`     | 10px     | 700    | Progress badge count                              |

### Dark mode compensation

In dark mode, body text gets **line-height 1.55** and **letter-spacing 0.01em** to counteract the optical thinning of light-on-dark type.

## Layout & Spacing

Spacing follows a loose 4px grid expressed in `em` units to respect the user's font-size preference:

- **4px** (`xs`): Dense inline gaps (badge offset, sidebar remove icon margin)
- **8px** (`sm`): Intra-component gaps (icon groups, button label spacing)
- **16px** (`md`): Standard spacing between elements (file table cell padding, sidebar padding, settings section padding)
- **24px** (`lg`): Section breaks, modal padding
- **48px** (`xl`): Page margins (reserved, not currently in use)

### Rail and sidebar dimensions

- **View rail:** 52px wide — icon-only vertical strip for switching top-level views
- **Sidebar:** 200px wide — drives, recents, favourites, and custom plugin content
- **Search field:** Flexes from 140px to 260px (idle) to 320px (focused)

## Elevation & Depth

Depth is communicated through shadows and backdrop blur, not cascading z-indices. The surface stack (outside-in):

1. **Wallpaper** (z-index -1) — the deepest layer, always behind glass
2. **Glass / Mica** (base layers) — `backdrop-filter: blur(15–20px)`, opacity 0.7–0.85
3. **Acrylic** (sidebar) — `blur(30px)`, lower opacity (0.55–0.65), distinct tint
4. **Controls** (search field, path bar, buttons) — `blur(10px)`, highest opacity
5. **Context menu** (z-index 200) — `box-shadow: shadow-md`, border-strong
6. **Modal backdrop** (z-index 300) — `rgba(0,0,0,0.35)` with `blur(4px)`
7. **Progress panel** (z-index 9999) — highest, fixed-position

### Shadow tokens

| Token     | Light                                   | Dark                                    |
|-----------|-----------------------------------------|-----------------------------------------|
| `sm`      | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` | `0 1px 3px rgba(0,0,0,0.2)`           |
| `md`      | `0 4px 16px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)` | `0 4px 16px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15)` |
| `lg`      | `0 8px 24px rgba(0,0,0,0.1)`            | `0 8px 24px rgba(0,0,0,0.4)`          |

### Material recipes

**Acrylic (sidebar):** `rgba(243,243,243,0.65)` light / `rgba(32,32,32,0.55)` dark, `blur(30px)`, `1px rgba(0,0,0,0.08)` border, `inset 0 0 0 1px rgba(255,255,255,0.4)` highlight.

**Mica (command bar, base):** `rgba(243,243,243,0.85)` light / `rgba(32,32,32,0.8)` dark, `blur(15px)`, `1px rgba(0,0,0,0.08)` border.

**Glass (content area):** `rgba(255,255,255,0.75)` light / `rgba(32,32,32,0.7)` dark, `blur(20px)`, `1px rgba(0,0,0,0.08)` border.

**Control (search, path bar, buttons):** `rgba(255,255,255,~0.2)` light, `blur(10px)`, `1px rgba(0,0,0,0.08)` border, chiseled `border-bottom: 1px rgba(0,0,0,0.16)`.

## Shapes

Rounded corners are subtle throughout — consistent with Windows 11's rounding:

- **sm (6px):** Icon buttons, context menu items, option buttons, setting nav items, sidebar items, drive usage bars, progress bars, progress task cancel buttons, breadcrumb segments
- **md (8px):** Cards, settings sections, context menus, swatches, spinners, sidebars, modal buttons
- **lg (10px):** Search field, path bar, progress panel, modal panel

## Components

### `icon-btn`
The universal icon button. Used in the command bar, view rail, sidebar entries, and anywhere a compact icon action is needed.

States: hover (chiseled border elevates, slight lift `translateY(-0.5px)`), active (press `translateY(0.5px)`, reduced shadow), disabled (opacity 0.3, no interaction), `active` class (accent border + tinted background — pinned views).

### `context-menu-item`
Right-click menu item. States: hover (subtle `--hover-bg` background). `disabled` items are 0.4 opacity. `danger` items tint text, not background (except modals where `danger-button` gets a solid fill).

### `danger-button`
Solid red fill (`--danger`) with white text. Used in delete-confirmation modal actions. Darkens on hover with `color-mix`.

### `modal`
Fixed-position overlay with `blur(4px)` backdrop. Background is the current panel surface. Minimum width 320px, max 90vw. Header-body-actions layout. Action buttons align to the end with `gap: 0.6em`.

### `card`
Grouped content surface in settings and plugin panels. Translucent panel background with 1px border. No shadow by default.

### `progress-bar`
Thin horizontal bar (4px) in the progress indicator panel. Active jobs animate width as percentage. Indeterminate jobs slide a 40% bar with `translateX` animation (1.2s ease-in-out infinite). Error states turn fill to `--danger`.

### `progress-badge`
Circular notification badge on the progress indicator button. Min-width 14px, height 14px, accent fill with white text. Positioned `inset-block-start: -2px, inset-inline-end: -2px`.

### `search-field` / `path-bar`
Input-like control using control material. On hover, the chiseled border deepens. On focus-within, the field widens (search: 140→320px), accent border appears, and a `0 0 0 1.5px` accent ring is drawn.

### `drive-usage-bar`
4px thin bar in the sidebar drive entry. Default fill is accent. When usage ≥ 90%, fill switches to danger.

### `skeleton-shimmer`
Loading placeholder for file list rows. Animated shimmer gradient at 1.5s infinite looping. 4px border-radius.

## Do's and Don'ts

- **Do** use translucent `rgba()` surfaces with backdrop blur — the app is designed around material layering over dynamic wallpaper.
- **Do** use `--surface-opacity` and `--surface-blur` CSS custom properties for all translucency; these are runtime-configurable by the user.
- **Don't** introduce solid-fill panels. Every container should be configurable in opacity and blur.
- **Don't** use shadows as the primary depth cue — blur radius and surface tint carry the layer hierarchy.
- **Don't** use multiple font families. Segoe UI Variable covers all hierarchy through weight and size.
- **Do** apply `text-shadow` (`--text-shadow`) to all text over translucent backgrounds to maintain legibility against unpredictable wallpaper.
- **Don't** hardcode border colors — use `--border-color` and `--border-strong` which flip with theme.
- **Do** use `color-mix(in oklch, ...)` for hover/active backgrounds on controls to tint toward the accent without losing the base surface.
- **Don't** add solid-background buttons in the file list, sidebar, or context menu — they should inherit the surface material of their parent.