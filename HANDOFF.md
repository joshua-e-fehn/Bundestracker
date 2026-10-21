# Handoff — fix-daily-ingestion

Bundestracker daily freshness repair. Production stopped ingesting on
2026-07-30 for two reasons. No scheduler ever ran the daily sync. And a
future-dated DIP timestamp had poisoned the activities watermark, so even a
scheduled sync would have ingested nothing until mid-November. Both are fixed,
merged, live and exercised. Full evidence with real dates and counts is in
`EVIDENCE.md`; read that first.

## Done

- **Root causes** (`EVIDENCE.md` §1–2): there was no cron or timer in the
  container or on the host, and `21:activities` was set to
  `2026-11-12T14:52:32+01:00`. Every official source was reachable and
  publishing.
- **Merged:** PR #74 → `main` `0aad07a`, tree identical to the reviewed head
  `e4d2997`, CI green, no bypass.
- **Live code:** `/opt/data/bundestrack-release/current → 0aad07a`.
- **Scheduler:** host `srv1608974` (Etc/UTC) has
  `/etc/systemd/system/bundestrack-daily-sync.{service,timer}`, matching
  merged main (sha256 `44375c2f…` / `42a744d6…`). It runs daily at
  **02:17 UTC** with `Persistent=true`. Next run: **Thu 2026-10-22 02:17 UTC**.
- **Catch-up run 1** (scheduled unit, 15:29:44 → 16:15:23 UTC, exit 0, every
  stage OK): 17 new ballots and 10 625 vote records; 2 324 speech segments
  from 13 protocols; 14 033 new activities; 6 002 new questions; 2 864 new
  motions; 13 497 new sponsorships; 1 117 new committee referrals.
- **Verified live:** production's newest ballot is 2026-10-15 = official
  newest. 17/17 post-recess ballots are present. The public `/votes` page
  leads with sitting 102 (15/10/2026). No watermark is in the future.

- **Second run** (merged code `0aad07a`, 16:16:46 → 16:20:43 UTC, exit 0)
  created 0 new ballots, votes or speeches. It stopped at `21/102/4` and wrote
  only the upstream amendments inside the overlap window.
- **Scores:** WP21 2026-07..10 and the period total were rescored (exit 0).
  Sep/Oct max went from 16 to 282/287.

## In Progress

- Nothing. No pipeline process is running, and the working tree holds only
  these docs.

## Next

1. **Fix the "Ausstehend / Pending" result defect** (separate; see
   `EVIDENCE.md` §9 and
   `/opt/data/reports/bundestracker-daily-freshness/pending-diagnosis.md`).
   Every ballot, including the 17 new ones, stores `result: ""`.
2. Optional: wire `OnFailure=` to an alert. Today a failed run is visible only
   as a failed unit plus `daily-sync.status.json`.
3. Optional (review L3): put `BUNDESTRACK_EXPECTED_DEPLOYMENT=whimsical-bandicoot-307`
   in `pipeline/.env` so that manual runs are pinned too.

## Blockers

- None for freshness.
- Source-side limits that remain (not failures):
  - 1 900 activities name a DIP person with no roster match (4 roster MPs
    have no DIP id).
  - 2 mid-period entrants are missing from the Stammdaten dump (Zschau
    2026-07-20, Breilmann 2026-06-01).
  - 154 names are quarantined.
  - All of these retry on every daily run.

## Exact State

- **Code:** `origin/main` = `0aad07a` (PR #74). The branch `fix-daily-ingestion`
  is kept, along with this worktree. Docs follow-up: see the PR that carries
  this file.
- **Release:** `/opt/data/bundestrack-release/current → 0aad07a0bdb2e6129adb879fd6185d049268bab8`.
- **Scheduler:** host timer `enabled`, next run **Thu 2026-10-22 02:17:00 UTC**.
- **Last run:** `/opt/data/workspace/Bundestrack/.logs/daily-sync.status.json` →
  last_success 2026-10-21 16:20:43 UTC, consecutive_failures 0.
- **Tests:** passing, 406 (`pixi run test`, at `0aad07a`).
- **State backups:** `.logs/bundestrack-state.pre-catchup-20261021T152518Z.json`,
  `.logs/bundestrack-state.post-run1-*.json`.
- **Uncommitted changes:** none after the docs commit. `.vibe/TASK.md` is
  locally modified and deliberately left uncommitted.
