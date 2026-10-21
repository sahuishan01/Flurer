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
# RUNNER_TEMP is a CI-only variable. Fall back to a local temp directory
# so the script can also be run by hand on a build host.
runner_temp=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
mkdir -p "$build_home" "$cargo_home" "$rustup_home" "$bun_home" "$runner_temp"

# Locate a usable bun binary. On CI, setup-bun puts one at
# $BUN_INSTALL/bin/bun. On a developer host bun may instead come from a
# version manager, where the binary can be named "bun.exe" and reached
# only through a symlink whose target sits outside the mounted tree —
# so resolve it to a real file and mount its directory.
bun_bin=""
if [ -x "$bun_home/bin/bun" ]; then
  bun_bin="$bun_home/bin/bun"
elif command -v bun >/dev/null 2>&1; then
  resolved=$(readlink -f "$(command -v bun)")
  [ -x "$resolved" ] && bun_bin="$resolved"
fi
if [ -z "$bun_bin" ]; then
  echo "Could not find a bun binary (looked in $bun_home/bin and on PATH)." >&2
  exit 1
fi
bun_bin_dir=$(dirname "$bun_bin")
bun_bin_name=$(basename "$bun_bin")

# On a SELinux-enforcing host, a volume mounted from a directory the
# container cannot traverse is unreadable unless it is relabelled. CI
# runners do not need this, so it is applied only when SELinux is on.
label=""
if [ "$(getenforce 2>/dev/null || true)" = "Enforcing" ]; then
  label=":z"
fi
# vol HOST_PATH:CONTAINER_PATH[:ro] — the SELinux label goes on the
# container path, before any options.
vol() {
  local spec=$1
  case "$spec" in
    *:ro) echo "--volume=${spec%:*}$label:ro" ;;
    *)    echo "--volume=$spec$label" ;;
  esac
}

# All image layers, caches, workspaces, and temporary files stay on the capped
# runner volume. Disabled container cgroups retain the runner's parent limits.
podman "${podman_args[@]}" run --rm --cgroups=disabled \
  --network=slirp4netns:allow_host_loopback=false \
  --security-opt=no-new-privileges \
  $(vol "$PWD:/workspace") --workdir /workspace \
  $(vol "$cargo_home:/cache/cargo") \
  $(vol "$rustup_home:/cache/rustup") \
  $(vol "$bun_home:/cache/bun") \
  $(vol "$bun_bin_dir:/opt/bun-bin") \
  $(vol "$node_home:/opt/node") \
  $(vol "$build_home:/build-home") \
  $(vol "$runner_temp:/tmp") \
  --env HOME=/build-home --env CARGO_HOME=/cache/cargo \
  --env RUSTUP_HOME=/cache/rustup --env BUN_INSTALL=/cache/bun \
  --env BUN_BIN=/opt/bun-bin/$bun_bin_name \
  --env PATH=/opt/bun-bin:/cache/bun/bin:/opt/node/bin:/cache/cargo/bin:/usr/local/bin:/usr/bin:/bin \
  --env CARGO_BUILD_JOBS=4 --env CMAKE_BUILD_PARALLEL_LEVEL=4 --env MAKEFLAGS=-j4 \
  --env CARGO_INCREMENTAL=0 --env CARGO_PROFILE_DEV_DEBUG=0 --env CARGO_PROFILE_TEST_DEBUG=0 \
  --env APPIMAGE_EXTRACT_AND_RUN=1 \
  "$image" /bin/bash -euo pipefail -c '
    # The bun binary may be named "bun.exe" when it comes from a version
    # manager. Symlink it to the name everything expects, so that child
    # processes which look it up on PATH find it too.
    if [ "$(basename "$BUN_BIN")" != "bun" ]; then
      ln -sf "$BUN_BIN" /usr/local/bin/bun
    fi
    bun install --frozen-lockfile
    if [ "$1" = ci ]; then
      bun test tests/fs.test.ts
      bun run build
      cargo test --manifest-path src-tauri/Cargo.toml -p flurer --lib fs::
      cargo test --manifest-path src-tauri/Cargo.toml -p flurer --lib disks::
    fi
    bun run tauri build
  ' -- "$mode"
