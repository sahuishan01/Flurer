# AI Coordination & Future Roadmap (AGENTS.md)

This file acts as a context preservation and coordination document for future AI agents working on Flurer. It outlines the user's future intents, architectural directions, and guidance on how to implement them.

---

## 1. Dynamic GitHub Release Marketplace

**Intent**: Fully integrate the marketplace with a GitHub repository's releases instead of relying on the hardcoded `MARKETPLACE_PLUGINS` array in `src/lib/plugins.ts`.

### How to Implement:
1. **Host a Centralized Registry**:
   - Create a `marketplace.json` in a repository (e.g. `sahuishan01/flurer-plugins` or the main `sahuishan01/Flurer` repo).
   - The registry schema should list available plugins, versions, descriptions, author details, and direct download links to their built `index.js`.
2. **Fetch Marketplace Data in Frontend**:
   - Fetch the `marketplace.json` at runtime using `fetch` or a Rust command.
   - Cache it locally in settings or memory to ensure the marketplace UI is populated.
3. **Release Assets Strategy**:
   - When drafting a GitHub Release for a plugin, attach `index.js` and `plugin.json` as release assets.
   - Use the GitHub API (`https://api.github.com/repos/{owner}/{repo}/releases`) to fetch details dynamically.

---

## 2. Auto-Updating Plugins

**Intent**: Allow users to see when a plugin has an update available and upgrade it with a single click.

### How to Implement:
1. **Version Comparison**:
   - For each installed plugin (loaded via `list_installed_plugins`), compare its `version` in `plugin.json` with the corresponding version in the remote marketplace registry.
2. **Upgrade Action**:
   - If the remote version is higher, show an "Update" button in the `PluginMarketplace` card.
   - Clicking "Update" should trigger the `installPlugin` command again with the new URLs, overwriting the local directory, followed by a dynamic re-evaluation of the bundle.

---

## 3. Rust-Level Plugin Capabilities (Tauri Extensibility)

**Intent**: Enable plugins to execute custom Rust code or register new Tauri commands instead of only relying on existing frontend APIs.

### How to Implement:
1. **Dynamic Library Loading (`libloading`)**:
   - If a plugin requires a compiled backend component, allow downloading a shared library (`.dll` / `.so` / `.dylib`) into the plugin folder.
   - Use Rust's `libloading` crate to load the library and register dynamic command handlers.
2. **Tauri Plugin System Integration**:
   - Build plugins as standard Tauri v2 plugins, dynamically loaded in `src-tauri/src/lib.rs` during setup if their directory is present and enabled.

---

## 4. Plugin Sandbox & Security

**Intent**: Prevent malicious plugins from executing raw shell commands or accessing the filesystem without restriction.

### How to Implement:
1. **Capabilities Restriction**:
   - Currently, Tauri v2 capabilities (`default.json`) apply globally to the webview.
   - If sandboxing is desired, load plugins inside an offscreen, sandboxed `<iframe sandbox="allow-scripts">` and communicate via `postMessage`.
2. **API Gateway**:
   - Implement a frontend gateway that intercepts calls and prompts the user before granting plugins access to sensitive filesystem operations (similar to browser extension permissions).

---

## 5. Developer Plugin Boilerplate / SDK

**Intent**: Make it simple for third-party developers to write, build, and publish Flurer plugins.

### How to Implement:
1. **Template Repository**:
   - Create a boilerplate repository containing `vite.config.ts` pre-configured to bundle plugins as IIFE packages with externalized Reactives.
2. **Types Package**:
   - Extract `PluginInfo` and related interfaces into a shared NPM package or file (e.g. `flurer-plugin-sdk`) so developers get auto-completion and type checking during development.
