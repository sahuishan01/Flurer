import { For, onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

export type ContextMenuItem = {
  label: string;
  icon?: JSX.Element;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
  // Opt-in only — a plain right-click menu (e.g. in the file list) should
  // stay open until an explicit click-away/Escape/selection, matching normal
  // OS context-menu behavior. Callers that want hover-to-dismiss (the graph's
  // node menu) pass these; others just leave them out.
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

export function ContextMenu(props: ContextMenuProps) {
  let ref: HTMLDivElement | undefined;

  function handlePointerDown(e: MouseEvent) {
    if (ref && !ref.contains(e.target as Node)) props.onDismiss();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") props.onDismiss();
  }

  onMount(() => {
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handlePointerDown);
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    // Rendered into document.body rather than in place: a position:fixed
    // element nested inside any backdrop-filter (or transform/filter)
    // ancestor gets positioned relative to that ancestor's box instead of
    // the viewport, landing away from the cursor. Portaling here means no
    // caller has to know about or work around that — it can't recur.
    <Portal>
      <div
        ref={ref}
        class="context-menu"
        style={{ left: `${props.x}px`, top: `${props.y}px` }}
        onMouseEnter={() => props.onMouseEnter?.()}
        onMouseLeave={() => props.onMouseLeave?.()}
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              class="context-menu-item"
              classList={{ danger: item.danger }}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                props.onDismiss();
              }}
            >
              {item.icon && <span class="context-menu-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          )}
        </For>
      </div>
    </Portal>
  );
}
