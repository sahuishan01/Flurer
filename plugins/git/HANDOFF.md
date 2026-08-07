# HANDOFF.md — flurer-plugin-git

**Current Version:** `0.12.1`  
**Latest Tag:** `v0.12.1`  
**Repository:** `sahuishan01/flurer-plugin-git`  
**Monorepo Location:** `/home/opc/projects/flurer-plugin-git` & mirrored at `Flurer/plugins/git`

---

## 1. Executive Summary

`flurer-plugin-git` is the official Git operations plugin for [Flurer](https://github.com/sahuishan01/Flurer), providing a comprehensive Git panel with changes management, commit graph visualization, multi-branch history, stashes, worktrees, and interactive commit diffing — executed directly via the `git` CLI through Tauri's shell plugin.

The latest releases (**v0.11.0 → v0.12.1**) resolved critical diff execution bugs, introduced interactive commit diff target selection, added multi-branch selection, and fixed Windows CRLF line-ending parsing issues.

---

## 2. Architecture & File Overview

```
flurer-plugin-git/
├── src/
│   ├── index.tsx                    # Plugin entry point → registers window.registerPlugin
│   ├── context.tsx                  # GitProvider — reactive signals & git command orchestration
│   ├── git.ts                       # Low-level git CLI execution via Tauri shell plugin & diff parser
│   ├── utils.ts                     # Local storage helpers, theme helpers, and color utilities
│   ├── styles.ts                    # Inline visual tokens (S object)
│   ├── types.ts                     # TypeScript interfaces (GitDiff, DiffHunk, GitCommit, etc.)
│   └── components/
│       ├── DashboardView.tsx        # Recent repos & open-by-path input
│       ├── RepoView.tsx             # Main repo layout with toolbar, sub-view tabs, & branch multi-select
│       ├── ChangesView.tsx          # Stage/unstage, commit input, & change file rows
│       ├── GraphView.tsx            # SVG commit graph with directional arrowheads
│       ├── BranchesView.tsx         # Branch list with checkout/merge/delete actions
│       ├── HistoryView.tsx          # Commit history log with search & multi-branch filtering
│       ├── DiffView.tsx             # Interactive diff viewer with target switcher & hunk cards
│       ├── StashView.tsx            # Stash create/pop/drop management
│       ├── WorktreesView.tsx        # Worktree add/remove management
│       └── shared/index.tsx         # UI components (Button, Card, Badge, DiffCompareModal, etc.)
├── plugin.json                      # Plugin manifest required by Flurer
├── package.json                     # Dependencies & build scripts
└── vite.config.ts                   # IIFE bundle config mapping externals to window.Solid & window.TauriShell
```

---

## 3. Key Accomplishments & Version History

### `v0.12.1` — CRLF Normalization & Auto-Fallbacks
- **CRLF Line Ending Fix:** Stripped `\r\n` and `\r` line endings in `parseDiff` prior to regex matching. On Windows, hunk header lines previously ended in `@@\r`, causing the regex `^@@ ... @@$` to fail and drop all hunks.
- **Auto-Fallback Chain:** Updated `gitDiff` and `gitDiffStaged` to automatically attempt fallback diff commands (staged, unstaged, or `git diff --no-index /dev/null <file>`) if a requested file's diff returns empty.

### `v0.12.0` — Git CLI Exit Code 1 Acceptance
- **Exit Code 1 Fix:** Updated `execGit` in `src/git.ts` to accept both exit code `0` and exit code `1` as valid execution outputs. Standard Git CLI returns exit code `1` whenever differences exist. Previously, `execGit` threw a JavaScript exception on exit code 1, causing diffs to crash across all cases.

### `v0.11.3` — Revision Label Formatting
- **`formatHashLabel` Helper:** Preserved revision modifiers (`~1`, `^1`) when formatting SHAs in `DiffView.tsx` so badge labels render as `(8eb30ea~1 ↔ 8eb30ea)` instead of slicing off `~1`.

### `v0.11.2` — Universal Merge Commit Patch Diffing
- **`-m` Flag in `git show`:** Added `-m` flag to `git show` in `gitDiffCommit` so merge commits and root commits emit complete patch diffs instead of returning empty outputs.

### `v0.11.0` — Interactive Diff Target Selection
- **`DiffCompareModal`:** Clicking **View Diff** on any commit prompts the user to select between:
  1. ⏮️ **Previous Commit (`hash~1 ↔ hash`)**
  2. 📍 **Current HEAD (`hash ↔ HEAD`)**
  3. 📝 **Working Tree (`hash ↔ Uncommitted`)**
- **Segmented Target Switcher:** Added a top toolbar switcher in `DiffView` to toggle targets dynamically.

### `v0.10.1` — IIFE Bundle Global Resolution
- **SolidJS Hook Imports:** Explicitly imported `createMemo` from `solid-js` at top of `src/context.tsx`, resolving runtime `ReferenceError: createMemo is not defined` when executed via `new Function(code)()`.

### `v0.10.0` — Multi-Branch Selection
- **`BranchMultiSelect` Component:** Added multi-branch dropdown in top repo toolbar and history view, with an "All" toggle option.

---

## 4. Build, Deployment & Monorepo Syncing

### Build Command
```bash
bun install
bun run build
# Compiles IIFE bundle to dist/index.js (~108 kB)
```

### Multi-Repo Sync Rule
When updating plugin code in `projects/flurer-plugin-git`, always sync changes to Flurer's monorepo directory:
```bash
cp -r /home/opc/projects/flurer-plugin-git/src/* /home/opc/projects/Flurer/plugins/git/src/
cp /home/opc/projects/flurer-plugin-git/package.json /home/opc/projects/Flurer/plugins/git/package.json
cp /home/opc/projects/flurer-plugin-git/plugin.json /home/opc/projects/Flurer/plugins/git/plugin.json
cd /home/opc/projects/Flurer/plugins/git && bun run build
```

### Publishing a Release
```bash
# Update version in package.json & plugin.json (or run sync script)
git add .
git commit -m "v0.12.1: Summary of changes"
git tag -a v0.12.1 -m "flurer-plugin-git v0.12.1"
git push origin main --tags
```
*Note: GitHub Actions automatically builds the zip artifact on tag push. Send a notification to `https://ntfy.algosculptor.com/agent-releases` upon successful tag push.*

---

## 5. Verification Checklist for Next Agent

- [x] `bun run build` succeeds cleanly in both `flurer-plugin-git` and `Flurer/plugins/git`.
- [x] All git diff functions handle exit code 1 without throwing.
- [x] `parseDiff` normalizes CRLF (`\r\n`) line endings.
- [x] Untracked, staged, unstaged, and commit diffs render hunks cleanly.
- [x] Version tags are in sync between `package.json`, `plugin.json`, and GitHub release tags.
