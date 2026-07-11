export type MainView = "explorer" | "graph" | "settings";

// A request for GraphView to expand and center on a given path (e.g. a
// drive selected from the sidebar while already in graph mode). `token` is
// bumped on every request, including a repeat of the same path, so the
// effect watching it in GraphView fires even when nothing else about the
// request changed.
export type GraphFocusRequest = { path: string; token: number };
