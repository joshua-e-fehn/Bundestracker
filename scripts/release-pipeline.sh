#!/usr/bin/env bash
# Pin the code the daily sync runs to one commit.
#
#   scripts/release-pipeline.sh <commit>
#
# Exports `pipeline/src` and `scripts/` at <commit> into
# $BUNDESTRACK_RELEASE_DIR/<sha>/ and points `current` at it atomically. The
# scheduled run (ops/systemd/bundestrack-daily-sync.service) executes
# `current/scripts/daily-sync.sh`, which runs `current/pipeline/src` against the
# live checkout's pixi env, pipeline/.env and state file.
#
# Why not run the checkout itself: it is a shared working tree that agents edit
# and switch, and worktrees are deleted on merge. A scheduled production writer
# should run a commit someone reviewed, and keep running it until someone
# releases another. Re-running with the same commit is a no-op.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${BUNDESTRACK_RELEASE_DIR:-/opt/data/bundestrack-release}"
rev="${1:?usage: release-pipeline.sh <commit>}"

sha="$(git -C "$REPO_ROOT" rev-parse --verify "$rev^{commit}")"
target="$RELEASE_DIR/$sha"

mkdir -p "$RELEASE_DIR"
if [ ! -d "$target" ]; then
  staging="$(mktemp -d "$RELEASE_DIR/.staging.XXXXXX")"
  git -C "$REPO_ROOT" archive "$sha" pipeline/src scripts | tar -x -C "$staging"
  printf '%s\n%s\n' "$sha" "$(git -C "$REPO_ROOT" log -1 --format='%cI %s' "$sha")" \
    >"$staging/RELEASE"
  mv "$staging" "$target"
fi

ln -sfn "$sha" "$RELEASE_DIR/current.tmp"
mv -T "$RELEASE_DIR/current.tmp" "$RELEASE_DIR/current"
echo "current → $sha"
