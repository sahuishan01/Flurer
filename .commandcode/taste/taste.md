# Backend
- Use Rust (Axum, sqlx, Tauri) for high-performance backend systems. Confidence: 0.70
- Use Go for minimal network utilities. Confidence: 0.70

# Frontend
- Use SolidJS for lightweight dashboard apps. Confidence: 0.70
- Prefer blended, custom window chrome over native title bars: undecorate the windows (`decorations: false`) and carry the OS drag region plus min/max/close controls inside the app's own top bar, styled platform-fluent (flat buttons, red close hover), so no unstyleable native chrome shows above the app shell. Confidence: 0.70
- Prefer compact UI chrome with maximum glyph visibility; oversized or dimmed chrome gets rejected round after round: full-height 46px Win11 window-control blocks were "too large" (accepted: ~30×26 rounded pills), the follow-up titlebar styling that left the top bar taller than before (0.75em padding) with faint `--text-secondary` glyphs was rejected outright ("too much height, icons not visible"), and icon visibility was STILL reported broken ("icons are still not visible") even after the full-contrast/1.4px stroke fix — thin stroked SVGs are just not reliably visible at ~11px on some DPIs. Accepted solution (user-directed: "you can use colors rather than icons for easier visibility"): draw window-control glyphs as solid filled CSS shapes instead of stroked SVGs — filled 10×2px bar (minimize), 9×9px box with 2px border (maximize), close X built from two 2px-thick rotated bars — all in full-contrast currentColor / `--text-primary`. General rule for small chrome glyphs: solid filled shapes / color blocks beat thin line icons; when a glyph must stay visible at small sizes, don't reach for stroked SVGs at all. Top bar stays at its pre-titlebar compact height (~0.35em vertical padding). When restyling chrome, err smaller and higher-contrast than the platform default. Confidence: 0.85
- Custom top-bar chrome must remain fully functional through any restyle: the window must stay draggable by the top bar (preserve `data-tauri-drag-region` on the bar and its non-interactive children across markup restructures — a restyle silently dropped it and the user immediately reported "unable to drag") alongside the min/max/close buttons. Confidence: 0.7
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
- When bumping app version, update ALL version fields consistently (Cargo.toml, package.json, tauri.conf.json) and stage Cargo.lock alongside them. Confidence: 0.75

# Workflow
See [workflow/taste.md](workflow/taste.md)
# Documentation
- Use AGENTS.md and HANDOFF.md files at project boundaries for AI coordination context. Confidence: 0.75
