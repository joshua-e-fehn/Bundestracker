# Evidence — fix-daily-ingestion

Bundestracker daily freshness repair. Times are UTC unless a source offset is
shown. Measured 2026-10-21 14:50–15:20 UTC from the Hermes container, against
Convex **whimsical-bandicoot-307** (read-only public queries) and the official
Bundestag sources, fetched one at a time.

## 1. Official sources vs production (before repair)

| Surface | Official latest (measured 2026-10-21) | Production latest | Gap |
|---|---|---|---|
| Named votes (bundestag.de vote listing, XLSX) | **2026-10-15**: 3 ballots (Brennstoffemissionshandelsgesetz, Eunavfor Aspides, Unmiss). 17 WP21 ballots dated 2026-09-24 → 2026-10-15 | **2026-07-10**, sitting 21/90, ballot 8. `getVoteSheetsPage` total = **68** WP21 sheets | 17 published ballots missing |
| Plenary protocols (DIP `/plenarprotokoll`, WP21) | **21/103, 2026-10-16** (updated 2026-10-20T13:29+02:00); 103 protocols total | Newest speech feed event **2026-07-10** (sitting 90). 16 416 speech segments | ~13 sittings missing |
| Activities (DIP `/aktivitaet`, WP21) | 95 319 records; **23 997** updated since 2026-07-31 | Newest question/feed event **2026-07-29** | 3 months of updates missing |
| Motions (DIP `/vorgang` + `/drucksache`, WP21) | 19 352 Vorgänge (8 636 updated since 2026-07-31); 8 761 Drucksachen (1 522 since 2026-07-31) | Newest motion feed event **2026-07-22** | 3 months of updates missing |
| Committee referrals (DIP `/vorgangsposition`, WP21) | 27 801 (8 342 since 2026-07-31) | — | stale with the rest |
| Freshness widget (`activityEvents:getLatestIngestTime`) | — | **2026-07-30 18:51:12 UTC** | last write of any kind 83 days ago |

**Upstream publication is not the cause.** Every official source answered
(HTTP 200, no Enodia challenge) and is publishing new WP21 data through
2026-10-20. The gap is entirely on the ingestion side. Note the summer recess:
there were genuinely no plenary ballots between 2026-07-10 and 2026-09-24, so
the period 2026-07-10 → 2026-09-24 is *legitimately* empty for votes; the
missing ballots are the 17 from 2026-09-24 onward.

## 2. Root causes

### RC-1 — No daily scheduler exists anywhere (primary)

`scripts/daily-sync.sh` exists and documents a crontab line, but nothing ever
installed it:

- **Hermes container:** no `crontab` binary; `/opt/data/cron/jobs.json` holds
  11 Hermes jobs, none mention Bundestrack.
- **VPS host (srv1608974, `Etc/UTC`):** `crontab -l` → "no crontab for root";
  `/etc/cron.d` has no Bundestrack entry; `systemctl list-timers --all` lists 22
  timers, none Bundestrack.
- **The script never ran:** `/opt/data/workspace/Bundestrack/.logs/daily-sync.log`
  and `.daily-sync.lock` do not exist. `.logs/` holds only the July historical
  backfill logs.
- **State file confirms it:** `pipeline/.bundestrack-state.json` was last
  written **2026-07-31 01:12:01 UTC** (`last_run`), by the historical backfill.

Every row in production arrived through manual `init`/`backfill` runs in July.
Convex's own crons (`scoreSweep.startNightlySweep` 03:15 UTC) only re-score rows
already stored; they never fetch.

### RC-2 — A future-dated `aktualisiert` poisoned the activities watermark

`pipeline/.bundestrack-state.json` → `watermarks["21:activities"] =
"2026-11-12T14:52:32+01:00"` — **three weeks in the future today**, written on
2026-07-31, i.e. 3½ months ahead of the clock when it was stored.

`SyncState.advance` stores `max(aktualisiert seen)` with no bound against the
clock. DIP served at least one WP21 activity with that future timestamp during
the July run. Consequence for a daily sync:

- `since("21:activities")` = 2026-11-12T13:52:32+01:00. DIP returns
  **`numFound = 0`** for that window today (measured), and will keep returning
  nothing (or only other future-dated records) until 2026-11-12.
- So even with a scheduler, the activities stream — questions, sponsorships,
  §31 declarations, most of the feed — would have silently ingested **zero**
  records per day for ~3½ months, while exiting 0. That stage's watermark also
  never moves backwards (`advance` is monotonic by design), so the poison is
  self-preserving.

Source dates themselves must stay verbatim (they are the record); only the
*cutoff* derived from them has to be clamped to the run's start time.

### RC-3 — The vote stage's incremental stop is fine; it was simply never run

`load_votes(incremental=True)` pages newest-first and stops at the first stored
key. `ingested_ballot_keys["21"]` holds 68 keys, newest `21/90/8` — matching
production exactly. A sync run today would download the 17 new sheets and stop
at `21/90/8`. No parser change is needed for votes (listing parses cleanly,
2026-10-15 sheets have `has_data_sheet=True`).

### Reachability (for distinguishing absent-upstream from failure)

All five DIP endpoints, the vote listing and the protocol index answered on the
first attempt from this host on 2026-10-21. `api/base.py` already bounds WAF
retries (`DEFAULT_MAX_RETRIES = 5`, backoff 20 s → 300 s, then raises
`RateLimited`), and `_guard` records the stage as FAILED and the CLI exits
non-zero. The repair must keep that bounded and make the failure visible in the
scheduler's status record rather than loop.

## 3. Pre-run safety checks

- Convex target in `pipeline/.env`: `https://whimsical-bandicoot-307.convex.cloud`
  / `.convex.site` (and the pre-rotation backup agrees). Not Cambridge.
- Production read queries succeed (`votes:getVoteSheets`, `stats:getChamberStats`,
  `feed:getFeed`) → provider healthy for reads.
- No competing writer: `pgrep -af 'bundestrack|run-enrichment|daily-sync|pipeline'`
  → none. No historical backfill active (last backfill log 2026-07-30).
- Main checkout has unrelated uncommitted edits to
  `webapp/convex/_generated/server.{d.ts,js}` — not ours, preserved.
- Fixes on sibling branches **not** in `main` (checked, relevant to a stage
  that will run): `9958f9f` (connection-reset retry) — appears present in
  `api/base.py` on this branch already in equivalent form; `ab46e85` /
  `b9398aa` (enrichment nulling / contact TTL) — `state.py` on this branch
  already carries the period-keyed `contact_key`; to be confirmed before the
  catch-up run.

## 4. Repair plan (in progress)

1. **Clamp watermark advance to the run's start time** (`pipeline/state.py`),
   keep source `aktualisiert` values verbatim in payloads; repair an
   already-poisoned future mark on load. Regression tests.
2. **Durable daily scheduler** on the VPS host (systemd timer → `docker exec`
   into the Hermes container, which holds the checkout, pixi env and secrets):
   non-overlapping (`flock` in `daily-sync.sh`), bounded (`timeout`), persistent
   logs, last-success / last-failure status file.
3. **Catch-up run** of `sync` WP21 against whimsical-bandicoot-307, then a
   second run to prove no-op, then verify `/votes`.

Sections 5+ (repair evidence, run evidence, scheduler) are appended as they
happen.

## 5. Repair commits (branch `fix-daily-ingestion`)

| SHA | What |
|---|---|
| `4c39c2a` | Watermark clamp + poisoned-mark repair (reviewed: APPROVE) |
| `2398fe7` | Host systemd timer/service, wrapper (target pin, flock + pgrep, 6 h bound, status JSON), pinned release export |
| `7cab995` | Review F1–F5: mark = newest *observed* non-future timestamp (never run clock); evidence snapshotted before repair; naive timestamps read as UTC; repair step `_guard`ed; INFO vs WARNING; per-stream tests |
| `5b77270` | Wrapper: `pwd -P` code pin; writer pgrep anchored to real python processes |
| `3a5039e` | Scheduler review S1–S6: pin the `.convex.site` write host too; SIGTERM saves completed stages and exits 143; `pixi run --frozen`; wait for the container; wrapper tests collected by `pixi run test`; drop the misleading `Nice=` |

Tests at `3a5039e`: 384 passed (pipeline + wrapper, one `pytest`). Mutation checks: disabling clamp/repair fails 5 tests; reverting F1 fails 2, F2 fails 1, F3 fails 2.

## 6. Scheduler (installed 2026-10-21 15:29 UTC)

- Host `srv1608974` (`Etc/UTC`): `/etc/systemd/system/bundestrack-daily-sync.{service,timer}`, installed from `ops/systemd/` at `5b77270`. `systemctl enable` done.
- Schedule: `OnCalendar=*-*-* 02:17:00 UTC`, `Persistent=true`. **Next run: Thu 2026-10-22 02:17:00 UTC.**
- Service: `docker exec hermes-agent-vspa-hermes-agent-1 /opt/data/bundestrack-release/current/scripts/daily-sync.sh`, with `BUNDESTRACK_REPO_ROOT=/opt/data/workspace/Bundestrack` and `BUNDESTRACK_SYNC_TIMEOUT=6h`.
- Code pinned: `/opt/data/bundestrack-release/current → 5b77270350467956ae4f7780cfa52a51c4f3f61c` (`RELEASE` file records it).
- Log: `/opt/data/workspace/Bundestrack/.logs/daily-sync.log`. Status: `/opt/data/workspace/Bundestrack/.logs/daily-sync.status.json`.
- State backup before catch-up: `.logs/bundestrack-state.pre-catchup-20261021T152518Z.json`.

## 7. Catch-up run 1 (real execution via the scheduled unit)

- Started by `systemctl start --no-block bundestrack-daily-sync.service` at **2026-10-21 15:29:44 UTC**.
- Host unit MainPID (docker exec client): `2376560`. Container: wrapper bash PID `1516499`, pipeline `python -m bundestrack.cli sync` PID `1516543`.
- Log header: `starting pid=1516499 code=/opt/data/bundestrack-release/5b77270…@5b77270… state=/opt/data/workspace/Bundestrack/pipeline target=whimsical-bandicoot-307.convex.cloud timeout=6h`.
- Pre-flight: no other writer (`pgrep`), pipeline key health `GET /api/pipeline/health` → 200, read query OK, `convex deploy --dry-run` banner `joshua-fehn:bundestracker:production … whimsical-bandicoot-307` with no suspension/spending warning.
- Watermark repair applied and **saved before any stage**: `21:activities 2026-11-12T14:52:32+01:00 → 2026-07-20T15:56:04+01:00` (21:protocols 2026-07-27 minus 7 days). Other marks untouched.
- Outcome: _(appended when the run exits)_
