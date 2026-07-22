---
version: alpha
name: Flurer
description: >-
  A lightweight, fast Windows file manager built with Tauri and SolidJS.
  Implements Windows 11 Fluent Design with Acrylic, Mica, and Glass materials
  in both light and dark themes.
colors:
  primary: "#0078D4"
  secondary: "#106EBE"
  tertiary: "#005A9E"
  neutral: "#F3F3F3"

  light-text-primary: "#1C1C1C"
  light-text-secondary: "#5F5F5F"
  light-acrylic-tint: "#F3F3F3"
  light-mica-tint: "#F3F3F3"
  light-glass-tint: "#FFFFFF"
  light-control-tint: "#FFFFFF"
  light-accent: "#0078D4"
  light-accent-hover: "#106EBE"
  light-accent-active: "#005A9E"
  light-danger: "#BC483A"
  light-success: "#4A8C5C"

  dark-text-primary: "#FFFFFF"
  dark-text-secondary: "#C0C0C0"
  dark-acrylic-tint: "#202020"
  dark-mica-tint: "#202020"
  dark-glass-tint: "#202020"
  dark-control-tint: "#FFFFFF"
  dark-accent: "#60CDFF"
  dark-accent-hover: "#85DAFF"
  dark-accent-active: "#0078D4"
  dark-danger: "#BC483A"
  dark-success: "#4A8C5C"

typography:
  body:
    fontFamily: >-
      "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont,
      Roboto, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  display:
    fontFamily: >-
      "Segoe UI Variable Display", "Segoe UI", -apple-system, BlinkMacSystemFont,
      Roboto, sans-serif
    fontSize: 1.35em
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: >-
      "Segoe UI Variable Display", "Segoe UI", -apple-system, BlinkMacSystemFont,
      Roboto, sans-serif
    fontSize: 1.1em
    fontWeight: 600
    lineHeight: 1.3
  label:
    fontFamily: >-
      "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont,
      Roboto, sans-serif
    fontSize: 0.875em
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: >-
      "Segoe UI Variable Small", "Segoe UI", -apple-system, BlinkMacSystemFont,
      Roboto, sans-serif
    fontSize: 0.75em
    fontWeight: 400
    lineHeight: 1.4
  section:
    fontFamily: >-
      "Segoe UI Variable Small", "Segoe UI", -apple-system, BlinkMacSystemFont,
      Roboto, sans-serif
    fontSize: 0.7em
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.06em"
  mono:
    fontFamily: >-
      ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace
    fontSize: 0.875em

rounded:
  sm: 6px
  md: 8px
  lg: 10px

spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px

components:
  command-bar:
    backgroundColor: "{colors.light-glass-tint}"
    textColor: "{colors.light-text-primary}"
    padding: 12px
  command-bar-dark:
    backgroundColor: "{colors.dark-glass-tint}"
    textColor: "{colors.dark-text-primary}"
    padding: 12px

  command-bar-btn:
    backgroundColor: transparent
    textColor: "{colors.light-text-primary}"
    rounded: "{rounded.md}"
    padding: 8.8px
  command-bar-btn-dark:
    backgroundColor: transparent
    textColor: "{colors.dark-text-primary}"
    rounded: "{rounded.md}"
    padding: 8.8px

  titlebar-btn:
    backgroundColor: transparent
    textColor: "{colors.light-text-primary}"
    height: 100%
    width: 46px
  titlebar-btn-dark:
    backgroundColor: transparent
    textColor: "{colors.dark-text-primary}"
    height: 100%
    width: 46px
  titlebar-btn-close:
    backgroundColor: transparent
    textColor: "{colors.light-text-primary}"
    height: 100%
    width: 46px
  titlebar-btn-close-hover:
    backgroundColor: "#E81123"
    textColor: "#FFFFFF"
  titlebar-btn-close-active:
    backgroundColor: "#BF0F1D"
    textColor: "#FFFFFF"

  sidebar:
    backgroundColor: "{colors.light-acrylic-tint}"
    textColor: "{colors.light-text-primary}"
    rounded: "{rounded.sm}"
    width: 200px
  sidebar-dark:
    backgroundColor: "{colors.dark-acrylic-tint}"
    textColor: "{colors.dark-text-primary}"
    width: 200px

  view-rail:
    backgroundColor: transparent
    textColor: "{colors.light-text-primary}"
    width: 52px
  view-rail-dark:
    backgroundColor: transparent
    textColor: "{colors.dark-text-primary}"
    width: 52px

  search-field:
    backgroundColor: "{colors.light-control-tint}"
    textColor: "{colors.light-text-primary}"
    rounded: "{rounded.md}"
  search-field-dark:
    backgroundColor: "{colors.dark-control-tint}"
    textColor: "{colors.dark-text-primary}"

  accent-btn:
    backgroundColor: "{colors.light-accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
  accent-btn-hover:
    backgroundColor: "{colors.light-accent-hover}"
    textColor: "#FFFFFF"

---

## Overview (Brand & Style)

Flurer is a Windows-native file manager that implements the **Windows 11 Fluent Design Language**. Its visual identity combines:

- **Acrylic material** — strongly blurred, medium opacity surfaces for sidebars
- **Mica material** — subtly tinted, higher opacity backdrop for window backgrounds
- **Glass material** — highly translucent, crisp overlays for content panels
- **Inset controls** — soft chiseled borders and inset shadows for buttons and inputs

The design is fully dual-theme (light/dark) with theme-aware lightness calculations that adjust text contrast against background images.

## Colors

- **Primary (#0078D4 light / #60CDFF dark):** Windows 11 standard accent blue. Used for interactive highlights, active states, and search field focus rings.
- **Secondary (#106EBE light / #85DAFF dark):** Hover state for accent elements.
- **Tertiary (#005A9E light / #0078D4 dark):** Active/pressed state for accent elements.
- **Neutral (#F3F3F3 light / #202020 dark):** Panel and surface tints for acrylic/mica materials.
- **Danger (#BC483A):** File operation failures, error states, close button hover.
- **Success (#4A8C5C):** Completed operations.

## Typography

Segoe UI Variable (Display / Text / Small) is the typeface across all weights. The `body` style is the base at 16px with 1.5 line-height. `section` (11px all-caps with 0.06em letter spacing) is used for sidebar grouping labels. `mono` is reserved for terminal output and file sizes in list views.

## Layout & Spacing

The app layout is a vertical flex stack:

1. **CommandBar** — navigation, search, view controls, and window titlebar buttons
2. **Explorer View** — a horizontal flex row of ViewRail → Sidebar (optional) → ViewStack

### View Rail
A fixed 52px icon strip at the far left for switching between Explorer, Graph view, and Settings — icons only, no labels, only tooltips.

### View Stack
The main content area where the active view (Explorer, plugin panel, Settings) is rendered. Plugin panels stay mounted and are hidden via `display: none` to preserve state.

## Components

### CommandBar
The sole header/titlebar element. Contains back/forward navigation, view controls (e.g. breadcrumb path bar), search input, recursive toggle, and the window control buttons. The entire bar is a `data-tauri-drag-region` for custom window dragging.

### TitleBar Controls
Three buttons at the far right of the CommandBar — minimize, maximize/restore, close. The maximize button toggles between a single-rectangle icon and an overlapping-rectangle icon based on the window's maximized state. Close button shows Windows-red hover (#E81123). All three use `tabIndex={-1}`.

### Search Field
A composite control: search icon + text input + recursive-toggle button. Expands horizontally on focus.

## Do's and Don'ts

- **DO** use `data-bg-lightness` on context panels to ensure text contrast against dynamic backgrounds.
- **DO** implement materials as CSS backdrop-filter blur with rgba tint layering.
- **DO NOT** flatten the chiseled border effect — buttons and inputs need `border-bottom` one step darker than the other three sides.
- **DO NOT** nest `data-tauri-drag-region` elements — interactive children are excluded automatically.
- **DO** use glass-shadow for floating panels and control-shadow for depressed/inset controls — the optical depth is different.