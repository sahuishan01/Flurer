import { JSX, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: JSX.Element;
};

export function Modal(props: ModalProps) {
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose();
  }

  onMount(() => document.addEventListener("keydown", handleKeyDown));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  return (
    // See ContextMenu.tsx for why this is portaled to document.body rather
    // than rendered in place — the same backdrop-filter/position:fixed
    // interaction applies here.
    <Portal>
      <div
        class="modal-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div class="modal-panel">
          <div class="modal-header">
            <h3>{props.title}</h3>
          </div>
          <div class="modal-body">{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}
