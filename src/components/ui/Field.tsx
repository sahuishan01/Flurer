import type { JSX } from "solid-js";

// Shared UI kit — the two-column field row.
//
// A label (with an optional explanation) on the left, a control on the
// right. Scalars (sliders, selects, checkboxes, numbers) use this; choice
// sets (option groups, swatch rows, image grids) set `fullWidth` and put
// the control on its own line beneath the label.
//
// These started life as settings-only primitives but nothing about them is
// settings-specific — a modal or a plugin panel can use the same row.

export type FieldRowProps = {
    /** DOM id, so a caller can scroll to and highlight this exact control. */
    id?: string;
    label: string;
    description?: string;
    /** Force the control onto its own line below the label (choice sets). */
    fullWidth?: boolean;
    children: JSX.Element;
};

/**
 * One field: a label and explanation on the left, a control on the right.
 */
export function FieldRow(props: FieldRowProps) {
    return (
        <div
            class="ui-field-row"
            classList={{ "ui-field-row-full": !!props.fullWidth }}
            id={props.id}
        >
            <div class="ui-field-row-text">
                <span class="ui-field-row-label">{props.label}</span>
                {props.description && <span class="ui-field-row-desc">{props.description}</span>}
            </div>
            <div class="ui-field-row-control">{props.children}</div>
        </div>
    );
}

/** Vertical stack of field rows. */
export function FieldGroup(props: { children: JSX.Element; class?: string }) {
    return <div class={`ui-field-group${props.class ? ` ${props.class}` : ""}`}>{props.children}</div>;
}
