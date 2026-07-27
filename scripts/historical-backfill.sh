#!/usr/bin/env bash
# Backfill a run of electoral periods, newest first, in one process.
#
#   scripts/historical-backfill.sh 20 19 18 17 16 15 14
#
# One process and one period at a time, because the pacer that keeps the
# Enodia WAF from IP-blocking every bundestag.de host is process-wide
# (pipeline/src/bundestrack/api/base.py `_SHARED_PACER`) — two of these running
# side by side would defeat it, which is the failure §2.6 records as costing an
# hour of downtime.
#
# Each period is backfilled and then scored, per month and then in total: the
# nightly Convex sweep only recomputes the *current* month, so a backfilled
# period's months stay at zero until something asks for them, and the profile
# trend graphs read exactly those rows (webapp/components/trend-graphs.tsx).
#
# A period that fails does not stop the sweep. The rest are still worth having,
# every write is an upsert, and re-running one period is cheap; the summary at
# the end says which need it.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${BUNDESTRACK_LOG_DIR:-$REPO_ROOT/.logs}"
# `.env` and the state file both live beside the pipeline package, and
# pydantic-settings reads `.env` relative to the working directory.
PIPELINE_DIR="${BUNDESTRACK_PIPELINE_DIR:-$REPO_ROOT/pipeline}"
PYTHON="${BUNDESTRACK_PYTHON:-python}"

mkdir -p "$LOG_DIR"

# The worktree's code, not whatever the editable install points at — a pixi
# editable install resolves to the directory it was installed from, which for a
# worktree checkout is the main repo.
export PYTHONPATH="$REPO_ROOT/pipeline/src${PYTHONPATH:+:$PYTHONPATH}"

periods=("$@")
if [ ${#periods[@]} -eq 0 ]; then
  echo "usage: $0 <wahlperiode> [wahlperiode …]" >&2
  exit 64 # EX_USAGE
fi

cd "$PIPELINE_DIR" || exit 66

declare -a failed=()
for wp in "${periods[@]}"; do
  log="$LOG_DIR/backfill-wp$wp.log"
  echo "=== WP$wp backfill starting $(date -Is) → $log"
  if ! "$PYTHON" -m bundestrack.cli backfill --wp "$wp" >>"$log" 2>&1; then
    echo "=== WP$wp backfill FAILED (see $log)"
    failed+=("$wp:backfill")
  fi

  # Scores after the data, and per month: `scores --wp N` alone writes only the
  # period total, and every month of a closed period is one the nightly Convex
  # sweep will never revisit. The profile trend graphs read those monthly rows.
  echo "=== WP$wp scoring $(date -Is)"
  if ! "$PYTHON" -m bundestrack.cli scores --wp "$wp" --all-months >>"$log" 2>&1; then
    echo "=== WP$wp scoring FAILED (see $log)"
    failed+=("$wp:scores")
  fi
  echo "=== WP$wp done $(date -Is)"
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED STAGES: ${failed[*]}"
  exit 1
fi
echo "ALL PERIODS COMPLETED: ${periods[*]}"
