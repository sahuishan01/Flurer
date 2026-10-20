// Subsequence fuzzy match with a light score: consecutive and
// word-start matches rank above scattered ones, shorter labels win ties.
// Shared by the command palette and the in-settings search so both rank
// the same way.
export function fuzzyScore(query: string, text: string): number {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    const direct = t.indexOf(q);
    if (direct >= 0) {
        return 1000 - direct - text.length * 0.05;
    }
    let score = 0;
    let ti = 0;
    let streak = 0;
    for (let qi = 0; qi < q.length; qi++) {
        const ch = q[qi];
        const found = t.indexOf(ch, ti);
        if (found < 0) return -1;
        streak = found === ti ? streak + 1 : 1;
        score += 10 + streak * 2 + (found === 0 || /[\s\\/\-_]/.test(t[found - 1]) ? 8 : 0);
        ti = found + 1;
    }
    return score - text.length * 0.05;
}

/**
 * Stricter match for user-facing search over long labels.
 *
 * A label matches when the query is a substring of it, a substring of
 * one of its words, or a subsequence of it whose matched characters sit
 * close together.
 *
 * The proximity rule is the important part. A plain subsequence match
 * will happily say "blur" matches "Global hotkey to open Flurer" —
 * every letter is there, but they are twenty characters apart, and that
 * is an accident of spelling rather than something the user meant.
 */
export function matchScore(query: string, text: string): number {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (!q) return 1;

    const direct = t.indexOf(q);
    if (direct >= 0) return 1000 - direct - t.length * 0.05;

    // A whole word inside the label: "tint" in "Panel tint".
    for (const word of t.split(/[^a-z0-9]+/)) {
        if (!word) continue;
        const idx = word.indexOf(q);
        if (idx >= 0) return 800 - idx * 0.05 - word.length * 0.05;
    }

    // A one- or two-letter query can't be matched by proximity — there
    // isn't enough of it to say anything about intent.
    if (q.length < 3) return -1;

    let ti = 0;
    let first = -1;
    let last = -1;
    let streak = 0;
    let score = 0;
    for (let qi = 0; qi < q.length; qi++) {
        const ch = q[qi];
        const found = t.indexOf(ch, ti);
        if (found < 0) return -1;
        if (first < 0) first = found;
        streak = found === ti ? streak + 1 : 1;
        score += 10 + streak * 2 + (found === 0 || /[\s\\/\-_]/.test(t[found - 1]) ? 8 : 0);
        last = found;
        ti = found + 1;
    }

    // Too much space between the first and last matched character means
    // the query scattered across unrelated words.
    if (last - first + 1 > q.length * 2 + 2) return -1;

    return score - text.length * 0.05;
}
