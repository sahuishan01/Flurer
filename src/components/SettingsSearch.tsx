import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { SearchIcon } from "./icons";
import { matchScore } from "../lib/fuzzy";
import type { SettingsItemDef, SettingsSectionDef } from "../lib/settingsRegistry";

export type SettingsSearchHit = {
    item: SettingsItemDef;
    section: SettingsSectionDef;
    category: { id: string; label: string };
    score: number;
};

export type SettingsSearchProps = {
    /** The categories shown in the nav rail — only id and label are used here. */
    categories: { id: string; label: string }[];
    /** Visible sections across all categories — the search index. */
    sections: SettingsSectionDef[];
    onJump: (hit: SettingsSearchHit) => void;
};

/**
 * Cross-category search over every individual setting.
 *
 * It navigates rather than filters: typing never hides anything on the
 * page, it produces a ranked list of the settings that match, and
 * picking one takes you straight to it. The old behaviour (the panel
 * reusing the global file-search query and hiding every section that
 * didn't match) made the page quietly lose content, which is a worse
 * answer to "where is that setting?" than jumping to it.
 */
/**
 * Rank tiers. A hit on a setting's own name always beats a hit on a
 * keyword, which beats a hit on a section title.
 *
 * The tiers exist because a single fuzzy score can't order them: a
 * keyword hit scores close to a perfect label hit, so without tiers a
 * keyword match would outrank the setting you actually typed.
 */
const TIER_ITEM_LABEL = 10000;
const TIER_SECTION_LABEL = 9000;
const TIER_ITEM_KEYWORD = 8000;
const TIER_CATEGORY_LABEL = 6000;

/**
 * Best score for a keyword list. Each keyword is scored on its own —
 * scoring the whole list as one string lets a query scatter across
 * unrelated words ("blur" matches "rebuild" that way), which is how the
 * search ends up offering settings that have nothing to do with it.
 */
function scoreKeywords(query: string, keywords: string[]): number {
    let best = -1;
    for (const keyword of keywords) {
        const score = matchScore(query, keyword);
        if (score > best) best = score;
    }
    return best;
}

export function SettingsSearch(props: SettingsSearchProps) {
    const [query, setQuery] = createSignal("");
    const [open, setOpen] = createSignal(false);
    const [selected, setSelected] = createSignal(0);
    let inputEl: HTMLInputElement | undefined;

    const hits = createMemo<SettingsSearchHit[]>(() => {
        const q = query().trim();
        if (!q) return [];

        const categoryById = new Map(props.categories.map((c) => [c.id, c]));
        const scored: SettingsSearchHit[] = [];

        for (const section of props.sections) {
            const category = categoryById.get(section.category);
            if (!category) continue;

            // The section title itself is a legitimate target ("wallpaper"
            // should find the Wallpaper section even if no single control
            // is named that). But when a control carries the same name as
            // its section ("Theme" / "Theme"), listing both is just noise.
            const shadowedByItem = section.items.some(
                (item) => item.label.trim().toLowerCase() === section.label.trim().toLowerCase(),
            );
            if (!shadowedByItem) {
                const sectionScore = matchScore(q, section.label);
                if (sectionScore >= 0) {
                    scored.push({
                        item: { id: section.id, label: section.label, keywords: [] },
                        section,
                        category,
                        score: TIER_SECTION_LABEL + sectionScore,
                    });
                }
            }

            for (const item of section.items) {
                const labelScore = matchScore(q, item.label);
                if (labelScore >= 0) {
                    scored.push({ item, section, category, score: TIER_ITEM_LABEL + labelScore });
                    continue;
                }
                const keywordScore = scoreKeywords(q, item.keywords);
                if (keywordScore >= 0) {
                    scored.push({ item, section, category, score: TIER_ITEM_KEYWORD + keywordScore });
                }
            }
        }

        // A category name on its own ("plugins") is worth a hit too, so
        // the category can be jumped to directly.
        for (const category of props.categories) {
            const categoryScore = matchScore(q, category.label);
            if (categoryScore < 0) continue;
            const firstSection = props.sections.find((s) => s.category === category.id);
            if (!firstSection) continue;
            scored.push({
                item: { id: firstSection.id, label: category.label, keywords: [] },
                section: firstSection,
                category,
                score: TIER_CATEGORY_LABEL + categoryScore,
            });
        }

        scored.sort((a, b) => b.score - a.score);

        // One hit per setting — the section-level hit and an item that
        // lives inside that same section shouldn't both show up when they
        // resolve to the same anchor.
        const seen = new Set<string>();
        return scored.filter((hit) => {
            const key = `${hit.section.id}:${hit.item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    });

    const grouped = createMemo(() => {
        const groups: { category: { id: string; label: string }; hits: SettingsSearchHit[] }[] = [];
        for (const hit of hits()) {
            const last = groups[groups.length - 1];
            if (last && last.category.id === hit.category.id) last.hits.push(hit);
            else groups.push({ category: hit.category, hits: [hit] });
        }
        return groups;
    });

    // Flat order of the hits, matching what the user sees, so arrow-key
    // navigation moves through the grouped list in reading order.
    const flatHits = createMemo(() => grouped().flatMap((g) => g.hits));

    function commit(hit: SettingsSearchHit | undefined) {
        if (!hit) return;
        props.onJump(hit);
        setOpen(false);
        setQuery("");
        inputEl?.blur();
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            if (query()) {
                setQuery("");
                setSelected(0);
            } else {
                setOpen(false);
                inputEl?.blur();
            }
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open()) setOpen(true);
            setSelected((i) => Math.min(i + 1, Math.max(flatHits().length - 1, 0)));
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((i) => Math.max(i - 1, 0));
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            commit(flatHits()[selected()]);
        }
    }

    onCleanup(() => {
        inputEl = undefined;
    });

    return (
        <div class="settings-search">
            <div class="settings-search-field">
                <span class="settings-search-icon" aria-hidden="true">
                    <SearchIcon />
                </span>
                <input
                    ref={inputEl}
                    class="settings-search-input"
                    type="text"
                    placeholder="Search settings…"
                    value={query()}
                    spellcheck={false}
                    autocomplete="off"
                    aria-label="Search settings"
                    onInput={(e) => {
                        setQuery(e.currentTarget.value);
                        setSelected(0);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={handleKeyDown}
                />
                <Show when={!query()}>
                    <kbd class="settings-search-kbd">Ctrl+F</kbd>
                </Show>
            </div>

            <Show when={open() && query().trim().length > 0}>
                <div class="settings-search-results" role="listbox" aria-label="Search results">
                    <Show
                        when={flatHits().length > 0}
                        fallback={<div class="settings-search-empty">No matching settings</div>}
                    >
                        <For each={grouped()}>
                            {(group) => (
                                <div class="settings-search-group">
                                    <div class="settings-search-group-label">{group.category.label}</div>
                                    <For each={group.hits}>
                                        {(hit) => {
                                            const index = () => flatHits().indexOf(hit);
                                            return (
                                                <button
                                                    type="button"
                                                    class="settings-search-hit"
                                                    classList={{ selected: index() === selected() }}
                                                    role="option"
                                                    aria-selected={index() === selected()}
                                                    onMouseEnter={() => setSelected(index())}
                                                    onClick={() => commit(hit)}
                                                >
                                                    <span class="settings-search-hit-label">{hit.item.label}</span>
                                                    <span class="settings-search-hit-path">{hit.section.label}</span>
                                                </button>
                                            );
                                        }}
                                    </For>
                                </div>
                            )}
                        </For>
                    </Show>
                </div>
            </Show>
        </div>
    );
}
