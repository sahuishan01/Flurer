import type { BackgroundType, UnsplashMode } from "./settings";
import { IN_APP_SHORTCUT_CATEGORIES, IN_APP_SHORTCUT_LABELS, type InAppShortcutAction } from "./shortcuts";

// The settings registry is the single source of truth for the whole
// Settings screen: the left-hand category rail, the sticky "on this page"
// sub-nav, the cross-category search index and the DOM anchors that both
// of those jump to. Keeping them in one declarative table means a new
// setting is discoverable by search the moment it has an entry here —
// there is no second list to keep in sync.
//
// This module is deliberately data-only (no JSX): icon keys are strings
// that the panel maps to SVG components, so the registry stays importable
// from plain TypeScript and testable without a renderer.

export type SettingsCategoryId =
    | "customization"
    | "shortcuts"
    | "plugins"
    | "search-index"
    | "updates";

/** Key used by SettingsPanel to look up the category's icon. */
export type SettingsCategoryIcon = "palette" | "keyboard" | "sparkle" | "magnifier" | "download";

export type SettingsCategoryDef = {
    id: SettingsCategoryId;
    label: string;
    description: string;
    icon: SettingsCategoryIcon;
    /** Order in the nav rail. */
    order: number;
};

/**
 * A single individual setting — the granularity the search index works
 * at. `id` doubles as the DOM id of the control's row so a search hit can
 * be scrolled to and flashed.
 */
export type SettingsItemDef = {
    id: string;
    label: string;
    keywords: string[];
};

export type SettingsSectionDef = {
    id: string;
    category: SettingsCategoryId;
    label: string;
    description: string;
    items: SettingsItemDef[];
    /**
     * Conditional visibility. Sections that only make sense for the
     * current state (e.g. the Gradient editor when the background is a
     * gradient) are hidden from the sub-nav and the search index when
     * this returns false.
     */
    when?: (ctx: SettingsContext) => boolean;
};

export type SettingsContext = {
    backgroundType: BackgroundType;
    unsplashMode: UnsplashMode;
    /** True when at least one plugin's panel can be restyled from Settings. */
    hasPluginAppearance: boolean;
};

export const SETTINGS_CATEGORIES: SettingsCategoryDef[] = [
    {
        id: "customization",
        label: "Appearance & Theme",
        description: "Wallpapers, colours, translucency, fonts",
        icon: "palette",
        order: 0,
    },
    {
        id: "shortcuts",
        label: "Keyboard Shortcuts",
        description: "Keybindings for actions, navigation, tabs",
        icon: "keyboard",
        order: 1,
    },
    {
        id: "plugins",
        label: "Plugins & Extensions",
        description: "Manage installed plugins and the marketplace",
        icon: "sparkle",
        order: 2,
    },
    {
        id: "search-index",
        label: "Search Index",
        description: "Indexed folders and search performance",
        icon: "magnifier",
        order: 3,
    },
    {
        id: "updates",
        label: "Updates & About",
        description: "Software version, changelog, updater",
        icon: "download",
        order: 4,
    },
];

// ── Appearance & Theme ────────────────────────────────────────────────────

const CUSTOMIZATION_SECTIONS: SettingsSectionDef[] = [
    {
        id: "customization.background",
        category: "customization",
        label: "Background",
        description: "How the wallpaper is drawn behind the app.",
        items: [
            {
                id: "customization.background.type",
                label: "Background type",
                keywords: ["background", "wallpaper", "none", "gradient", "solid color", "unsplash", "photo"],
            },
            {
                id: "customization.background.opacity",
                label: "Background opacity",
                keywords: ["opacity", "background", "wallpaper", "transparency", "strength"],
            },
        ],
    },
    {
        id: "customization.gradient",
        category: "customization",
        label: "Gradient",
        description: "A two-colour gradient behind the interface.",
        when: (ctx) => ctx.backgroundType === "gradient",
        items: [
            {
                id: "customization.gradient.presets",
                label: "Gradient presets",
                keywords: ["gradient", "preset", "swatch", "background"],
            },
            {
                id: "customization.gradient.colors",
                label: "Gradient colours",
                keywords: ["gradient", "start", "end", "colour", "color", "direction", "background"],
            },
        ],
    },
    {
        id: "customization.solid",
        category: "customization",
        label: "Solid colour",
        description: "A single flat colour behind the interface.",
        when: (ctx) => ctx.backgroundType === "solid",
        items: [
            {
                id: "customization.solid.presets",
                label: "Colour presets",
                keywords: ["solid", "color", "colour", "preset", "swatch", "background"],
            },
            {
                id: "customization.solid.custom",
                label: "Custom colour",
                keywords: ["solid", "hex", "rgb", "custom color", "colour", "background"],
            },
        ],
    },
    {
        id: "customization.wallpaper",
        category: "customization",
        label: "Wallpaper",
        description: "Photos from Unsplash, on rotation or fixed.",
        when: (ctx) => ctx.backgroundType === "unsplash",
        items: [
            {
                id: "customization.wallpaper.apiKey",
                label: "Unsplash API key",
                keywords: ["unsplash", "api key", "key", "api", "photo", "wallpaper"],
            },
            {
                id: "customization.wallpaper.rotation",
                label: "Wallpaper rotation",
                keywords: ["auto rotate", "fixed", "rotation", "change every", "frequency", "wallpaper"],
            },
            {
                id: "customization.wallpaper.source",
                label: "Wallpaper source",
                keywords: ["from category", "from fixed list", "category", "categories", "wallpaper"],
            },
            {
                id: "customization.wallpaper.search",
                label: "Search Unsplash",
                keywords: ["search", "unsplash", "photos", "images", "wallpaper"],
            },
            {
                id: "customization.wallpaper.saved",
                label: "Saved wallpapers",
                keywords: ["fixed list", "saved images", "saved", "wallpaper", "unsplash"],
            },
        ],
    },
    {
        id: "customization.theme",
        category: "customization",
        label: "Theme",
        description: "Colour scheme and how translucent the panels are.",
        items: [
            {
                id: "customization.theme.theme",
                label: "Theme",
                keywords: ["theme", "light", "dark", "midnight", "ocean", "nord", "paper", "colour scheme"],
            },
            {
                id: "customization.theme.tint",
                label: "Panel tint",
                keywords: ["panel tint", "tint", "opacity", "translucency", "panel"],
            },
            {
                id: "customization.theme.blur",
                label: "Panel blur",
                keywords: ["panel blur", "blur", "blurriness", "frosted", "acrylic", "mica"],
            },
        ],
    },
    {
        id: "customization.typography",
        category: "customization",
        label: "Typography",
        description: "Typeface and interface scale.",
        items: [
            {
                id: "customization.typography.family",
                label: "Font family",
                keywords: ["font", "fonts", "font family", "typeface", "typography"],
            },
            {
                id: "customization.typography.scale",
                label: "UI scale",
                keywords: ["ui scale", "font size", "text size", "zoom", "typography", "scale"],
            },
        ],
    },
    {
        id: "customization.behavior",
        category: "customization",
        label: "Behavior",
        description: "How the interface reacts while you work.",
        items: [
            {
                id: "customization.behavior.tooltipDelay",
                label: "Sidebar tooltip delay",
                keywords: ["tooltip", "hover", "delay", "sidebar", "behavior"],
            },
            {
                id: "customization.behavior.progress",
                label: "Always show progress indicator",
                keywords: ["progress", "indicator", "always show", "behavior"],
            },
            {
                id: "customization.behavior.folderSize",
                label: "Automatically update folder sizes",
                keywords: ["folder size", "live update", "automatic", "cache", "behavior"],
            },
            {
                id: "customization.behavior.history",
                label: "Maximum recent history items",
                keywords: ["history", "recent", "recents", "limit", "behavior"],
            },
            {
                id: "customization.behavior.hiddenFiles",
                label: "Show hidden files and folders",
                keywords: ["hidden files", "hidden folders", "show hidden", "behavior"],
            },
            {
                id: "customization.behavior.restoreState",
                label: "Preserve last folder state on reopen",
                keywords: ["preserve", "remember", "restore", "last folder", "session", "reopen", "behavior"],
            },
        ],
    },
    {
        id: "customization.metrics",
        category: "customization",
        label: "Top bar metrics",
        description: "Live CPU, memory, GPU, drive and network widgets.",
        items: [
            {
                id: "customization.metrics.enabled",
                label: "Show system metrics in the top bar",
                keywords: ["metrics", "system metrics", "cpu", "memory", "gpu", "top bar", "performance"],
            },
            {
                id: "customization.metrics.interval",
                label: "Refresh interval",
                keywords: ["refresh interval", "metrics", "seconds", "top bar"],
            },
            {
                id: "customization.metrics.devices",
                label: "Metric devices",
                keywords: ["cpu", "memory", "gpu", "drives", "network", "devices", "metrics"],
            },
        ],
    },
    {
        id: "customization.startup",
        category: "customization",
        label: "Startup & system",
        description: "How Flurer launches and integrates with the OS.",
        items: [
            {
                id: "customization.startup.launchAtStartup",
                label: "Launch at startup",
                keywords: ["launch at startup", "autostart", "login", "tray", "minimize", "startup"],
            },
            {
                id: "customization.startup.launchAsAdmin",
                label: "Always run as administrator",
                keywords: ["administrator", "admin", "elevated", "uac", "privileges", "startup"],
            },
            {
                id: "customization.startup.path",
                label: "Environment PATH",
                keywords: ["path", "environment", "terminal", "command line", "add flurer to path"],
            },
        ],
    },
    {
        id: "customization.storage",
        category: "customization",
        label: "Storage",
        description: "The folder-size cache and how much it holds.",
        items: [
            {
                id: "customization.storage.cache",
                label: "Folder size cache",
                keywords: ["cache", "folder size", "storage", "disk usage", "clear cache", "memory"],
            },
        ],
    },
];

// ── Keyboard shortcuts ────────────────────────────────────────────────────

const SHORTCUT_GROUP_SLUGS: Record<string, string> = {
    "File Operations": "files",
    Navigation: "navigation",
    "Tabs & Panes": "tabs",
};

const SHORTCUT_GROUP_DESCRIPTIONS: Record<string, string> = {
    "File Operations": "Shortcuts for acting on the selected files.",
    Navigation: "Shortcuts for moving around the file manager.",
    "Tabs & Panes": "Shortcuts for tabs and split panes.",
};

const SHORTCUT_SECTIONS: SettingsSectionDef[] = [
    {
        id: "shortcuts.global",
        category: "shortcuts",
        label: "System & global",
        description: "Flurer's own hotkeys, including the one that works outside the app.",
        items: [
            {
                id: "shortcuts.global.hotkey",
                label: "Global hotkey to open Flurer",
                keywords: ["global", "hotkey", "system", "shortcut", "open flurer", "tray"],
            },
        ],
    },
    ...IN_APP_SHORTCUT_CATEGORIES.map((group): SettingsSectionDef => {
        const slug = SHORTCUT_GROUP_SLUGS[group.category] ?? group.category.toLowerCase().replace(/\s+/g, "-");
        return {
            id: `shortcuts.${slug}`,
            category: "shortcuts",
            label: group.category,
            description: SHORTCUT_GROUP_DESCRIPTIONS[group.category] ?? `Shortcuts for ${group.category.toLowerCase()}.`,
            items: group.actions.map((action: InAppShortcutAction) => ({
                id: `shortcuts.${slug}.${action}`,
                label: IN_APP_SHORTCUT_LABELS[action],
                keywords: [action, IN_APP_SHORTCUT_LABELS[action].toLowerCase(), "shortcut", "keybinding"],
            })),
        };
    }),
];

// ── Plugins ──────────────────────────────────────────────────────────────

const PLUGIN_SECTIONS: SettingsSectionDef[] = [
    {
        id: "plugins.marketplace",
        category: "plugins",
        label: "Marketplace",
        description: "Install plugins from a GitHub repo or a ZIP file.",
        items: [
            {
                id: "plugins.marketplace.github",
                label: "Install from GitHub",
                keywords: ["github", "install", "repository", "repo", "plugin"],
            },
            {
                id: "plugins.marketplace.zip",
                label: "Install from ZIP",
                keywords: ["zip", "install", "local file", "plugin"],
            },
        ],
    },
    {
        id: "plugins.available",
        category: "plugins",
        label: "Available plugins",
        description: "Browse the published plugin registry.",
        items: [
            {
                id: "plugins.available.registry",
                label: "Plugin registry",
                keywords: ["registry", "marketplace", "available", "browse", "plugins"],
            },
        ],
    },
    {
        id: "plugins.installed",
        category: "plugins",
        label: "Installed plugins",
        description: "Enable, update or remove plugins you have installed.",
        items: [
            {
                id: "plugins.installed.list",
                label: "Installed plugins",
                keywords: ["installed", "uninstall", "disable", "enable", "update", "plugins"],
            },
        ],
    },
    {
        id: "plugins.appearance",
        category: "plugins",
        label: "Plugin appearance",
        description: "Per-plugin translucency overrides.",
        when: (ctx) => ctx.hasPluginAppearance,
        items: [
            {
                id: "plugins.appearance.tint",
                label: "Plugin panel tint",
                keywords: ["plugin", "tint", "opacity", "translucency", "appearance"],
            },
            {
                id: "plugins.appearance.blur",
                label: "Plugin panel blur",
                keywords: ["plugin", "blur", "blurriness", "appearance"],
            },
        ],
    },
];

// ── Search index ─────────────────────────────────────────────────────────

const SEARCH_INDEX_SECTIONS: SettingsSectionDef[] = [
    {
        id: "search-index.index",
        category: "search-index",
        label: "Index",
        description: "Folders searched from memory instead of being walked on every keystroke.",
        items: [
            {
                id: "search-index.index.roots",
                label: "Indexed folders",
                keywords: ["indexed folders", "roots", "folders", "search index", "add folder"],
            },
            {
                id: "search-index.index.rebuild",
                label: "Rebuild or clear the index",
                keywords: ["rebuild", "clear index", "search", "performance"],
            },
        ],
    },
];

// ── Updates ──────────────────────────────────────────────────────────────

const UPDATE_SECTIONS: SettingsSectionDef[] = [
    {
        id: "updates.updates",
        category: "updates",
        label: "App updates",
        description: "Version checks and the updater.",
        items: [
            {
                id: "updates.updates.autoCheck",
                label: "Automatically check for updates",
                keywords: ["auto check", "automatic", "updates", "background check", "updater"],
            },
            {
                id: "updates.updates.interval",
                label: "Auto-check interval",
                keywords: ["interval", "seconds", "how often", "updates", "check"],
            },
            {
                id: "updates.updates.now",
                label: "Check for updates now",
                keywords: ["check now", "check for updates", "download", "update", "updater"],
            },
        ],
    },
    {
        id: "updates.about",
        category: "updates",
        label: "About",
        description: "What version you're running and where to find the changelog.",
        items: [
            {
                id: "updates.about.version",
                label: "Current version",
                keywords: ["version", "about", "build", "release notes", "changelog"],
            },
        ],
    },
];

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
    ...CUSTOMIZATION_SECTIONS,
    ...SHORTCUT_SECTIONS,
    ...PLUGIN_SECTIONS,
    ...SEARCH_INDEX_SECTIONS,
    ...UPDATE_SECTIONS,
];

/** Sections of a category, in nav order, filtered by visibility. */
export function sectionsFor(category: string, ctx: SettingsContext): SettingsSectionDef[] {
    return SETTINGS_SECTIONS.filter((s) => s.category === category && (!s.when || s.when(ctx)));
}

/** Every visible section across every category — the search index. */
export function allVisibleSections(ctx: SettingsContext): SettingsSectionDef[] {
    return SETTINGS_SECTIONS.filter((s) => !s.when || s.when(ctx));
}

export function categoryById(id: string): SettingsCategoryDef | undefined {
    return SETTINGS_CATEGORIES.find((c) => c.id === id);
}
