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
    /**
     * The row shows a value rather than a control — a properties list,
     * say. The value is the flexible column, so a long path truncates
     * with an ellipsis instead of stretching the row.
     */
    readOnly?: boolean;
    children: JSX.Element;
};

/**
 * One field: a label and explanation on the left, a control on the right.
 */
export function FieldRow(props: FieldRowProps) {
    return (
        <div
            class="ui-field-row"
            classList={{
                "ui-field-row-full": !!props.fullWidth,
                "ui-field-row-readonly": !!props.readOnly,
            }}
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

/**
 * A value in a read-only row. Truncates with an ellipsis rather than
 * wrapping, so a long path stays on one line.
 */
export function FieldValue(props: { children: JSX.Element; title?: string; class?: string }) {
    return (
        <span class={`ui-field-value${props.class ? ` ${props.class}` : ""}`} title={props.title}>
            {props.children}
        </span>
    );
}

/** Vertical stack of field rows. */
export function FieldGroup(props: { children: JSX.Element; class?: string; readOnly?: boolean }) {
    return (
        <div
            class={`ui-field-group${props.readOnly ? " ui-field-group-readonly" : ""}${props.class ? ` ${props.class}` : ""}`}
        >
            {props.children}
        </div>
    );
}
