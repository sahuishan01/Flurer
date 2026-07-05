import { For, onCleanup, onMount } from "solid-js";

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
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
    <div ref={ref} class="context-menu" style={{ left: `${props.x}px`, top: `${props.y}px` }}>
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
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
}
