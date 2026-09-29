import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";

export type CommandPaletteItem = {
  id: string;
  label: string;
  category: string;
  keywords?: string;
  shortcut?: string;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  commands: CommandPaletteItem[];
};

// Subsequence fuzzy match with a light score: consecutive and
// word-start matches rank above scattered ones, shorter labels win ties.
function fuzzyScore(query: string, text: string): number {
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

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;
  let listEl: HTMLDivElement | undefined;

  const results = createMemo(() => {
    const q = query().trim();
    const scored = props.commands
      .map((cmd) => ({ cmd, score: Math.max(fuzzyScore(q, cmd.label), fuzzyScore(q, `${cmd.category} ${cmd.label}`) - 50) }))
      .filter((r) => r.score >= 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.map((r) => r.cmd);
  });

  // Reset query/selection each time the palette opens and focus its input.
  createEffect(() => {
    if (!props.open) return;
    setQuery("");
    setSelected(0);
    queueMicrotask(() => inputEl?.focus());
  });

  // Keep the keyboard-selected row visible without scrolling the panel
  // container itself.
  createEffect(() => {
    const index = selected();
    const items = results();
    if (!listEl || index < 0 || index >= items.length) return;
    listEl.querySelector<HTMLElement>(".command-palette-item.selected")?.scrollIntoView({ block: "nearest" });
  });

  function handleInputKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, results().length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results()[selected()];
      if (cmd) {
        props.onClose();
        cmd.run();
      }
    }
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-backdrop command-palette-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) props.onClose();
          }}
        >
          <div class="command-palette-panel" role="dialog" aria-modal="true" aria-label="Command palette">
            <input
              ref={inputEl}
              class="command-palette-input"
              type="text"
              placeholder="Type a command…"
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setSelected(0);
              }}
              onKeyDown={handleInputKeyDown}
              spellcheck={false}
              autoComplete="off"
            />
            <div class="command-palette-list" ref={listEl} role="listbox">
              <Show
                when={results().length > 0}
                fallback={<div class="command-palette-empty">No matching commands</div>}
              >
                <For each={results()}>
                  {(cmd, i) => (
                    <div
                      class="command-palette-item"
                      classList={{ selected: i() === selected() }}
                      role="option"
                      aria-selected={i() === selected()}
                      onMouseEnter={() => setSelected(i())}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        props.onClose();
                        cmd.run();
                      }}
                    >
                      <span class="command-palette-item-label">{cmd.label}</span>
                      <Show when={cmd.shortcut}>
                        <kbd class="command-palette-item-shortcut">{cmd.shortcut}</kbd>
                      </Show>
                      <span class="command-palette-item-category">{cmd.category}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
            <div class="command-palette-footer">
              <span>↑↓ navigate</span>
              <span>↵ run</span>
              <span>Esc close</span>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
