import { Show, createContext, createSignal, useContext, type JSX } from "solid-js";
import { ChevronDownIcon } from "../icons";

// Shared UI kit — the collapsible card and the two-column field row.
//
// These started life as settings-only primitives (src/components/settings-ui.tsx)
// but nothing about them is settings-specific: a modal, a plugin panel or
// the properties dialog can render the same disclosure card and label/control
// row. They live here now so those surfaces can share them instead of
// re-implementing the same markup and CSS.

/**
 * Collapse state for a group of collapsible sections.
 *
 * Shared through a provider so every section in a surface folds and
 * unfolds together. The state lives in memory, and is persisted to
 * localStorage when a storage key is given, so folds survive a restart.
 */
export type CollapsibleState = {
    /** Whether the section with this id is currently folded. */
    isCollapsed: (id: string) => boolean;
    /** Fold or unfold the section with this id. */
    toggleCollapsed: (id: string) => void;
    /** Unfold the section with this id. A no-op if it is already open. */
    expand: (id: string) => void;
    /**
     * Bumped on every fold/unfold. A consumer that measures its own
     * layout (a scroll-spy, say) can watch this to re-measure when
     * folding a section shifts everything below it.
     */
    version: () => number;
};

/**
 * Creates the collapse state for one surface.
 *
 * `storageKey` names the localStorage entry the folded ids are written
 * to. Surfaces that want their folds to survive a restart pass one; a
 * surface that does not care can omit it and the state stays in memory.
 */
export function createCollapsibleState(options: { storageKey?: string } = {}): CollapsibleState {
    const storageKey = options.storageKey;
    const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
    const [version, setVersion] = createSignal(0);
    let loaded = false;

    // Fold state is pure UI state — it deliberately does not live in the
    // persisted settings.json, so no Rust schema change is needed.
    //
    // It is read lazily on first access rather than on mount, so a state
    // created outside a component (the shared fallback below) works too.
    function load() {
        if (loaded || !storageKey) return;
        loaded = true;
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) setCollapsed(JSON.parse(raw));
        } catch {
            // A corrupt or unreadable entry just means "nothing folded".
        }
    }

    function persist(next: Record<string, boolean>) {
        if (!storageKey) return;
        try {
            localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
            // Private-mode browsers reject writes; folding still works
            // for the rest of the session.
        }
    }

    function apply(id: string, fold: boolean) {
        load();
        const next = { ...collapsed() };
        if (fold) next[id] = true;
        else delete next[id];
        setCollapsed(next);
        setVersion((v) => v + 1);
        persist(next);
    }

    return {
        isCollapsed: (id) => {
            load();
            return !!collapsed()[id];
        },
        toggleCollapsed: (id) => apply(id, !collapsed()[id]),
        expand: (id) => {
            if (!collapsed()[id]) return;
            apply(id, false);
        },
        version: () => version(),
    };
}

const CollapsibleContext = createContext<CollapsibleState>();

export function CollapsibleProvider(props: { value: CollapsibleState; children: JSX.Element }) {
    return <CollapsibleContext.Provider value={props.value}>{props.children}</CollapsibleContext.Provider>;
}

/**
 * Fallback for a surface with no provider of its own — a plugin panel
 * that renders its own disclosure, say. It is a real working state, so
 * those sections still fold and unfold; they just share one in-memory
 * state instead of a per-surface one, and are not persisted.
 */
let fallbackState: CollapsibleState | undefined;
function getFallbackState(): CollapsibleState {
    if (!fallbackState) fallbackState = createCollapsibleState();
    return fallbackState;
}

export function useCollapsible(): CollapsibleState {
    return useContext(CollapsibleContext) ?? getFallbackState();
}

export type CollapsibleSectionProps = {
    id: string;
    title: string;
    description?: string;
    children: JSX.Element;
};

/**
 * A collapsible card. The header is a real button so it is reachable by
 * keyboard and announced correctly, and the section's DOM id is the
 * anchor a caller jumps to.
 */
export function CollapsibleSection(props: CollapsibleSectionProps) {
    const ui = useCollapsible();
    const collapsed = () => ui.isCollapsed(props.id);

    return (
        <section
            class="ui-section"
            classList={{ "is-collapsed": collapsed() }}
            id={props.id}
        >
            <button
                type="button"
                class="ui-section-head"
                aria-expanded={!collapsed()}
                aria-controls={`${props.id}-body`}
                onClick={() => ui.toggleCollapsed(props.id)}
            >
                <span class="ui-section-chevron" aria-hidden="true">
                    <ChevronDownIcon />
                </span>
                <span class="ui-section-titles">
                    <span class="ui-section-title">{props.title}</span>
                    <Show when={props.description}>
                        <span class="ui-section-desc">{props.description}</span>
                    </Show>
                </span>
            </button>
            <div class="ui-section-body" id={`${props.id}-body`}>
                {props.children}
            </div>
        </section>
    );
}
