import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { CustomizationSettings } from "./CustomizationSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { UpdatesView } from "./UpdatesView";
import { SearchIndexSettings } from "./SearchIndexSettings";
import { CloseIcon, DownloadIcon, GearIcon } from "./icons";
import type { BackgroundSettings, Theme } from "../lib/settings";
import type { InAppShortcutAction } from "../lib/shortcuts";
import type { Wallpaper } from "../lib/unsplash";
import { registeredPlugins, pluginsWithAppearanceOverride } from "../lib/plugins";
import type { MetricKind, TopBarMetrics } from "../lib/settings";
import { PluginMarketplace } from "./PluginMarketplace";
import { PluginAppearanceSettings } from "./PluginAppearanceSettings";
import { SettingsSearch, type SettingsSearchHit } from "./SettingsSearch";
import { SettingsUiProvider, createSettingsUi } from "./settings-ui";
import {
    SETTINGS_CATEGORIES,
    allVisibleSections,
    sectionsFor,
    type SettingsCategoryDef,
    type SettingsCategoryIcon,
    type SettingsContext,
    type SettingsSectionDef,
} from "../lib/settingsRegistry";

const LAST_CATEGORY_STORAGE_KEY = "flurer.settings.category";

const CATEGORY_ICONS: Record<SettingsCategoryIcon, () => any> = {
    palette: () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </svg>
    ),
    keyboard: () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.001" />
            <path d="M10 8h.001" />
            <path d="M14 8h.001" />
            <path d="M18 8h.001" />
            <path d="M6 12h.001" />
            <path d="M10 12h.001" />
            <path d="M14 12h.001" />
            <path d="M18 12h.001" />
            <path d="M7 16h10" />
        </svg>
    ),
    sparkle: () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4" />
            <path d="m16.2 7.8 2.9-2.9" />
            <path d="M18 12h4" />
            <path d="m16.2 16.2 2.9 2.9" />
            <path d="M12 18v4" />
            <path d="m4.9 19.1 2.9-2.9" />
            <path d="M2 12h4" />
            <path d="m4.9 4.9 2.9 2.9" />
        </svg>
    ),
    magnifier: () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    ),
    download: () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    ),
};

const PLUGIN_CATEGORY_ICON = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
    </svg>
);

type SettingsPanelProps = {
    onClose: () => void;
    background: BackgroundSettings;
    onBackgroundChange: (patch: Partial<BackgroundSettings>) => void;
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    uiTintOpacity: number;
    onUiTintOpacityChange: (opacity: number) => void;
    uiBlurPx: number;
    onUiBlurPxChange: (blurPx: number) => void;
    fontFamily: string;
    onFontFamilyChange: (fontFamily: string) => void;
    fontSizePx: number;
    onFontSizePxChange: (fontSizePx: number) => void;
    sidebarTooltipDelayMs: number;
    onSidebarTooltipDelayMsChange: (delayMs: number) => void;
    showProgressWhenIdle: boolean;
    onShowProgressWhenIdleChange: (show: boolean) => void;
    liveFolderSizeUpdates: boolean;
    onLiveFolderSizeUpdatesChange: (enabled: boolean) => void;
    topBarMetrics: TopBarMetrics;
    onTopBarMetricsChange: (patch: Partial<TopBarMetrics>) => void;
    onToggleTopBarMetricItem: (kind: MetricKind, id: string, enabled: boolean) => void;
    maxHistoryItems: number;
    onMaxHistoryItemsChange: (limit: number) => void;
    globalShortcut: string;
    onGlobalShortcutChange: (shortcut: string) => void;
    inAppShortcuts: Partial<Record<InAppShortcutAction, string>>;
    onInAppShortcutChange: (action: InAppShortcutAction, combo: string) => void;
    onResetInAppShortcut: (action: InAppShortcutAction) => void;
    launchAtStartup: boolean;
    onLaunchAtStartupChange: (enabled: boolean) => void;
    launchAsAdmin: boolean;
    onLaunchAsAdminChange: (enabled: boolean) => void;
    hasUnsplashApiKey: boolean;
    onSaveUnsplashApiKey: (key: string) => void;
    apiKeyError: string;
    wallpaper: Wallpaper | null;
    wallpaperError: string;
    onFetchWallpaper: (query: string) => void;
    onNextCategoryWallpaper: () => void;
    onPrevCategoryWallpaper: () => void;
    canGoPrevCategoryWallpaper: boolean;
    disabledPlugins: string[];
    onDisabledPluginsChange: (disabled: string[]) => void;
    pluginSettings: Record<string, any>;
    onPluginSettingsChange: (pluginId: string, patch: any) => void;
    searchIndexRoots: string[];
    onSearchIndexRootsChange: (roots: string[]) => void;
    recentPaths: string[];
    favouritePaths: string[];
    autoCheckUpdates?: boolean;
    onAutoCheckUpdatesChange?: (enabled: boolean) => void;
    restoreLastStateOnReopen?: boolean;
    onRestoreLastStateOnReopenChange?: (enabled: boolean) => void;
    showHiddenFiles?: boolean;
    onShowHiddenFilesChange?: (enabled: boolean) => void;
    autoCheckUpdateIntervalSeconds?: number;
    onAutoCheckUpdateIntervalSecondsChange?: (seconds: number) => void;
    ignoredUpdateVersion?: string | null;
    onResetIgnoredUpdateVersion?: () => void;
    "data-bg-lightness"?: "light" | "dark";
};

type NavEntry = Omit<SettingsCategoryDef, "id"> & { id: string; iconKey: SettingsCategoryIcon | "plugin" };

export function SettingsPanel(props: SettingsPanelProps) {
    const ui = createSettingsUi();

    const [category, setCategory] = createSignal<string>("customization");
    const [activeSection, setActiveSection] = createSignal<string>("");

    let contentEl: HTMLDivElement | undefined;
    let subnavEl: HTMLDivElement | undefined;
    let rafPending = false;

    // ── Categories ─────────────────────────────────────────────────────────

    const categories = createMemo<NavEntry[]>(() => {
        const list: NavEntry[] = SETTINGS_CATEGORIES.map((c) => ({ ...c, iconKey: c.icon }));
        for (const p of registeredPlugins()) {
            if (!p.settingsPanel) continue;
            list.push({
                id: `plugin-${p.id}`,
                label: p.name,
                description: `Settings for ${p.name}`,
                icon: "palette",
                iconKey: "plugin",
                order: list.length,
            });
        }
        return list;
    });

    const activeCategory = createMemo(() => categories().find((c) => c.id === category()) ?? categories()[0]);

    // ── Sections (sub-nav + scroll-spy) ────────────────────────────────────

    const ctx = createMemo<SettingsContext>(() => ({
        backgroundType: props.background.backgroundType,
        unsplashMode: props.background.unsplashMode,
        hasPluginAppearance: pluginsWithAppearanceOverride().length > 0,
    }));

    const visibleSections = createMemo<SettingsSectionDef[]>(() => sectionsFor(activeCategory().id, ctx()));

    const searchSections = createMemo(() => allVisibleSections(ctx()));

    const subnavHeight = () => subnavEl?.offsetHeight ?? 0;

    function updateActiveSection() {
        if (!contentEl) return;
        const sections = visibleSections();
        if (sections.length === 0) {
            setActiveSection("");
            return;
        }
        const containerRect = contentEl.getBoundingClientRect();
        const line = containerRect.top + subnavHeight() + 8;

        // At the very bottom the last section may be too short to ever
        // cross the line, so treat "scrolled to the end" as "the last
        // section is active".
        const atBottom = contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 4;

        let active = sections[0].id;
        for (const section of sections) {
            const el = document.getElementById(section.id);
            if (!el) continue;
            if (el.getBoundingClientRect().top <= line) active = section.id;
        }
        if (atBottom) active = sections[sections.length - 1].id;
        setActiveSection(active);
    }

    function handleScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            updateActiveSection();
        });
    }

    // Re-measure when the category changes, when a section is folded or
    // unfolded (which shifts everything below it), and on resize.
    createEffect(() => {
        category();
        ui.version();
        requestAnimationFrame(updateActiveSection);
    });

    onMount(() => {
        try {
            const last = localStorage.getItem(LAST_CATEGORY_STORAGE_KEY);
            if (last && categories().some((c) => c.id === last)) setCategory(last);
        } catch {
            // Unreadable storage just means "start on the first category".
        }
        contentEl?.addEventListener("scroll", handleScroll, { passive: true });
        window.addEventListener("resize", handleScroll);
    });

    onCleanup(() => {
        contentEl?.removeEventListener("scroll", handleScroll);
        window.removeEventListener("resize", handleScroll);
    });

    function selectCategory(id: string) {
        setCategory(id);
        setActiveSection("");
        try {
            localStorage.setItem(LAST_CATEGORY_STORAGE_KEY, id);
        } catch {
            // Storage may be unavailable; remembering the category is a
            // convenience, not a requirement.
        }
        // The new category's content replaces the old one on the next
        // frame, so the scroll reset has to wait for it.
        requestAnimationFrame(() => contentEl?.scrollTo({ top: 0, behavior: "auto" }));
    }

    // ── Jumping ────────────────────────────────────────────────────────────

    function scrollToElement(el: HTMLElement, offset = 0) {
        if (!contentEl) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        const target =
            contentEl.scrollTop + (el.getBoundingClientRect().top - contentEl.getBoundingClientRect().top) - offset;
        contentEl.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }

    function jumpToSection(sectionId: string) {
        const el = document.getElementById(sectionId);
        if (!el) return;
        ui.expand(sectionId);
        // The fold changes the layout, so measure again on the next frame.
        requestAnimationFrame(() => scrollToElement(el, subnavHeight() + 12));
    }

    function flash(el: HTMLElement) {
        el.classList.remove("settings-flash");
        // Force a reflow so re-triggering the animation on the same
        // element actually restarts it.
        void el.offsetWidth;
        el.classList.add("settings-flash");
        window.setTimeout(() => el.classList.remove("settings-flash"), 1800);
    }

    function handleJump(hit: SettingsSearchHit) {
        selectCategory(hit.category.id);
        // The category's content has to mount before its anchors exist.
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                ui.expand(hit.section.id);
                requestAnimationFrame(() => {
                    const target =
                        document.getElementById(hit.item.id) ?? document.getElementById(hit.section.id);
                    if (!target) return;
                    scrollToElement(target, subnavHeight() + 12);
                    flash(target);
                });
            }),
        );
    }

    async function exportSettings() {
        try {
            const settingsJson = await invoke("get_settings");
            const blob = new Blob([JSON.stringify(settingsJson, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "flurer-settings.json";
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Failed to export settings", err);
        }
    }

    return (
        <SettingsUiProvider value={ui}>
            <div class="settings-page" data-bg-lightness={props["data-bg-lightness"]}>
                <header class="settings-header">
                    <div class="settings-header-identity">
                        <span class="settings-header-mark" aria-hidden="true">
                            <GearIcon />
                        </span>
                        <div class="settings-header-titles">
                            <h2 class="settings-title">Settings</h2>
                            <p class="settings-subtitle">{activeCategory().label}</p>
                        </div>
                    </div>

                    <div class="settings-header-actions">
                        <SettingsSearch
                            categories={categories()}
                            sections={searchSections()}
                            onJump={handleJump}
                        />
                        <button
                            type="button"
                            class="icon-btn"
                            title="Export settings JSON for debugging or backup"
                            aria-label="Export settings JSON"
                            onClick={() => void exportSettings()}
                        >
                            <DownloadIcon />
                        </button>
                        <button type="button" class="icon-btn" aria-label="Close settings" onClick={props.onClose}>
                            <CloseIcon />
                        </button>
                    </div>
                </header>

                <div class="settings-body">
                    <nav class="settings-nav" aria-label="Settings categories">
                        <div class="settings-nav-list">
                            <For each={categories()}>
                                {(entry) => (
                                    <button
                                        type="button"
                                        class="settings-nav-item"
                                        classList={{ active: category() === entry.id }}
                                        aria-current={category() === entry.id ? "page" : undefined}
                                        onClick={() => selectCategory(entry.id)}
                                    >
                                        <span class="settings-nav-icon">
                                            {entry.iconKey === "plugin" ? PLUGIN_CATEGORY_ICON() : CATEGORY_ICONS[entry.iconKey]()}
                                        </span>
                                        <span class="settings-nav-text">
                                            <span class="settings-nav-title">{entry.label}</span>
                                            <span class="settings-nav-desc">{entry.description}</span>
                                        </span>
                                    </button>
                                )}
                            </For>
                        </div>
                    </nav>

                    <div class="settings-main">
                        <Show when={visibleSections().length > 1}>
                            <div class="settings-subnav" ref={subnavEl}>
                                <For each={visibleSections()}>
                                    {(section) => (
                                        <button
                                            type="button"
                                            class="settings-subnav-pill"
                                            classList={{ active: activeSection() === section.id }}
                                            onClick={() => jumpToSection(section.id)}
                                        >
                                            {section.label}
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>

                        <div class="settings-content" ref={contentEl}>
                            <Show when={category() === "customization"}>
                                <CustomizationSettings
                                    background={props.background}
                                    onBackgroundChange={props.onBackgroundChange}
                                    theme={props.theme}
                                    onThemeChange={props.onThemeChange}
                                    uiTintOpacity={props.uiTintOpacity}
                                    onUiTintOpacityChange={props.onUiTintOpacityChange}
                                    uiBlurPx={props.uiBlurPx}
                                    onUiBlurPxChange={props.onUiBlurPxChange}
                                    fontFamily={props.fontFamily}
                                    onFontFamilyChange={props.onFontFamilyChange}
                                    fontSizePx={props.fontSizePx}
                                    onFontSizePxChange={props.onFontSizePxChange}
                                    sidebarTooltipDelayMs={props.sidebarTooltipDelayMs}
                                    onSidebarTooltipDelayMsChange={props.onSidebarTooltipDelayMsChange}
                                    showProgressWhenIdle={props.showProgressWhenIdle}
                                    onShowProgressWhenIdleChange={props.onShowProgressWhenIdleChange}
                                    liveFolderSizeUpdates={props.liveFolderSizeUpdates}
                                    onLiveFolderSizeUpdatesChange={props.onLiveFolderSizeUpdatesChange}
                                    topBarMetrics={props.topBarMetrics}
                                    onTopBarMetricsChange={props.onTopBarMetricsChange}
                                    onToggleTopBarMetricItem={props.onToggleTopBarMetricItem}
                                    maxHistoryItems={props.maxHistoryItems}
                                    onMaxHistoryItemsChange={props.onMaxHistoryItemsChange}
                                    restoreLastStateOnReopen={props.restoreLastStateOnReopen}
                                    onRestoreLastStateOnReopenChange={props.onRestoreLastStateOnReopenChange}
                                    showHiddenFiles={props.showHiddenFiles}
                                    onShowHiddenFilesChange={props.onShowHiddenFilesChange}
                                    launchAtStartup={props.launchAtStartup}
                                    onLaunchAtStartupChange={props.onLaunchAtStartupChange}
                                    launchAsAdmin={props.launchAsAdmin}
                                    onLaunchAsAdminChange={props.onLaunchAsAdminChange}
                                    hasUnsplashApiKey={props.hasUnsplashApiKey}
                                    onSaveUnsplashApiKey={props.onSaveUnsplashApiKey}
                                    apiKeyError={props.apiKeyError}
                                    wallpaper={props.wallpaper}
                                    wallpaperError={props.wallpaperError}
                                    onFetchWallpaper={props.onFetchWallpaper}
                                    onNextCategoryWallpaper={props.onNextCategoryWallpaper}
                                    onPrevCategoryWallpaper={props.onPrevCategoryWallpaper}
                                    canGoPrevCategoryWallpaper={props.canGoPrevCategoryWallpaper}
                                />
                            </Show>

                            <Show when={category() === "shortcuts"}>
                                <ShortcutsSettings
                                    globalShortcut={props.globalShortcut}
                                    onGlobalShortcutChange={props.onGlobalShortcutChange}
                                    inAppShortcuts={props.inAppShortcuts}
                                    onInAppShortcutChange={props.onInAppShortcutChange}
                                    onResetInAppShortcut={props.onResetInAppShortcut}
                                />
                            </Show>

                            <Show when={category() === "plugins"}>
                                <PluginMarketplace
                                    disabledPlugins={props.disabledPlugins}
                                    onDisabledPluginsChange={props.onDisabledPluginsChange}
                                />
                                <PluginAppearanceSettings
                                    pluginSettings={props.pluginSettings}
                                    onPluginSettingsChange={props.onPluginSettingsChange}
                                    defaultOpacity={props.uiTintOpacity}
                                    defaultBlurPx={props.uiBlurPx}
                                />
                            </Show>

                            {/* `keyed` is required here: without it Solid's Show
                                only re-renders its children when the truthiness
                                of `when` changes, and `when` is a plugin id —
                                always a truthy string. Switching straight from
                                a plugin to another plugin would therefore keep
                                the first plugin's panel on screen. */}
                            <Show
                                when={category().startsWith("plugin-") ? category() : undefined}
                                keyed
                            >
                                {(pluginCategory) => {
                                    const id = pluginCategory.substring(7); // "plugin-".length is 7
                                    const p = registeredPlugins().find((x) => x.id === id);
                                    if (!p || !p.settingsPanel) return null;
                                    return p.settingsPanel({
                                        dataBgLightness: props["data-bg-lightness"] || "light",
                                        pluginSettings: props.pluginSettings[id] || {},
                                        onPluginSettingsChange: (patch: any) => props.onPluginSettingsChange(id, patch),
                                    });
                                }}
                            </Show>

                            <Show when={category() === "search-index"}>
                                <SearchIndexSettings
                                    roots={props.searchIndexRoots}
                                    onRootsChange={props.onSearchIndexRootsChange}
                                    recentPaths={props.recentPaths}
                                    favouritePaths={props.favouritePaths}
                                />
                            </Show>

                            <Show when={category() === "updates"}>
                                <UpdatesView
                                    autoCheckUpdates={props.autoCheckUpdates}
                                    onAutoCheckUpdatesChange={props.onAutoCheckUpdatesChange}
                                    autoCheckUpdateIntervalSeconds={props.autoCheckUpdateIntervalSeconds}
                                    onAutoCheckUpdateIntervalSecondsChange={props.onAutoCheckUpdateIntervalSecondsChange}
                                    ignoredUpdateVersion={props.ignoredUpdateVersion}
                                    onResetIgnoredUpdateVersion={props.onResetIgnoredUpdateVersion}
                                />
                            </Show>
                        </div>
                    </div>
                </div>
            </div>
        </SettingsUiProvider>
    );
}
