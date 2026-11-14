import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { CheckIcon, ChevronDownIcon } from "./icons";

export type ThemedSelectOption = {
  value: string;
  label: string;
};

type ThemedSelectProps = {
  value: string;
  options: ThemedSelectOption[];
  onChange: (value: string) => void;
  class?: string;
  title?: string;
  ariaLabel?: string;
  compact?: boolean;
  disabled?: boolean;
};

// Native <select> popups are drawn by the OS/webview, not by our CSS: on
// Linux/WebKitGTK they ignore the option background and can come up white
// while the app's text token is white, making every item invisible. This is
// a small, keyboard-accessible listbox that stays inside the themed DOM and
// therefore always uses --option-bg/--option-color and the active theme.
export function ThemedSelect(props: ThemedSelectProps) {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 0, y: 0, width: 0 });
  const [activeIndex, setActiveIndex] = createSignal(0);
  let triggerRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const current = createMemo(
    () => props.options.find((option) => option.value === props.value) ?? props.options[0],
  );
  const selectedIndex = createMemo(() => {
    const index = props.options.findIndex((option) => option.value === props.value);
    return index < 0 ? 0 : index;
  });

  function positionAtTrigger() {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom + 4, width: rect.width });
  }

  function clampToViewport() {
    if (!menuRef) return;
    const rect = menuRef.getBoundingClientRect();
    const margin = 4;
    let { x, y } = pos();
    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos((previous) => ({ ...previous, x, y }));
  }

  function openMenu() {
    if (props.disabled) return;
    positionAtTrigger();
    setActiveIndex(selectedIndex());
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
  }

  function choose(value: string) {
    closeMenu();
    if (value !== props.value) props.onChange(value);
    triggerRef?.focus();
  }

  function focusOption(index: number) {
    const options = menuRef?.querySelectorAll<HTMLButtonElement>(".themed-select-option");
    if (!options || options.length === 0) return;
    const next = Math.min(Math.max(index, 0), options.length - 1);
    setActiveIndex(next);
    options[next]?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (props.disabled) return;
    if (!open() && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openMenu();
      queueMicrotask(() => focusOption(selectedIndex()));
    }
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      triggerRef?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      focusOption(activeIndex() + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      focusOption(activeIndex() - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      focusOption(props.options.length - 1);
    }
  }

  // Position after the portaled menu exists, then clamp so it never opens
  // off-screen. Focus the current item so arrow keys work immediately.
  createEffect(() => {
    if (!open() || !menuRef) return;
    positionAtTrigger();
    clampToViewport();
    queueMicrotask(() => focusOption(activeIndex()));
  });

  function onOutsidePointerDown(event: MouseEvent) {
    if (!open()) return;
    const target = event.target as Node;
    if (menuRef?.contains(target) || triggerRef?.contains(target)) return;
    closeMenu();
  }

  onMount(() => {
    document.addEventListener("mousedown", onOutsidePointerDown);
    onCleanup(() => document.removeEventListener("mousedown", onOutsidePointerDown));
  });

  return (
    <div class={`themed-select${props.compact ? " compact" : ""}${props.class ? ` ${props.class}` : ""}`}>
      <button
        type="button"
        ref={triggerRef}
        class="themed-select-trigger"
        title={props.title}
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open()}
        disabled={props.disabled}
        onClick={() => (open() ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span class="themed-select-value">{current()?.label ?? ""}</span>
        <ChevronDownIcon size={12} />
      </button>

      <Portal>
        <Show when={open()}>
          <div
            ref={menuRef}
            class="themed-select-menu"
            role="listbox"
            aria-label={props.ariaLabel}
            style={{
              left: `${pos().x}px`,
              top: `${pos().y}px`,
              "min-width": `${pos().width}px`,
            }}
            onKeyDown={onMenuKeyDown}
          >
            <For each={props.options}>
              {(option, index) => (
                <button
                  type="button"
                  class="themed-select-option"
                  classList={{
                    selected: option.value === props.value,
                    active: index() === activeIndex(),
                  }}
                  role="option"
                  aria-selected={option.value === props.value}
                  onClick={() => choose(option.value)}
                  onFocus={() => setActiveIndex(index())}
                >
                  <span>{option.label}</span>
                  <Show when={option.value === props.value}>
                    <CheckIcon size={13} />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Portal>
    </div>
  );
}
