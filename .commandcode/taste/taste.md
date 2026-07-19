# Backend
- Use Rust (Axum, sqlx, Tauri) for high-performance backend systems. Confidence: 0.70
- Use Go for minimal network utilities. Confidence: 0.70

# Frontend
- Use SolidJS for lightweight dashboard apps. Confidence: 0.70
- Use React / Next.js for standard web frontends. Confidence: 0.70

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
- For plugin installation: support direct GitHub URL entry or ZIP file upload instead of a remote marketplace registry. Confidence: 0.70
- Release and version plugins independently from the main app, not as release assets in main app builds. Confidence: 0.75
- Place all plugins under a `plugins/` directory within the main app repo, each with its own build config and package.json. Confidence: 0.75
- When bumping app version, update ALL version fields consistently (Cargo.toml, package.json, tauri.conf.json). Confidence: 0.70

# Documentation
- Use AGENTS.md and HANDOFF.md files at project boundaries for AI coordination context. Confidence: 0.75
