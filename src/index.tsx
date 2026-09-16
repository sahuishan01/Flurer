/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";

// The webview has no console in a packaged build, and a crash before Solid
// mounts (or inside appReady gating) shows up to the user as a bare body
// frame with nothing in it. Forward every uncaught error and rejection into
// the Rust file logger (%LOCALAPPDATA%/.flurer/logs) so a blank window
// ships with the JS stack trace that caused it.
function reportError(kind: string, detail: unknown) {
  const message =
    detail instanceof Error
      ? `${detail.message}\n${detail.stack ?? ""}`
      : String(detail);
  console.error(`[${kind}]`, message);
  invoke("log_frontend", { level: "error", message: `[${kind}] ${message}` }).catch(
    (err) => console.error("failed to forward log", err),
  );
}

window.addEventListener("error", (event) => {
  reportError("uncaught", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  reportError("unhandled-rejection", event.reason);
});

invoke("log_frontend", { level: "info", message: "webview script loaded" }).catch(
  () => {}, // IPC not up yet or log command missing — console output above is the fallback
);

render(() => <App />, document.getElementById("root") as HTMLElement);
