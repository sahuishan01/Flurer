import { createSignal, createMemo, Index, Show, onMount } from "solid-js";
import { useGit } from "../context";
import { formatTimestamp, surfaceBg } from "../utils";
import type { GitGraphEntry } from "../types";
import { EmptyState, Card, Button, CloseIcon, CommitContextMenu } from "./shared";
import { S } from "../styles";

const LANE_W = 16;
const ROW_H = 34;
const DOT_R = 4.5;
const COLORS = ["#f59e0b", "#60a5fa", "#4ade80", "#f87171", "#c084fc", "#2dd4bf", "#fb923c", "#a78bfa"];

interface GraphRow extends GitGraphEntry {
  lane: number;
}

interface GraphEdge {
  fromRow: number;
  fromLane: number;
  viaLane: number;
  toHash: string;
  toRow: number | null;
  toLane: number | null;
  isMergeBranch: boolean;
  parentIndex: number;
}

interface GraphData {
  rows: GraphRow[];
  edges: GraphEdge[];
  laneCount: number;
}

function buildGraph(entries: GitGraphEntry[]): GraphData {
  const lanes: (string | null)[] = [];
  const hashRow = new Map<string, number>();
  entries.forEach((e, i) => hashRow.set(e.hash, i));

  const rows: GraphRow[] = [];
  const edges: GraphEdge[] = [];

  const compactLanes = () => {
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
  };

  const allocLane = (hash: string): number => {
    const existing = lanes.indexOf(hash);
    if (existing !== -1) return existing;
    const free = lanes.indexOf(null);
    if (free !== -1) {
      lanes[free] = hash;
      return free;
    }
    lanes.push(hash);
    return lanes.length - 1;
  };

  entries.forEach((e, i) => {
    const expecting: number[] = [];
    lanes.forEach((h, li) => {
      if (h === e.hash) expecting.push(li);
    });

    let lane: number;
    if (expecting.length > 0) {
      lane = expecting[0];
      for (let k = 1; k < expecting.length; k++) lanes[expecting[k]] = null;
      compactLanes();
    } else {
      lane = allocLane(e.hash);
    }

    rows.push({ ...e, lane });

    if (e.parents.length === 0) {
      lanes[lane] = null;
      compactLanes();
      return;
    }

    const p1 = e.parents[0];
    const existingP1 = lanes.indexOf(p1);
    if (existingP1 !== -1 && existingP1 !== lane) {
      lanes[lane] = null;
      compactLanes();
    } else {
      lanes[lane] = p1;
    }
    edges.push({ fromRow: i, fromLane: lane, viaLane: lane, toHash: e.parents[0], toRow: null, toLane: null, isMergeBranch: false, parentIndex: 0 });

    for (let k = 1; k < e.parents.length; k++) {
      const via = allocLane(e.parents[k]);
      edges.push({ fromRow: i, fromLane: lane, viaLane: via, toHash: e.parents[k], toRow: null, toLane: null, isMergeBranch: true, parentIndex: k });
    }
  });

  let laneCount = 1;
  for (const r of rows) laneCount = Math.max(laneCount, r.lane + 1);
  for (const e of edges) {
    laneCount = Math.max(laneCount, e.viaLane + 1);
    const toRow = hashRow.get(e.toHash);
    if (toRow !== undefined) {
      e.toRow = toRow;
      e.toLane = rows[toRow].lane;
    }
  }

  return { rows, edges, laneCount };
}

export function GraphView() {
  const ctx = useGit();
  const [selectedHash, setSelectedHash] = createSignal<string | null>(null);
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number; hash: string } | null>(null);

  onMount(() => {
    if (ctx.graph().length === 0) ctx.loadGraph();
  });

  const data = createMemo(() => buildGraph(ctx.graph()));

  const rowMaxLanes = createMemo(() => {
    const gData = data();
    const maxLanes = new Array(gData.rows.length).fill(0);

    gData.rows.forEach((r, i) => {
      maxLanes[i] = Math.max(maxLanes[i], r.lane);
    });

    gData.edges.forEach((e) => {
      const start = e.fromRow;
      const end = e.toRow !== null ? e.toRow : gData.rows.length - 1;
      for (let r = start; r <= end; r++) {
        if (r < maxLanes.length) {
          maxLanes[r] = Math.max(maxLanes[r], e.viaLane, e.fromLane);
          if (e.toLane !== null && r === end) {
            maxLanes[r] = Math.max(maxLanes[r], e.toLane);
          }
        }
      }
    });

    return maxLanes;
  });

  const laneX = (l: number) => l * LANE_W + LANE_W / 2;
  const rowY = (r: number) => r * ROW_H + ROW_H / 2;
  const laneColor = (l: number) => COLORS[l % COLORS.length];
  const graphW = () => data().laneCount * LANE_W + 8;
  const svgH = () => data().rows.length * ROW_H + 20;
  const bottomY = () => data().rows.length * ROW_H;

  function handleScroll(e: Event) {
    const el = e.currentTarget as HTMLDivElement;
    if (!el || ctx.graphLoading() || !ctx.graphHasMore()) return;
    if (el.scrollTop > 50 && el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      ctx.loadMoreGraph();
    }
  }

  function handleRowClick(hash: string) {
    setSelectedHash(hash);
    ctx.showCommitDetail(hash);
  }

  function handleContextMenu(e: MouseEvent, hash: string) {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY, hash });
  }

  const edgePoints = (e: GraphEdge): string => {
    const x1 = laneX(e.fromLane);
    const y1 = rowY(e.fromRow);
    const vx = laneX(e.viaLane);
    const y2 = e.toRow !== null ? rowY(e.toRow) : bottomY();
    const x2 = e.toLane !== null ? laneX(e.toLane) : vx;

    const pts: string[] = [`${x1},${y1}`];
    if (vx !== x1) {
      const forkY = y1 + ROW_H / 2;
      pts.push(`${x1},${forkY}`, `${vx},${forkY}`);
    }
    if (x2 !== vx) {
      const joinY = y2 - ROW_H / 2;
      pts.push(`${vx},${joinY}`, `${x2},${joinY}`);
    }
    pts.push(`${x2},${y2}`);
    return pts.join(" ");
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", width: "100%", overflow: "hidden", padding: "16px 20px", background: surfaceBg(0.04), "box-sizing": "border-box" }}>
      <Show when={data().rows.length === 0}>
        <EmptyState message="Loading graph..." />
      </Show>
      <Show when={data().rows.length > 0}>
        <div
          onScroll={handleScroll}
          style={{ flex: 1, width: "100%", overflow: "auto", background: surfaceBg(0.04) }}
        >
          <div style={{ width: "100%", "min-width": `${graphW() + 340}px` }}>
            <svg width="100%" height={svgH()} style={{ display: "block" }}>
              <defs>
                <Index each={COLORS}>
                  {(color, idx) => (
                    <marker
                      id={`merge-arrow-${idx}`}
                      viewBox="0 0 10 10"
                      refX="5"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={color()} />
                    </marker>
                  )}
                </Index>
              </defs>
              <Index each={data().edges}>
                {(edge) => {
                  const isMerge = () => edge().isMergeBranch || edge().parentIndex > 0;
                  const strokeCol = () => laneColor(edge().viaLane);
                  const markerId = () => `url(#merge-arrow-${edge().viaLane % COLORS.length})`;

                  return (
                    <polyline
                      points={edgePoints(edge())}
                      fill="none"
                      stroke={strokeCol()}
                      stroke-width={isMerge() ? "2.5" : "2"}
                      stroke-dasharray={isMerge() ? "5,3" : "none"}
                      opacity={isMerge() ? "0.95" : "0.55"}
                      stroke-linejoin="round"
                      stroke-linecap="round"
                      marker-start={isMerge() ? markerId() : undefined}
                    />
                  );
                }}
              </Index>
              <Index each={data().rows}>
                {(row, i) => {
                  const y = rowY(i);
                  const cx = laneX(row().lane);
                  const color = laneColor(row().lane);
                  const maxLane = () => rowMaxLanes()[i] ?? row().lane;
                  const railsW = () => (maxLane() + 1) * LANE_W;
                  const refStart = () => railsW() + 8;
                  const textX = () => refStart() + (row().refs.length > 0 ? Math.min(row().refs.length, 3) * 130 : 0) + 6;
                  const isSelected = () => selectedHash() === row().hash;
                  const isMergeCommit = () => row().parents.length > 1;
                  const msgLeft = () => textX() + (isMergeCommit() ? 202 : 78);

                  return (
                    <g
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRowClick(row().hash)}
                      onContextMenu={(e) => handleContextMenu(e, row().hash)}
                    >
                      {/* Row background selection state */}
                      <rect
                        x="0"
                        y={y - ROW_H / 2}
                        width="100%"
                        height={ROW_H}
                        fill={isSelected() ? "rgba(245, 158, 11, 0.14)" : "transparent"}
                        style={{ transition: "fill 0.15s" }}
                      />

                      {/* Merge Node vs Standard Node Visuals */}
                      <Show when={isMergeCommit()}>
                        <circle cx={cx} cy={y} r={DOT_R + 4.5} fill="rgba(96, 205, 255, 0.25)" stroke={color} stroke-width="1.5" />
                        <polygon
                          points={`${cx},${y - DOT_R - 2} ${cx + DOT_R + 2},${y} ${cx},${y + DOT_R + 2} ${cx - DOT_R - 2},${y}`}
                          fill="var(--accent-default, #60cdff)"
                          stroke="var(--option-bg, #000)"
                          stroke-width="1.5"
                        />
                      </Show>
                      <Show when={!isMergeCommit()}>
                        <circle cx={cx} cy={y} r={DOT_R} fill={color} stroke="var(--panel-bg,#1a1a2e)" stroke-width="2" />
                        <circle cx={cx} cy={y} r={DOT_R + 2.5} fill="none" stroke={color} stroke-width="1.5" opacity={isSelected() ? "0.8" : "0.3"} />
                      </Show>

                      {/* Branch / Tag Reference Badges */}
                      <Index each={row().refs}>
                        {(ref, ri) => {
                          const rx = refStart() + ri * 130;
                          const tw = Math.min(ref().length * 7.2 + 16, 120);
                          return (
                            <g>
                              <rect x={rx} y={y - 9} width={tw} height={18} rx={4} fill={color} opacity="0.22" stroke={color} stroke-width="1" />
                              <text x={rx + 8} y={y + 4} fill={color} font-size="10" font-weight="700" font-family="Space Mono,monospace">
                                {ref().length > 14 ? ref().slice(0, 14) + "…" : ref()}
                              </text>
                            </g>
                          );
                        }}
                      </Index>

                      {/* Commit Hash Label */}
                      <text x={textX()} y={y + 4} fill="var(--accent-default, var(--accent-color,#f59e0b))" font-size="11" font-family="Space Mono,monospace" style={{ "text-shadow": "var(--text-shadow)" }}>
                        {row().hash.slice(0, 7)}
                      </text>

                      {/* Merge Commit Explicit Directional Badge */}
                      <Show when={isMergeCommit()}>
                        <g>
                          <rect x={textX() + 65} y={y - 9} width="128" height="17" rx="4" fill="rgba(96, 205, 255, 0.22)" stroke="rgba(96, 205, 255, 0.45)" />
                          <text x={textX() + 71} y={y + 3} fill="var(--accent-default, #60cdff)" font-size="10" font-weight="700" font-family="Space Mono,monospace" style={{ "text-shadow": "var(--text-shadow)" }}>
                            🔀 MERGE ({row().parents[1].slice(0, 5)}➔{row().parents[0].slice(0, 5)})
                          </text>
                        </g>
                      </Show>

                      {/* Commit Message */}
                      <foreignObject x={msgLeft()} y={y - 10} width={`calc(100% - ${msgLeft() + 200}px)`} height={ROW_H}>
                        <div
                          xmlns="http://www.w3.org/1999/xhtml"
                          style={{
                            "font-size": "12px",
                            color: isSelected() ? "var(--accent-default, var(--accent-color, #f59e0b))" : "var(--text-primary, var(--text-color))",
                            "font-weight": isSelected() ? "600" : "400",
                            "text-shadow": "var(--text-shadow)",
                            "line-height": `${ROW_H}px`,
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                          title={row().message}
                        >
                          {row().message}
                        </div>
                      </foreignObject>
                      <text x="calc(100% - 16px)" y={y + 4} text-anchor="end" fill="var(--text-secondary, #c0c0c0)" font-size="11" style={{ "text-shadow": "var(--text-shadow)" }}>
                        {row().author}{" · "}{formatTimestamp(row().timestamp)}
                      </text>
                    </g>
                  );
                }}
              </Index>
            </svg>
            <Show when={ctx.graphHasMore() && !ctx.graphLoading()}>
              <div
                onClick={() => ctx.loadMoreGraph()}
                style={{
                  padding: "10px 16px",
                  "font-size": "12px",
                  color: "var(--accent-default, var(--accent-color,#f59e0b))",
                  "text-align": "center",
                  cursor: "pointer",
                  "user-select": "none",
                }}
              >
                Load older commits ↓
              </div>
            </Show>
            <Show when={ctx.graphLoading()}>
              <div style={{ padding: "10px 16px", "font-size": "12px", color: "var(--text-secondary,#888)", "text-align": "center" }}>
                Loading more commits…
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Selected Commit Detail Drawer */}
      <Show when={ctx.commitDetail()}>
        <div style={{ "margin-top": "12px", "flex-shrink": 0 }}>
          <Card>
            <div style={S.cardHeader}>
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ "font-weight": 600, color: "var(--text-primary, var(--text-color))", "text-shadow": "var(--text-shadow)" }}>Commit Details</span>
                <code style={{ color: "var(--accent-default, var(--accent-color, #f59e0b))", "font-family": "Space Mono, monospace", "font-size": "12px" }}>
                  {ctx.commitDetail()!.hash.slice(0, 7)}
                </code>
              </div>
              <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                <Button size="sm" variant="primary" onClick={() => {
                  const d = ctx.commitDetail();
                  if (d) ctx.openDiffPrompt(d.hash);
                }}>View Diff</Button>
                <button
                  type="button"
                  onClick={() => {
                    ctx.closeCommitDetail();
                    setSelectedHash(null);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-secondary, #888)",
                    cursor: "pointer",
                    padding: "4px",
                    display: "inline-flex",
                    "align-items": "center",
                  }}
                  title="Close details"
                >
                  <CloseIcon size={14} />
                </button>
              </div>
            </div>

            <div style={{ "font-size": "13px", "line-height": "1.5" }}>
              <div style={{ "white-space": "pre-wrap", "font-weight": 500, "margin-bottom": "8px", color: "var(--text-primary, var(--text-color))", "text-shadow": "var(--text-shadow)", "word-break": "break-word" }}>
                {ctx.commitDetail()!.message}
              </div>

              {/* Explicit Merge Breakdown Box */}
              <Show when={ctx.commitDetail()!.parent_hashes.length > 1}>
                <div style={{ background: "var(--accent-bg-soft, rgba(96, 205, 255, 0.12))", border: "1px solid var(--accent-border, rgba(96, 205, 255, 0.3))", padding: "10px 14px", "border-radius": "6px", margin: "10px 0", "box-shadow": "0 2px 8px rgba(0,0,0,0.15)" }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "6px", "font-weight": 600, "font-size": "12px", color: "var(--accent-default, #60cdff)", "text-shadow": "var(--text-shadow)" }}>
                    🔀 Merge Commit Breakdown
                  </div>
                  <div style={{ "font-size": "12px", margin: "6px 0 2px", color: "var(--text-primary, var(--text-color))", "text-shadow": "var(--text-shadow)", display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap" }}>
                    <span>Merging <strong>Source Branch</strong></span>
                    <code style={{ background: "rgba(74, 222, 128, 0.2)", color: "#4ade80", padding: "2px 6px", "border-radius": "4px", "font-family": "Space Mono, monospace", "font-size": "11px" }}>
                      {ctx.commitDetail()!.parent_hashes[1].slice(0, 7)}
                    </code>
                    <span style={{ "font-weight": 700 }}>➔ Into Target/Base Branch</span>
                    <code style={{ background: "rgba(96, 165, 250, 0.2)", color: "#60a5fa", padding: "2px 6px", "border-radius": "4px", "font-family": "Space Mono, monospace", "font-size": "11px" }}>
                      {ctx.commitDetail()!.parent_hashes[0].slice(0, 7)}
                    </code>
                  </div>
                </div>
              </Show>

              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "16px", "font-size": "11px", color: "var(--text-secondary, #888)", "border-top": "1px solid var(--border-subtle, rgba(255,255,255,0.06))", "padding-top": "8px" }}>
                <div><strong>Author:</strong> {ctx.commitDetail()!.author} &lt;{ctx.commitDetail()!.email}&gt;</div>
                <div><strong>Date:</strong> {formatTimestamp(ctx.commitDetail()!.timestamp)}</div>
                <div><strong>Full Hash:</strong> <code style={{ "font-family": "Space Mono, monospace" }}>{ctx.commitDetail()!.hash}</code></div>
              </div>
            </div>
          </Card>
        </div>
      </Show>

      {/* Right-click Context Menu */}
      <Show when={menuPos()}>
        <CommitContextMenu
          x={menuPos()!.x}
          y={menuPos()!.y}
          hash={menuPos()!.hash}
          onClose={() => setMenuPos(null)}
        />
      </Show>
    </div>
  );
}
