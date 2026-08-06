import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ActivityIcon } from "./icons";

type OperationProgress = {
  taskId: number;
  label: string;
  done: number;
  total: number;
  finished: boolean;
  error: string | null;
  // True for work with no meaningful done/total count (e.g. a recursive
  // folder-size walk) — rendered as a running indicator instead of a
  // percent-complete bar.
  indeterminate: boolean;
};

// How long a finished task (success or failure) stays visible in the list
// before it's dropped, so completing an operation doesn't just vanish
// instantly but also doesn't linger forever.
const FADE_DELAY_MS = 4000;

function percent(task: OperationProgress): number {
  if (task.total <= 0) return 100;
  return Math.min(100, Math.round((task.done / task.total) * 100));
}

type ProgressIndicatorProps = {
  showWhenIdle?: boolean;
};

export function ProgressIndicator(props: ProgressIndicatorProps) {
  // A keyed store, not a signal-wrapped Map — updating an existing task's
  // fields patches that entry's own object in place instead of replacing
  // it wholesale. <For> below tracks rows by reference; handing it a fresh
  // object for the same task on every progress tick would tear down and
  // rebuild that row's DOM every time (defeating the intended smooth
  // progress-bar transition) instead of just updating its width.
  const [tasks, setTasks] = createStore<Record<number, OperationProgress>>({});
  const [open, setOpen] = createSignal(false);
  const [panelPos, setPanelPos] = createSignal<Record<string, string>>({});
  let ref: HTMLDivElement | undefined;
  let anchorRect: DOMRect | undefined;

  // Positions the panel against the toggle button's rect, then clamps it
  // to the viewport — the button can end up anywhere (it wraps to a new
  // row on narrow windows, sometimes hugging the left edge), so a naive
  // right-anchored offset can push the fixed-width panel off-screen.
  function positionPanel(panelEl: HTMLDivElement) {
    if (!anchorRect) return;
    const margin = 8;
    const rect = panelEl.getBoundingClientRect();
    const width = rect.width || panelEl.offsetWidth;
    const height = rect.height || panelEl.offsetHeight;

    let left = anchorRect.right - width;
    left = Math.min(left, window.innerWidth - width - margin);
    left = Math.max(left, margin);

    let top = anchorRect.bottom + 6;
    if (top + height > window.innerHeight - margin) {
      top = anchorRect.top - height - 6;
    }
    top = Math.min(top, window.innerHeight - height - margin);
    top = Math.max(top, margin);

    setPanelPos({ top: `${top}px`, left: `${left}px` });
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    // If the component is disposed before listen()'s promise resolves,
    // onCleanup below runs while `unlisten` is still undefined and can't
    // call it. Tracking that here lets the .then() callback notice and
    // clean up immediately instead of leaking the listener.
    let disposed = false;
    listen<OperationProgress>("operation-progress", (event) => {
      const task = event.payload;
      setTasks(task.taskId, task);
      if (task.finished) {
        const id = task.taskId;
        setTimeout(() => {
          setTasks(produce((all) => { if (all[id]?.finished) delete all[id]; }));
        }, FADE_DELAY_MS);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
  });

  function handlePointerDown(e: MouseEvent) {
    if (ref && !ref.contains(e.target as Node)) setOpen(false);
  }
  onMount(() => document.addEventListener("mousedown", handlePointerDown));
  onCleanup(() => document.removeEventListener("mousedown", handlePointerDown));

  const list = () => Object.values(tasks).sort((a, b) => b.taskId - a.taskId);
  const activeCount = () => list().filter((t) => !t.finished).length;

  return (
    <Show when={props.showWhenIdle || list().length > 0}>
      <div class="progress-indicator" ref={ref}>
        <button
          type="button"
          class="icon-btn"
          title="Ongoing operations"
          aria-label="Ongoing operations"
          onClick={() => {
            const next = !open();
            if (next && ref) {
              anchorRect = ref.getBoundingClientRect();
              // Provisional position (pre-measurement) so nothing flashes at
              // the origin for a frame; positionPanel() below corrects it
              // against the panel's real, rendered size once it mounts.
              setPanelPos({
                top: `${anchorRect.bottom + 6}px`,
                left: `${Math.max(8, anchorRect.right - 260)}px`,
              });
            }
            setOpen(next);
          }}
        >
          <ActivityIcon size={16} />
          <Show when={activeCount() > 0}>
            <span class="progress-badge">{activeCount()}</span>
          </Show>
        </button>

        <Show when={open()}>
          <div
            class="progress-panel"
            style={panelPos()}
            ref={(el) => {
              positionPanel(el);
              const onResize = () => {
                // The toggle button itself may have reflowed (e.g. wrapped
                // to a new row) along with the window, so re-anchor first.
                if (ref) anchorRect = ref.getBoundingClientRect();
                positionPanel(el);
              };
              window.addEventListener("resize", onResize);
              onCleanup(() => window.removeEventListener("resize", onResize));
            }}
          >
            <For each={list()}>
              {(task) => (
                <div class="progress-task">
                  <div class="progress-task-header">
                    <span class="progress-task-label">{task.label}</span>
                    <span class="progress-task-percent">
                      {task.finished
                        ? task.error
                          ? "Failed"
                          : "Done"
                        : task.indeterminate
                          ? "Working…"
                          : `${percent(task)}%`}
                    </span>
                  </div>
                  <div class="progress-bar">
                    <div
                      class="progress-bar-fill"
                      classList={{ error: !!task.error, indeterminate: !task.finished && task.indeterminate }}
                      style={task.indeterminate ? undefined : { width: `${percent(task)}%` }}
                    />
                  </div>
                  <Show when={task.error}>
                    <span class="progress-task-error">{task.error}</span>
                  </Show>
                  <Show when={!task.finished}>
                    <div class="progress-task-actions">
                      <button
                        type="button"
                        class="progress-task-cancel"
                        onClick={() => invoke("cancel_operation", { taskId: task.taskId })}
                      >
                        Cancel
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
