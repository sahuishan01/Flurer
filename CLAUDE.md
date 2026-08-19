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
Do not bump or push on a failing build — fix the failure first.

"Bump and push" always means the full release, not just a commit to
`main`. `release.yml` (which actually builds installers and publishes a
GitHub Release the in-app updater checks) only triggers on a `vX.Y.Z` tag
push — `build.yml`'s push-to-main trigger is CI verification only and
never produces a release. So every version bump must also: commit +
push the version-file changes to `main`, then `git tag vX.Y.Z` and
`git push origin vX.Y.Z`, then monitor the triggered Release Actions run
to completion. A bump that only reaches `main` without a tag leaves the
updater reporting "up to date" on the old version — see the fuller
sequence (including the `agent-releases` notification timing) in the
`flurer-conventions` skill.
