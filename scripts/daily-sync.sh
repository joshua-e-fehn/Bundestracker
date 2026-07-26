#!/usr/bin/env bash
# Daily incremental sync, for a system cron.
#
# Wraps `pixi run pipeline sync` with the three things cron does not give you:
# an environment, a lock, and a log. Run it from anywhere — it resolves the
# repo from its own location rather than the working directory, because cron
# starts in $HOME.
#
#   crontab -e
#   17 4 * * * /path/to/bundestrack/scripts/daily-sync.sh
#
# Exit code is the pipeline's own: non-zero when any stage failed, so a cron
# MAILTO or a monitor sees a broken source rather than silence. See
# pipeline/src/bundestrack/cli.py:246 — a run where most stages worked still
# fails, which is what keeps a broken source from staying broken.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${BUNDESTRACK_LOG_DIR:-$REPO_ROOT/.logs}"
LOG_FILE="$LOG_DIR/daily-sync.log"
LOCK_FILE="${BUNDESTRACK_LOCK_FILE:-$REPO_ROOT/.daily-sync.lock}"

mkdir -p "$LOG_DIR"

# cron's PATH is typically /usr/bin:/bin, which has neither pixi nor bun.
# Prepend the usual install locations; a PATH already containing them is
# unchanged in effect.
export PATH="$HOME/.pixi/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

# Secrets live outside the repo — CONVEX_URL, PIPELINE_API_KEY and
# BUNDESTAG_API_KEY (pipeline/README.md § Configuration). `pipeline/.env` is
# read by pydantic-settings on its own; this is for hosts that keep them
# elsewhere, e.g. /etc/bundestrack.env owned by the cron user.
if [ -n "${BUNDESTRACK_ENV_FILE:-}" ]; then
  if [ ! -r "$BUNDESTRACK_ENV_FILE" ]; then
    echo "daily-sync: BUNDESTRACK_ENV_FILE is set but not readable: $BUNDESTRACK_ENV_FILE" >&2
    exit 78 # EX_CONFIG
  fi
  set -a
  # shellcheck disable=SC1090
  . "$BUNDESTRACK_ENV_FILE"
  set +a
fi

if ! command -v pixi >/dev/null 2>&1; then
  echo "daily-sync: pixi not on PATH (looked in $PATH)" >&2
  exit 127
fi

# Never two syncs at once. Not politeness: every *.bundestag.de host sits
# behind a WAF that IP-blocks *all* of them when it sees concurrent requests,
# and it did not clear across an hour of backoff (docs/api-research.md §2.6).
# A slow run overlapping the next day's cron would lock this host out of every
# source. `-n` fails immediately rather than queueing a second full fetch.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) daily-sync: another sync is still running — skipping this tick." \
    | tee -a "$LOG_FILE" >&2
  exit 0
fi

{
  echo "──────────────────────────────────────────────────────────────"
  echo "$(date -Is) daily-sync: starting (repo: $REPO_ROOT)"
} >>"$LOG_FILE"

status=0
# `pixi run pipeline sync` already runs in pipeline/, which is where the
# watermark lives — the state file is deliberately relative so it stays with
# the checkout (pipeline/src/bundestrack/config.py:38). Losing it turns the
# next sync into a full backfill against that same WAF.
pixi run --manifest-path "$REPO_ROOT/pixi.toml" pipeline sync >>"$LOG_FILE" 2>&1 || status=$?

echo "$(date -Is) daily-sync: finished with status $status" >>"$LOG_FILE"
exit "$status"
