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

---

## 6. Development Workflow & Release Process

This section defines the rigid workflow any AI agent must follow when making code changes to Flurer. It is designed to prevent orphaned builds, version-drift, and silent failures.

### 6.1. Notifications on Every Task

After every agent turn that performs a user-requested task (modification, build, test, deploy — not simple Q&A), the agent MUST send a push notification to the ntfy `agent-tasks` topic:

- **Topic**: `agent-tasks`
- **Base URL**: `https://ntfy.algosculptor.com`
- **Authorization**: `Bearer tk_qj3kmd5rrrssrb2mmrmtb1nqrwxye`
- **Headers**: `Title: Flurer ($(hostname))`
- **Body**: Concise bulleted summary of what was accomplished in that turn.

Do NOT send notifications for conversational chat or simple questions.

### 6.2. Commit & Push After Every Modification

After every successful modification (code change, config change, dependency update), the agent MUST:

1. Bump the version in `package.json` and `src-tauri/Cargo.toml` — but only **after** a successful CI build and release (see below).
2. Commit the changes with a descriptive message:
   ```
   git add -A
   git commit -m "description: what changed and why"
   ```
3. Push to the remote:
   ```
   git push origin main
   ```

The version number in both `package.json` and `Cargo.toml` must always be kept in sync.

### 6.3. Watch for CI Completion

After pushing, the agent MUST watch the GitHub Actions workflow run to completion:

1. Retrieve the latest workflow run ID via:
   ```bash
   gh run list --repo sahuishan01/Flurer --limit 1 --json databaseId,status,conclusion --workflow=<name>
   ```
2. Poll every 30–60 seconds until `status` is `completed`.
3. If the run **fails**, report the failure in the turn output and in the ntfy notification. Do NOT bump the version. Do NOT proceed.

### 6.4. Version Bump Rule — Only After a Successful Release

The version number MUST only be incremented **after** a CI build has completed successfully and produced a release-ready artifact. The sequence is:

```
Modify code → Commit → Push → CI passes → Bump version → Commit version bump
```

**Never** bump the version before pushing. The rationale: a failed build should not leave a higher version number stranded in the repo without a corresponding working artifact. The version is a statement about what has shipped, not what is being attempted.

When bumping:
- Increment the **patch** segment for bugfixes and minor changes.
- Increment the **minor** segment for new features or breaking UI changes.
- Bump both `package.json` (`bun version --patch` or manual edit) and `src-tauri/Cargo.toml` (manual edit) in the same commit.
- After bumping, push the version-bump commit.

### 6.5. Release Notification

After the version bump commit is pushed, if the resulting CI build produces a release (GitHub Release with attached assets), send a notification to the ntfy `agent-releases` topic:

- **Topic**: `agent-releases`
- **Headers**: `Title: Flurer v<new-version> Released ($(hostname))`
- **Body**: Bulleted summary of what changed in the release with a link to the release page on GitHub.

### 6.6. Summary Diagram

```
┌─────────────┐     ┌──────────┐     ┌───────────┐     ┌──────────────┐     ┌──────────────┐
│ Modify code │────>│ Commit   │────>│ Push      │────>│ Watch CI     │────>│ Version bump │
│ (send ntfy) │     │ (no bump)│     │           │     │ (poll to     │     │ (only on     │
└─────────────┘     └──────────┘     └───────────┘     │ completion)  │     │ CI success)  │
                                                        └──────────────┘     └──────┬───────┘
                                                                                   │
                                                                                   v
                                                                           ┌──────────────┐
                                                                           │ Release ntfy │
                                                                           │ notification │
                                                                           └──────────────┘
```
