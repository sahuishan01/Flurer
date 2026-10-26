import { FolderIcon, GearIcon } from "./icons";
import { registeredPlugins, getOrderedPlugins } from "../lib/plugins";
import { For, Show, createMemo, createSignal } from "solid-js";

type ViewRailProps = {
  activeView: string;
  onSelectView: (view: string) => void;
  pluginOrder?: string[];
  onReorderPlugins?: (order: string[]) => void;
};

export function ViewRail(props: ViewRailProps) {
  let dragSession: { id: string; startY: number; moved: boolean } | null = null;
  let suppressNextClick = false;
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [dragOverId, setDragOverId] = createSignal<string | null>(null);

  const orderedPlugins = createMemo(() =>
    getOrderedPlugins(registeredPlugins(), props.pluginOrder)
  );

  function handlePointerDown(id: string, e: PointerEvent) {
    if (e.button !== 0) return;
    dragSession = { id, startY: e.clientY, moved: false };

    const onPointerMove = (ev: PointerEvent) => {
      if (!dragSession) return;
      if (!dragSession.moved) {
        if (Math.abs(ev.clientY - dragSession.startY) < 5) return;
        dragSession.moved = true;
        setDraggingId(id);
      }

      const hit = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-plugin-rail-id]") as HTMLElement | null;
      const targetId = hit?.dataset.pluginRailId;
      if (targetId && targetId !== id) {
        setDragOverId(targetId);
        const currentList = orderedPlugins().map((p) => p.id);
        const from = currentList.indexOf(id);
        const to = currentList.indexOf(targetId);
        if (from >= 0 && to >= 0 && from !== to) {
          const next = [...currentList];
          next.splice(to, 0, next.splice(from, 1)[0]);
          props.onReorderPlugins?.(next);
        }
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (dragSession?.moved) {
        suppressNextClick = true;
      }
      dragSession = null;
      setDraggingId(null);
      setDragOverId(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  return (
    <nav class="view-rail" aria-label="Views">
      <button
        type="button"
        class="view-rail-item"
        classList={{ active: props.activeView === "explorer" }}
        title="Explorer"
        aria-label="Explorer"
        onClick={() => props.onSelectView("explorer")}
      >
        <FolderIcon size={19} />
      </button>

      {/* Dynamically render plugin buttons with custom order & drag support */}
      <For each={orderedPlugins()}>
        {(plugin) => (
          <Show when={plugin.viewRailButton}>
            <div
              class="view-rail-plugin-slot"
              data-plugin-rail-id={plugin.id}
              classList={{
                dragging: draggingId() === plugin.id,
                "drag-over": dragOverId() === plugin.id,
              }}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onPointerDown={(e) => handlePointerDown(plugin.id, e)}
              ref={(el) => {
                el.addEventListener(
                  "click",
                  (e) => {
                    if (suppressNextClick) {
                      e.stopPropagation();
                      e.preventDefault();
                      suppressNextClick = false;
                    }
                  },
                  true,
                );
              }}
            >
              {plugin.viewRailButton!({
                active: props.activeView === plugin.id,
                onClick: () => {
                  if (suppressNextClick) {
                    suppressNextClick = false;
                    return;
                  }
                  props.onSelectView(plugin.id);
                },
              })}
            </div>
          </Show>
        )}
      </For>

      <div class="view-rail-spacer" />

      <button
        type="button"
        class="view-rail-item"
        classList={{ active: props.activeView === "settings" }}
        title="Settings"
        aria-label="Settings"
        onClick={() => props.onSelectView("settings")}
      >
        <GearIcon size={19} />
      </button>
    </nav>
  );
}
