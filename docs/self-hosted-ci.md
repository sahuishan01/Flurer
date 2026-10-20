# VPS builds

Trusted pushes and release tags use the repository's `heaven` Linux runner.
Pull requests and Windows builds continue using GitHub-hosted runners. Linux
compilation and packaging run in rootless Podman with Ubuntu 22.04, preserving
the existing glibc 2.35 compatibility baseline.

`scripts/ci/linux-container.sh` builds a cached image from `scripts/ci/Containerfile`
and mounts the runner's Node, Bun, Cargo, and Rust toolchains into it. Persistent
tool and compilation caches make subsequent builds reuse downloaded dependencies.
The Build workflow also supports manual dispatch for runner verification.

All VPS registrations share 4 CPU cores, 10 GiB RAM, one build slot, and a 30 GB
volume for runner files, image layers, workspaces, caches, and temporary files.
Only owner pushes, schedules, and manual runs pass the machine's job-start hook.
The VPS user has no sudo access; install system dependencies in the Containerfile.

This change affects workflow routing and the Linux build environment. GitNexus
does not index `.github/workflows/*.yml`; workflow triggers, matrix selections,
the Build/Release concurrency group, artifact paths, and publish dependencies
must also be reviewed directly when changing this configuration.
