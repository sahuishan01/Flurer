#!/usr/bin/env bash
set -euo pipefail

mode=${1:-ci}
case "$mode" in ci|release) ;; *) echo 'Expected ci or release' >&2; exit 2 ;; esac
cd "$(git rev-parse --show-toplevel)"

# Keep the Ubuntu 22.04/glibc 2.35 release baseline on the Debian VPS.
image="localhost/flurer-build:$(sha256sum scripts/ci/Containerfile | cut -c1-16)"
podman_args=(--cgroup-manager=cgroupfs)
if ! podman "${podman_args[@]}" image exists "$image"; then
  podman "${podman_args[@]}" build --layers --network=slirp4netns \
    --file scripts/ci/Containerfile --tag "$image" scripts/ci
fi

cargo_home=${CARGO_HOME:-$HOME/.cargo}
rustup_home=${RUSTUP_HOME:-$HOME/.rustup}
bun_home=${BUN_INSTALL:-$HOME/.bun}
node_home=$(dirname "$(dirname "$(command -v node)")")
build_home="$HOME/.cache/flurer-linux-home"
mkdir -p "$build_home" "$cargo_home" "$rustup_home" "$bun_home"

# All image layers, caches, workspaces, and temporary files stay on the capped
# runner volume. Disabled container cgroups retain the runner's parent limits.
podman "${podman_args[@]}" run --rm --cgroups=disabled \
  --network=slirp4netns:allow_host_loopback=false \
  --security-opt=no-new-privileges \
  --volume "$PWD:/workspace" --workdir /workspace \
  --volume "$cargo_home:/cache/cargo" \
  --volume "$rustup_home:/cache/rustup" \
  --volume "$bun_home:/cache/bun" \
  --volume "$node_home:/opt/node:ro" \
  --volume "$build_home:/build-home" \
  --volume "$RUNNER_TEMP:/tmp" \
  --env HOME=/build-home --env CARGO_HOME=/cache/cargo \
  --env RUSTUP_HOME=/cache/rustup --env BUN_INSTALL=/cache/bun \
  --env PATH=/opt/node/bin:/cache/bun/bin:/cache/cargo/bin:/usr/local/bin:/usr/bin:/bin \
  --env CARGO_BUILD_JOBS=4 --env CMAKE_BUILD_PARALLEL_LEVEL=4 --env MAKEFLAGS=-j4 \
  --env CARGO_INCREMENTAL=0 --env CARGO_PROFILE_DEV_DEBUG=0 --env CARGO_PROFILE_TEST_DEBUG=0 \
  --env APPIMAGE_EXTRACT_AND_RUN=1 \
  "$image" /bin/bash -euo pipefail -c '
    bun install --frozen-lockfile
    if [ "$1" = ci ]; then
      bun test tests/fs.test.ts
      bun run build
      cargo test --manifest-path src-tauri/Cargo.toml -p flurer --lib fs::
      cargo test --manifest-path src-tauri/Cargo.toml -p flurer --lib disks::
    fi
    bun run tauri build
  ' -- "$mode"
