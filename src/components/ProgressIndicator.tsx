import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
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

export function ProgressIndicator() {
  // A keyed store, not a signal-wrapped Map — updating an existing task's
  // fields patches that entry's own object in place instead of replacing
  // it wholesale. <For> below tracks rows by reference; handing it a fresh
  // object for the same task on every progress tick would tear down and
  // rebuild that row's DOM every time (defeating the intended smooth
  // progress-bar transition) instead of just updating its width.
  const [tasks, setTasks] = createStore<Record<number, OperationProgress>>({});
  const [open, setOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;

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
        setTimeout(() => {
          if (tasks[task.taskId]?.finished) {
            setTasks(produce((all) => delete all[task.taskId]));
          }
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
    <Show when={list().length > 0}>
      <div class="progress-indicator" ref={ref}>
        <button
          type="button"
          class="icon-btn"
          title="Ongoing operations"
          aria-label="Ongoing operations"
          onClick={() => setOpen((v) => !v)}
        >
          <ActivityIcon size={16} />
          <Show when={activeCount() > 0}>
            <span class="progress-badge">{activeCount()}</span>
          </Show>
        </button>

        <Show when={open()}>
          <div class="progress-panel">
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
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
