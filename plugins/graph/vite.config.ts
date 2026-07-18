import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { resolve } from "path";

export default defineConfig({
  plugins: [solid()],
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/index.tsx"),
      name: "FlurerGraphPlugin",
      formats: ["iife"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "solid-js",
        "solid-js/web",
        "solid-js/store",
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
      ],
      output: {
        globals: {
          "solid-js": "window.Solid",
          "solid-js/web": "window.SolidWeb",
          "solid-js/store": "window.SolidStore",
          "@tauri-apps/api/core": "window.TauriCore",
          "@tauri-apps/api/event": "window.TauriEvent",
        },
      },
    },
  },
});
