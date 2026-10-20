import { Show, createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { ChevronDownIcon } from "./icons";

// Shared primitives for the Settings screen.
//
// Two of them do the heavy lifting for the redesign:
//
//   SettingsSection — a Fluent-style card whose header is a disclosure
//     toggle. Sections remember whether they were folded (persisted to
//     localStorage), which is what keeps a long category like
//     "Appearance & Theme" from being an endless scroll.
//
//   SettingRow — a two-column row: label and description on the left,
//     control on the right. Scalars (sliders, selects, checkboxes) use
//     this; it roughly halves the vertical space each one takes up
//     compared to the old full-width label-above-control stacking.

const COLLAPSED_STORAGE_KEY = "flurer.settings.collapsed";

export type SettingsUiContextValue = {
    isCollapsed: (sectionId: string) => boolean;
    toggleCollapsed: (sectionId: string) => void;
    expand: (sectionId: string) => void;
    /**
     * Bumped on every fold/unfold. The settings shell watches it so its
     * scroll-spy re-measures when a section changes height — folding a
     * section shifts everything below it.
     */
    version: () => number;
};

const SettingsUiContext = createContext<SettingsUiContextValue>();

/**
 * Creates the fold state. The shell owns the instance so it can watch
 * `version()`; the provider then hands the same instance down to every
 * section.
 */
export function createSettingsUi(): SettingsUiContextValue {
    const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
    const [version, setVersion] = createSignal(0);

    // Folded sections are pure UI state — they don't belong in the
    // persisted settings.json, and keeping them out of it means no Rust
    // schema change and no migration.
    onMount(() => {
        try {
            const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
            if (raw) setCollapsed(JSON.parse(raw));
        } catch {
            // A corrupt or unreadable entry just means "nothing folded".
        }
    });

    function persist(next: Record<string, boolean>) {
        try {
            localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Private-mode browsers reject writes; folding still works
            // for the rest of the session.
        }
    }

    function apply(id: string, folded: boolean) {
        const next = { ...collapsed() };
        if (folded) next[id] = true;
        else delete next[id];
        setCollapsed(next);
        setVersion((v) => v + 1);
        persist(next);
    }

    return {
        isCollapsed: (id) => !!collapsed()[id],
        toggleCollapsed: (id) => apply(id, !collapsed()[id]),
        expand: (id) => {
            if (!collapsed()[id]) return;
            apply(id, false);
        },
        version,
    };
}

export function SettingsUiProvider(props: { value: SettingsUiContextValue; children: JSX.Element }) {
    return <SettingsUiContext.Provider value={props.value}>{props.children}</SettingsUiContext.Provider>;
}

/**
 * Fallback for components rendered outside the provider (shouldn't
 * happen, but a missing provider must not crash the settings screen —
 * every section would simply be permanently expanded).
 */
const NOOP_UI: SettingsUiContextValue = {
    isCollapsed: () => false,
    toggleCollapsed: () => {},
    expand: () => {},
    version: () => 0,
};

export function useSettingsUi(): SettingsUiContextValue {
    return useContext(SettingsUiContext) ?? NOOP_UI;
}

export type SettingsSectionProps = {
    id: string;
    title: string;
    description?: string;
    children: JSX.Element;
};

/**
 * A collapsible settings card. The header is a real button so it is
 * reachable by keyboard and announced correctly, and the section's DOM id
 * is the anchor the sub-nav and the search index jump to.
 */
export function SettingsSection(props: SettingsSectionProps) {
    const ui = useSettingsUi();
    const collapsed = () => ui.isCollapsed(props.id);

    return (
        <section
            class="settings-section"
            classList={{ "is-collapsed": collapsed() }}
            id={props.id}
            data-section-id={props.id}
        >
            <button
                type="button"
                class="settings-section-head"
                aria-expanded={!collapsed()}
                aria-controls={`${props.id}-body`}
                onClick={() => ui.toggleCollapsed(props.id)}
            >
                <span class="settings-section-chevron" aria-hidden="true">
                    <ChevronDownIcon />
                </span>
                <span class="settings-section-titles">
                    <span class="settings-section-title">{props.title}</span>
                    <Show when={props.description}>
                        <span class="settings-section-desc">{props.description}</span>
                    </Show>
                </span>
            </button>
            <div class="settings-section-body" id={`${props.id}-body`}>
                {props.children}
            </div>
        </section>
    );
}

export type SettingRowProps = {
    id?: string;
    label: string;
    description?: string;
    /** Force the control onto its own line below the label (choice sets). */
    fullWidth?: boolean;
    children: JSX.Element;
};

/**
 * One setting: a label (with optional explanation) and its control.
 * `id` is the DOM anchor the search index targets, so a search hit can
 * scroll to and flash the exact control rather than just its section.
 */
export function SettingRow(props: SettingRowProps) {
    return (
        <div
            class="setting-row"
            classList={{ "setting-row-full": !!props.fullWidth }}
            id={props.id}
        >
            <div class="setting-row-text">
                <span class="setting-row-label">{props.label}</span>
                <Show when={props.description}>
                    <span class="setting-row-desc">{props.description}</span>
                </Show>
            </div>
            <div class="setting-row-control">{props.children}</div>
        </div>
    );
}

/** Vertical stack of setting rows. */
export function SettingGroup(props: { children: JSX.Element; class?: string }) {
    return <div class={`setting-group${props.class ? ` ${props.class}` : ""}`}>{props.children}</div>;
}
