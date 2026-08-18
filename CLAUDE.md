# Flurer project instructions

## Version bumps and pushes

Before bumping the version in `package.json` / `src-tauri/tauri.conf.json`
/ `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` and pushing to `main`
(including plain "bump and push" requests, not just full releases), always
run:

```bash
bun run build
```

and confirm it succeeds before touching the version numbers or pushing.
Do not bump or push on a failing build — fix the failure first. This
applies every time, not only for tagged releases (see the fuller release
workflow, including tagging and monitoring the GitHub Actions run, in the
`flurer-conventions` skill).
