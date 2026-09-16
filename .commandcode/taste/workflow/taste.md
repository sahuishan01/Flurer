# Workflow
- After pushing code to GitHub, monitor the CI/build status before considering the task done. Confidence: 0.65
- Do not commit/push automatically — wait for explicit user approval, then run the full commit → push → watch CI → version bump flow. Confidence: 0.60
- On task completion, send a summary notification to ntfy (https://ntfy.algosculptor.com/agent-tasks, Title "<project> (<hostname>)") with a short bullet list of what was done. Confidence: 0.60
- Agent tokens/credentials (e.g., ntfy bearer token) are canonically stored in `~/.dotfiles/agent-profile/PROFILE.md`; when a token embedded in project files like AGENTS.md fails or looks stale, check there first. Confidence: 0.80
- When typecheck/build reports errors, verify they are pre-existing (e.g., git stash, re-run, stash pop) before claiming the change introduced none — report pre-existing counts separately. Confidence: 0.70
- On the Flurer dev host, cargo check cannot run (missing GTK/glib system deps); verify Rust changes by inspection/frontend builds and defer compile validation to CI. Confidence: 0.60
- Persisted enum-like settings must degrade gracefully on unknown values: serde fallback (e.g., #[serde(other)]) in Rust plus runtime validation with a safe default in the frontend, so one corrupt value never resets all settings. Confidence: 0.55
