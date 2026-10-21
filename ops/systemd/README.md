# Daily ingestion schedule (VPS host)

Production freshness depends on one thing running every day: the WP21
incremental sync. Until 2026-10-21 nothing ran it — `scripts/daily-sync.sh`
documented a crontab line that was never installed, and production froze at
2026-07-30 (see `EVIDENCE.md` on the `fix-daily-ingestion` branch).

## Shape

```
VPS host (srv1608974, Etc/UTC)
  bundestrack-daily-sync.timer      02:17 UTC daily, Persistent=true
  └─ bundestrack-daily-sync.service docker exec into the Hermes container
       └─ /opt/data/bundestrack-release/current/scripts/daily-sync.sh
            ├─ refuses any Convex read/write host but whimsical-bandicoot-307 (exit 78)
            ├─ flock .daily-sync.lock + pgrep for unlocked writers     (exit 75, skipped)
            ├─ timeout 6h (TERM, KILL +60 s)                           (exit 124)
            ├─ pixi run --frozen pipeline sync ← code: current/pipeline/src
            │                            ← env/state: /opt/data/workspace/Bundestrack
            ├─ log    /opt/data/workspace/Bundestrack/.logs/daily-sync.log
            └─ status /opt/data/workspace/Bundestrack/.logs/daily-sync.status.json
```

If the container is not answering (e.g. right after a boot), `ExecStartPre`
waits up to 10 minutes for it before the run is attempted. A timeout sends
SIGTERM; the pipeline then saves the marks of every completed stage before
exiting 143, so the next tick resumes rather than restarts.

**Failure visibility.** Every attempt is recorded in the status file, and a
failed or timed-out run leaves the unit `failed` (`systemctl --failed`). There
is no push alert yet. The host's existing alerters (`camsocs-alert@`,
`mya-backup-alert`) belong to other projects, so wiring one in is left to the
operator: add `OnFailure=` to the service.

The host never sees a secret: `pipeline/.env` stays in the container's
checkout. The timeout lives in the wrapper, not only in systemd, because
stopping `docker exec` does not stop the process it started.

`daily-sync.status.json` holds `last_attempt`, `last_success`, `last_failure`
and `consecutive_failures`. A skipped tick (lock held) updates only
`last_attempt`.

## Install / update

Inside the container (or any shell with the repo):

```bash
cd /opt/data/workspace/Bundestrack
git fetch origin && scripts/release-pipeline.sh <reviewed-commit>   # pins current → <sha>
```

On the host:

```bash
install -m 0644 /docker/hermes-agent-vspa/data/workspace/Bundestrack/ops/systemd/bundestrack-daily-sync.{service,timer} \
  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bundestrack-daily-sync.timer
systemctl list-timers bundestrack-daily-sync.timer
```

The unit files are read from the main checkout at install time only; editing
them there changes nothing until they are re-installed.

## Operate

```bash
# run now (non-blocking), then follow it
systemctl start --no-block bundestrack-daily-sync.service
journalctl -u bundestrack-daily-sync.service -f
docker exec hermes-agent-vspa-hermes-agent-1 tail -f /opt/data/workspace/Bundestrack/.logs/daily-sync.log

# last outcome
docker exec hermes-agent-vspa-hermes-agent-1 cat /opt/data/workspace/Bundestrack/.logs/daily-sync.status.json

# pause (e.g. during a historical backfill — the wrapper also skips on its own)
systemctl stop bundestrack-daily-sync.timer
```

A failed stage (an official source unreachable, an Enodia block that outlasts
the bounded retries in `api/base.py`) ends the run non-zero and is recorded as
`last_failure`; the failed stream keeps its watermark and is re-read by the
next tick. It does not loop.
