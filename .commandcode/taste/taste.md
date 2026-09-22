# Backend
- Use Rust (Axum, sqlx, Tauri) for high-performance backend systems. Confidence: 0.70
- Use Go for minimal network utilities. Confidence: 0.70

# Frontend
See [frontend/taste.md](frontend/taste.md)
# Deployment
- Use rootless Podman with podman compose for container runtime. Confidence: 0.70
- Use Caddy as reverse proxy inside an Alpine container. Confidence: 0.70
- Use Cloudflare Origin CA certificates or Let's Encrypt for SSL. Confidence: 0.70
- Use multi-stage Dockerfiles with cached Cargo and npm layers. Confidence: 0.70

# Security
- Bind backend services to 127.0.0.1 to avoid exposing unauthenticated ports. Confidence: 0.70
- Configure basic auth on the Caddy layer, bypassing WebSocket paths. Confidence: 0.70
- KEK-wrap sensitive configuration parameters at rest. Confidence: 0.70
- Use streaming AEAD (AES-256-GCM, 1 MiB chunks) for audio and large assets. Confidence: 0.70
- CPU-gate background heavy operations (check /proc/stat, run only when CPU idle >= 80%). Confidence: 0.70

# Architecture
See [architecture/taste.md](architecture/taste.md)
# Workflow
See [workflow/taste.md](workflow/taste.md)
# Documentation
- Use AGENTS.md and HANDOFF.md files at project boundaries for AI coordination context. Confidence: 0.75
- "update handoff" is a standing directive meaning: refresh the project's HANDOFF.md to current reality — mark finished items DONE right in their headings (e.g., `## Feature 5 — search index (DONE — shipped after v0.4.108)`), add a section summarizing everything shipped since the last update (preserving the hard-won lessons, e.g. "CI failures caught exactly where this file said they'd be"), and refresh the "Current git state" section to the latest tag. Keep the historical narrative — it is kept explicitly because its lessons (one feature per version, never guess-and-patch, Rust compiles only in CI) still govern how the repo is worked on; the doc states it is the source of truth for future sessions. Docs-only updates ship as a `docs:` commit (with the Co-authored-by trailer) pushed straight to main — no version bump, tag, or CI watch — but still get the ntfy agent-tasks summary. Confidence: 0.7
, bounded ~10 s, treat a null handle as already-gone, `#[cfg(not(windows))]` no-op stub) BEFORE constructing the Tauri builder; when introducing a new CLI arg, verify the existing arg parser ignores flag-like args (Flurer's `cli::resolve_launch_path` does). Confidence: 0.65

# Workflow
See [workflow/taste.md](workflow/taste.md)
# Documentation
- Use AGENTS.md and HANDOFF.md files at project boundaries for AI coordination context. Confidence: 0.75
