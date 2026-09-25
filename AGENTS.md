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

## 6. GitNexus-First Codebase Navigation

Before grepping or manually reading files to answer codebase or architecture questions, agents **MUST** use GitNexus code intelligence tool / MCP server.

### Rules:
1. **Query & Impact Analysis**: Use `gitnexus query "<concept>"` or `impact({target: "symbolName", direction: "upstream"})` before making changes or exploring code paths.
2. **Context & Tracing**: Use `gitnexus context "<symbolName>"` for 360-degree views of symbols, and `gitnexus trace "<from>" "<to>"` to trace execution paths.
3. **Keep Index Current**: After modifying code files, run `gitnexus analyze` to update the graph index.
4. **Detect Changes**: Run `gitnexus detect-changes` prior to committing to verify affected flows and prevent regressions.

### When to Fall Back to Grep:
- The symbol or execution flow is not resolvable by the index.
- You need exact string literal matches (e.g., searching for a specific UI label or error message string).

---

## 7. Development Workflow & Release Process

This section defines the rigid workflow any AI agent must follow when making code changes to Flurer. It is designed to prevent orphaned builds, version-drift, and silent failures.

### 7.1. Notifications on Every Task

After every agent turn that performs a user-requested task (modification, build, test, deploy — not simple Q&A), the agent MUST send a push notification to the ntfy `agent-tasks` topic:

- **Topic**: `agent-tasks`
- **Base URL**: `https://ntfy.algosculptor.com`
- **Authorization**: `Bearer tk_cw33joa3jxozijd46cl724tl2dhgd` (source of truth: `~/.dotfiles/agent-profile/PROFILE.md`)
- **Headers**: `Title: Flurer ($(hostname))`
- **Body**: Concise bulleted summary of what was accomplished in that turn.

Do NOT send notifications for conversational chat or simple questions.

### 7.2. Commit & Push After Every Modification

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

### 7.3. Watch for CI Completion

After pushing, the agent MUST watch the GitHub Actions workflow run to completion:

1. Retrieve the latest workflow run ID via:
   ```bash
   gh run list --repo sahuishan01/Flurer --limit 1 --json databaseId,status,conclusion --workflow=<name>
   ```
2. Poll every 30–60 seconds until `status` is `completed`.
3. If the run **fails**, report the failure in the turn output and in the ntfy notification. Do NOT bump the version. Do NOT proceed.

### 7.4. Version Bump Rule — Only After a Successful Build

The version number MUST only be incremented **after** a CI build has completed successfully and produced a release-ready artifact. The sequence is:

```
Modify code → Commit → Push (no bump) → Watch Build CI → CI passes
  → Bump version → Commit locally → Tag (v0.4.23) → Push tag only
  → Watch Release CI → Release passes → Push version-bump commit to main
```

**Never** bump the version before pushing. The rationale: a failed build should not leave a higher version number stranded in the repo without a corresponding working artifact. The version is a statement about what has shipped, not what is being attempted.

**Tag-only push** (not `--tags` which also pushes the commit to main):

```bash
git tag -a v0.4.23 -m "Flurer v0.4.23"
git push origin v0.4.23
```

This pushes **only the tag**, triggering the Release workflow (which builds + creates the GitHub Release). The version-bump commit stays local; it gets pushed to `main` only after the release succeeds, avoiding a redundant Build workflow run on the version bump.

When bumping:
- Increment the **patch** segment for bugfixes and minor changes.
- Increment the **minor** segment for new features or breaking UI changes.
- Bump both `package.json` and `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` in the same commit.
- After the release succeeds: `git push origin main` to bring the version-bump commit to main.

### 7.5. Release Notification

After the Release workflow succeeds (GitHub Release created with MSI/NSIS assets), send a notification to the ntfy `agent-releases` topic:

- **Topic**: `agent-releases`
- **Headers**: `Title: Flurer v<new-version> Released ($(hostname))`
- **Body**: Bulleted summary of what changed in the release with a link to the release page on GitHub.

### 7.6. Summary Diagram

```
┌─────────────┐     ┌──────────┐     ┌───────────┐     ┌──────────────┐
│ Modify code │────>│ Commit   │────>│ Push to   │────>│ Watch Build  │
│ (send ntfy) │     │ (no bump)│     │ main      │     │ CI           │
└─────────────┘     └──────────┘     └───────────┘     └──────┬───────┘
                                                              │ pass?
                                                              v
                                                     ┌──────────────────┐
                                                     │ Version bump     │
                                                     │ Local commit     │
                                                     │ Tag (v0.4.23)    │
                                                     │ Push tag only    │
                                                     └────────┬─────────┘
                                                              │
                                                              v
                                                     ┌──────────────────┐
                                                     │ Watch Release   │
                                                     │ CI (builds +    │
                                                     │ creates Release)│
                                                     └────────┬─────────┘
                                                              │ pass?
                                                              v
                                          ┌──────────────────────────────┐
                                          │ Push version-bump commit    │
                                          │ to main                     │
                                          │ Send release ntfy           │
                                          │ notification                │
                                          └──────────────────────────────┘
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Flurer** (2865 symbols, 6736 relationships, 250 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/Flurer/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Flurer/clusters` | All functional areas |
| `gitnexus://repo/Flurer/processes` | All execution flows |
| `gitnexus://repo/Flurer/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
