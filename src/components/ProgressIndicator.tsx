import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { ActivityIcon } from "./icons";

type OperationProgress = {
  taskId: number;
  label: string;
  done: number;
  total: number;
  finished: boolean;
  error: string | null;
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
  const [tasks, setTasks] = createSignal<Map<number, OperationProgress>>(new Map());
  const [open, setOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    let unlisten: (() => void) | undefined;
    listen<OperationProgress>("operation-progress", (event) => {
      const task = event.payload;
      setTasks((prev) => new Map(prev).set(task.taskId, task));
      if (task.finished) {
        setTimeout(() => {
          setTasks((prev) => {
            if (!prev.has(task.taskId)) return prev;
            const next = new Map(prev);
            next.delete(task.taskId);
            return next;
          });
        }, FADE_DELAY_MS);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    onCleanup(() => unlisten?.());
  });

  function handlePointerDown(e: MouseEvent) {
    if (ref && !ref.contains(e.target as Node)) setOpen(false);
  }
  onMount(() => document.addEventListener("mousedown", handlePointerDown));
  onCleanup(() => document.removeEventListener("mousedown", handlePointerDown));

  const list = () => [...tasks().values()].sort((a, b) => b.taskId - a.taskId);
  const activeCount = () => list().filter((t) => !t.finished).length;

  return (
    <Show when={tasks().size > 0}>
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
                      {task.finished ? (task.error ? "Failed" : "Done") : `${percent(task)}%`}
                    </span>
                  </div>
                  <div class="progress-bar">
                    <div
                      class="progress-bar-fill"
                      classList={{ error: !!task.error }}
                      style={{ width: `${percent(task)}%` }}
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
