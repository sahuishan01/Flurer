import { JSX, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { CloseIcon } from "./icons";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: JSX.Element;
};

export function Modal(props: ModalProps) {
  let panelRef: HTMLDivElement | undefined;
  let previousActiveElement: HTMLElement | null = null;

  const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusableElements(): HTMLElement[] {
    if (!panelRef) return [];
    return Array.from(panelRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null || el.getClientRects().length > 0,
    );
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.onClose();
      return;
    }

    if (e.key === "Tab") {
      const focusables = getFocusableElements();
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !panelRef?.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !panelRef?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  onMount(() => {
    previousActiveElement = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeyDown);

    // Autofocus inside modal
    queueMicrotask(() => {
      const focusables = getFocusableElements();
      if (focusables.length > 0) {
        // Focus first non-close button if possible, otherwise first focusable
        const preferred = focusables.find((el) => !el.classList.contains("modal-close-btn")) ?? focusables[0];
        preferred.focus();
      } else {
        panelRef?.focus();
      }
    });
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    if (previousActiveElement && typeof previousActiveElement.focus === "function") {
      queueMicrotask(() => previousActiveElement?.focus());
    }
  });

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
        <div class="modal-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={props.title}>
          <div class="modal-header">
            <h3>{props.title}</h3>
            <button
              type="button"
              class="icon-btn modal-close-btn"
              aria-label="Close"
              title="Close (Escape)"
              onClick={props.onClose}
            >
              <CloseIcon size={14} />
            </button>
          </div>
          <div class="modal-body">{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}
