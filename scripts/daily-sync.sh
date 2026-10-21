#!/usr/bin/env bash
# Daily incremental sync, for a scheduler.
#
# Wraps `pixi run pipeline sync` with what a scheduler does not give you: an
# environment, a lock, a bounded runtime, a log, and a status record. Run it
# from anywhere — it resolves the repo from its own location rather than the
# working directory, because schedulers start in $HOME or /.
#
# Production schedule: `ops/systemd/bundestrack-daily-sync.{service,timer}` on
# the VPS host, which `docker exec`s this script inside the Hermes container
# (that is where the checkout, the pixi env and pipeline/.env live). See
# ops/systemd/README.md for install and verification.
#
# Exit code is the pipeline's own: non-zero when any stage failed, so the
# timer's OnFailure= and the status file see a broken source rather than
# silence. See pipeline/src/bundestrack/cli.py — a run where most stages
# worked still fails, which is what keeps a broken source from staying broken.
#
# Exit codes of its own:
#   75  EX_TEMPFAIL  another writer holds the lock; nothing was attempted
#   78  EX_CONFIG    wrong or unreadable configuration; nothing was attempted
#   124              the run exceeded BUNDESTRACK_SYNC_TIMEOUT and was stopped
set -euo pipefail

# Two roots, usually the same directory:
#   CODE_ROOT  the tree this script shipped in — its pipeline/src is what runs.
#   REPO_ROOT  the checkout holding the pixi env, pipeline/.env, the state file
#              and the logs. BUNDESTRACK_REPO_ROOT points it elsewhere, which is
#              how production runs a pinned export of a reviewed commit
#              (ops/systemd/README.md) against the live checkout's state —
#              rather than whatever happens to be uncommitted in that checkout.
#
# `pwd -P`: resolved through the release's `current` symlink once, here, so a
# release flipped mid-run cannot change which code a running sync imports.
CODE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPO_ROOT="${BUNDESTRACK_REPO_ROOT:-$CODE_ROOT}"
LOG_DIR="${BUNDESTRACK_LOG_DIR:-$REPO_ROOT/.logs}"
LOG_FILE="$LOG_DIR/daily-sync.log"
STATUS_FILE="${BUNDESTRACK_STATUS_FILE:-$LOG_DIR/daily-sync.status.json}"
LOCK_FILE="${BUNDESTRACK_LOCK_FILE:-$REPO_ROOT/.daily-sync.lock}"
# The one deployment this repo's pipeline may write to. Several Convex
# deployments share credentials on this host (another app's among them), and a
# wrong-but-valid target answers every write with success — so the target is
# pinned here rather than trusted from whichever .env happens to be present.
EXPECTED_CONVEX_DEPLOYMENT="${BUNDESTRACK_EXPECTED_DEPLOYMENT:-whimsical-bandicoot-307}"
# Bounded runtime. A normal day is minutes; a multi-week catch-up is ~1–2 h of
# paced DIP paging. Six hours covers the largest catch-up measured and still
# ends long before the next tick, so a hung fetch cannot hold the lock forever.
SYNC_TIMEOUT="${BUNDESTRACK_SYNC_TIMEOUT:-6h}"
PIXI="${BUNDESTRACK_PIXI:-pixi}"

mkdir -p "$LOG_DIR"

# Schedulers' PATH is typically /usr/bin:/bin, which has neither pixi nor bun.
export PATH="$HOME/.pixi/bin:$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

log() { echo "$(date -Is) daily-sync: $*" >>"$LOG_FILE"; }

# One JSON object, rewritten atomically after every attempt. `last_success` and
# `last_failure` survive the attempts that do not touch them, so "when did this
# last work?" has an answer without reading the log.
write_status() {
  local outcome="$1" code="$2" started="$3" finished="$4"
  python3 - "$STATUS_FILE" "$outcome" "$code" "$started" "$finished" "$LOG_FILE" <<'PY'
import json, os, sys
path, outcome, code, started, finished, log = sys.argv[1:]
try:
    with open(path, encoding="utf-8") as f:
        status = json.load(f)
except (OSError, ValueError):
    status = {}
attempt = {"outcome": outcome, "exit_code": int(code), "started": started,
           "finished": finished, "log": log, "pid": os.getppid()}
status["last_attempt"] = attempt
if outcome == "success":
    status["last_success"] = attempt
    status["consecutive_failures"] = 0
elif outcome != "skipped":
    status["last_failure"] = attempt
    status["consecutive_failures"] = int(status.get("consecutive_failures", 0)) + 1
tmp = f"{path}.tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(status, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
PY
}

STARTED="$(date -Is)"

fail_config() {
  echo "daily-sync: $*" >&2
  log "CONFIG ERROR — $*"
  write_status config-error 78 "$STARTED" "$(date -Is)"
  exit 78 # EX_CONFIG
}

# Secrets live outside the repo — CONVEX_URL, PIPELINE_API_KEY and
# BUNDESTAG_API_KEY (pipeline/README.md § Configuration). `pipeline/.env` is
# read by pydantic-settings on its own; this is for hosts that keep them
# elsewhere, e.g. /etc/bundestrack.env owned by the scheduler user.
if [ -n "${BUNDESTRACK_ENV_FILE:-}" ]; then
  [ -r "$BUNDESTRACK_ENV_FILE" ] || fail_config "BUNDESTRACK_ENV_FILE is not readable: $BUNDESTRACK_ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$BUNDESTRACK_ENV_FILE"
  set +a
fi

command -v "$PIXI" >/dev/null 2>&1 || fail_config "pixi not on PATH (looked in $PATH)"

# Resolve the target the pipeline will actually use — the environment first,
# then pipeline/.env, which is exactly pydantic-settings' precedence — and
# refuse anything but the expected deployment. Only the host is compared; the
# value itself is never logged beyond it.
convex_url="${CONVEX_URL:-}"
if [ -z "$convex_url" ] && [ -r "$REPO_ROOT/pipeline/.env" ]; then
  convex_url="$(sed -n 's/^CONVEX_URL=//p' "$REPO_ROOT/pipeline/.env" | tail -n 1 | tr -d '"'"'"' ')"
fi
convex_host="${convex_url#https://}"
convex_host="${convex_host%%/*}"
[ "$convex_host" = "$EXPECTED_CONVEX_DEPLOYMENT.convex.cloud" ] \
  || fail_config "CONVEX_URL host is '${convex_host:-unset}', expected $EXPECTED_CONVEX_DEPLOYMENT.convex.cloud — refusing to write"

# Never two writers at once. Not politeness: every *.bundestag.de host sits
# behind a WAF that IP-blocks *all* of them when it sees concurrent requests,
# and it did not clear across an hour of backoff (docs/api-research.md §2.6).
# `-n` fails immediately rather than queueing a second full fetch behind a
# long one. Only this script takes the lock, so the process check below is what
# keeps it off a running backfill.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) daily-sync: another pipeline writer holds $LOCK_FILE — skipping this tick." \
    | tee -a "$LOG_FILE" >&2
  write_status skipped 75 "$STARTED" "$(date -Is)"
  exit 75 # EX_TEMPFAIL
fi

# Writers that do not take the lock — a bare `python -m bundestrack.cli
# backfill` or `scripts/run-enrichment.py` — are refused too. Two runs against
# one deployment overwrite each other's roster columns silently.
# Anchored to a Python interpreter at the start of the command line, so a shell
# or an editor whose command line merely *mentions* one of these does not make
# the scheduled run skip.
WRITER_PATTERN="${BUNDESTRACK_WRITER_PATTERN:-^[^ ]*python[0-9.]*( -[A-Za-z]+)* (-m bundestrack\.cli (sync|init|backfill)|[^ ]*/bin/bundestrack (sync|init|backfill)|[^ ]*(run-enrichment|score-period)\.py)}"
if pgrep -f "$WRITER_PATTERN" >/dev/null 2>&1; then
  echo "$(date -Is) daily-sync: an unlocked pipeline writer is running — skipping this tick." \
    | tee -a "$LOG_FILE" >&2
  pgrep -af "$WRITER_PATTERN" >>"$LOG_FILE" 2>&1 || true
  write_status skipped 75 "$STARTED" "$(date -Is)"
  exit 75
fi

# Which code is about to write production: a release export records its commit
# in RELEASE (it has no .git); a checkout is asked directly.
if [ -r "$CODE_ROOT/RELEASE" ]; then
  code_rev="$(head -n 1 "$CODE_ROOT/RELEASE")"
else
  code_rev="$(git -C "$CODE_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
fi

{
  echo "──────────────────────────────────────────────────────────────"
  log "starting pid=$$ code=$CODE_ROOT@$code_rev state=$REPO_ROOT/pipeline target=$convex_host timeout=$SYNC_TIMEOUT"
} >>"$LOG_FILE"

# Run the pipeline this script shipped with. Ahead of the editable install on
# sys.path, so for a plain checkout it is the same code either way.
export PYTHONPATH="$CODE_ROOT/pipeline/src${PYTHONPATH:+:$PYTHONPATH}"

status=0
# `pixi run pipeline sync` already runs in pipeline/, which is where the
# watermark lives — the state file is deliberately relative so it stays with
# the checkout (pipeline/src/bundestrack/config.py). Losing it turns the next
# sync into a full backfill against that same WAF.
#
# `timeout` sends TERM, then KILL a minute later. Every write is an upsert and
# the state file is written atomically, so a stopped run is resumed by the next
# tick rather than repaired.
timeout --kill-after=60 "$SYNC_TIMEOUT" \
  "$PIXI" run --manifest-path "$REPO_ROOT/pixi.toml" pipeline sync >>"$LOG_FILE" 2>&1 || status=$?

FINISHED="$(date -Is)"
if [ "$status" -eq 0 ]; then
  write_status success 0 "$STARTED" "$FINISHED"
elif [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
  write_status timeout "$status" "$STARTED" "$FINISHED"
else
  write_status failure "$status" "$STARTED" "$FINISHED"
fi
log "finished with status $status"
exit "$status"
