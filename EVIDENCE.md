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
- Sibling-branch fixes relevant to a roster-writing run (`9958f9f`
  connection-reset retry, `ab46e85` omit-not-null enrichment, `b9398aa`
  per-period contact TTL) are not ancestors of `main` by SHA, but their
  behaviour is in `main` (landed via squash merges, e.g. #46/#55). Confirmed by
  their regression tests on this branch, which pass:
  `test_a_connection_reset_is_retried_rather_than_raised`,
  `test_a_roster_post_with_no_enrichment_omits_the_columns_rather_than_nulling_them`,
  `test_a_historical_backfill_does_not_mark_the_current_period_fresh`,
  `test_a_page_that_parsed_to_nothing_is_not_stamped_as_a_success`.

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

| `59112f0` | Review B1 (blocking): write-host pin moved into `Settings.require_convex_http_url` via `BUNDESTRACK_EXPECTED_DEPLOYMENT`; wrapper preflights through that code |
| `e4d2997` | Review L1/L2: writer regex admits CLI global options (`-v`); writer tests offline (no live `pgrep`); naive marks stored with `+00:00` |

Tests at `e4d2997`: 406 passed, none deselected, no dependence on the live process table. Mutation checks: disabling clamp/repair fails 5 tests; reverting F1 fails 2, F2 fails 1, F3 fails 2.

## 6. Scheduler (installed 2026-10-21 15:29 UTC)

- Host `srv1608974` (`Etc/UTC`): `/etc/systemd/system/bundestrack-daily-sync.{service,timer}`, installed from `ops/systemd/` at `5b77270`. `systemctl enable` done.
- Schedule: `OnCalendar=*-*-* 02:17:00 UTC`, `Persistent=true`. **Next run: Thu 2026-10-22 02:17:00 UTC.**
- Service: `docker exec hermes-agent-vspa-hermes-agent-1 /opt/data/bundestrack-release/current/scripts/daily-sync.sh`, with `BUNDESTRACK_REPO_ROOT=/opt/data/workspace/Bundestrack` and `BUNDESTRACK_SYNC_TIMEOUT=6h`.
- Code pinned: `/opt/data/bundestrack-release/current → 5b77270350467956ae4f7780cfa52a51c4f3f61c` (`RELEASE` file records it).
- Log: `/opt/data/workspace/Bundestrack/.logs/daily-sync.log`. Status: `/opt/data/workspace/Bundestrack/.logs/daily-sync.status.json`.
- State backup before catch-up: `.logs/bundestrack-state.pre-catchup-20261021T152518Z.json`.

### Activation of the approved code (2026-10-21 ~15:47 UTC, during run 1)

- **D1:** `scripts/release-pipeline.sh 59112f0` → `current → 59112f0039540914dceb2a03a5932c1807b7807a`.
  Run 1 is unaffected: its environment has
  `PYTHONPATH=/opt/data/bundestrack-release/5b77270…/pipeline/src` (resolved with `pwd -P` at start).
- **D2:** reinstalled `/etc/systemd/system/bundestrack-daily-sync.service` from
  the branch (identical to `59112f0`), then `daemon-reload`. sha256 prefix `a988383c3ab85f4d → 44375c2f7087b5ef`.
  `TimeoutStartUSec=6h 30min`, `ExecStartPre` container wait present, `Nice=0`.
  Timer `enabled`, next `Thu 2026-10-22 02:17:00 UTC`. Run 1's unit (MainPID 2376560) is still `activating`.

## 7. Catch-up run 1 (real execution via the scheduled unit)

- Started by `systemctl start --no-block bundestrack-daily-sync.service` at **2026-10-21 15:29:44 UTC**.
- Host unit MainPID (docker exec client): `2376560`. Container: wrapper bash PID `1516499`, pipeline `python -m bundestrack.cli sync` PID `1516543`.
- Log header: `starting pid=1516499 code=/opt/data/bundestrack-release/5b77270…@5b77270… state=/opt/data/workspace/Bundestrack/pipeline target=whimsical-bandicoot-307.convex.cloud timeout=6h`.
- Pre-flight: no other writer (`pgrep`), pipeline key health `GET /api/pipeline/health` → 200, read query OK, `convex deploy --dry-run` banner `joshua-fehn:bundestracker:production … whimsical-bandicoot-307` with no suspension/spending warning.
- Watermark repair applied and **saved before any stage**: `21:activities 2026-11-12T14:52:32+01:00 → 2026-07-20T15:56:04+01:00` (21:protocols 2026-07-27 minus 7 days). Other marks untouched.
- **Outcome: SUCCESS.** Exit 0 at **2026-10-21 16:15:23 UTC** (45 min 39 s). Host unit
  `Result=success ExecMainStatus=0`. `daily-sync.status.json`: `last_success`
  started 15:29:44 / finished 16:15:23, pid 1516499, `consecutive_failures: 0`.
  Every stage OK, 0 non-200 responses, 0 ERROR/Enodia/Traceback lines.

### Public /votes before catch-up (headless Chromium, 2026-10-21 ~15:40 UTC)

`chromium --headless --dump-dom https://www.bundestracker.de/votes` renders the
newest row as **sitting 90 (10.07.2026)**: "Erster Entschließungsantrag der
Linken zur GKV-Finanzreform | Sitting 90, vote 2", followed by the rest of
sitting 90, then 89 (09.07.2026) and 88 (08.07.2026). None of the 17 ballots
from 2026-09-24 → 2026-10-15 appear.

### Run 1 progress checkpoints

| UTC | Wrapper PID 1516499 / pipeline PID 1516543 | Progress (from `daily-sync.log`) |
|---|---|---|
| 15:37:03 | both alive, elapsed 07:18, started `Wed Oct 21 15:29:44 2026` | roster 3× `mps → 635 MPs (0 new, 635 updated)`; committees `1791 seats (0 new, 1791 updated)`; committee-referrals 33 batches posted, 221 `/vorgangsposition` pages read of ~278 (no stored `21:committee-referrals` mark, so this stream is a full read of 27 801 rows); activities/motions/speeches/votes not started |
| 15:40:21 | both alive, pipeline elapsed 10:36 | committee-referrals **done** (280 `/vorgangsposition` pages, all `0 new, N updated`); 3 dropped ambiguous ballot joins for sitting 99 (designed behaviour, `transform.ballot_vorgang_index`); activities in progress: 47 `/aktivitaet` pages, first **new** rows landing (`questions → 82 new`, `activity-events → 494 new`); every POST so far went to `whimsical-bandicoot-307.convex.site` (0 to any other host) |
| 15:43:10 | both alive, pipeline elapsed 13:25 | activities: 100 `/aktivitaet` pages of ~250 (~20 pages/min); 9839 new / 0 updated activity rows; 0 ERROR/Enodia/Traceback lines |
| 15:48:59 | both alive, pipeline elapsed 19:15 | activities: 260 pages; 14033 new / 9693 updated activity rows; now in the July overlap (`0 new, N updated`); 0 ERROR/Enodia/Traceback |
| 15:53:34 | both alive, pipeline elapsed 23:49 | activities stage **done** (261 pages; 14033 new / 9982 updated); no future-dated `aktualisiert` seen this run; motions: `8674 motions (2864 new, 5810 updated)`; drucksache pages 17; 0 ERROR/Enodia/Traceback. PR #74 CI on `e4d2997`: lint/typecheck/codegen/test/build **pass** |
| 15:57:57 | both alive, pipeline elapsed 28:12 | motions stage, sponsor sub-step: 1630 `/motion-sponsors` POSTs (one per motion with sponsors, ~5/s, bounded by the 8 674 motions written); 0 non-200 responses in the whole run; speeches/votes not yet started |

## 8. Merge and final release (2026-10-21 15:58:56 UTC)

- PR #74 squash-merged at exact head `e4d2997` (`--match-head-commit`, CI
  `lint · typecheck · test · build` pass, no admin bypass), at Joshua's
  explicit request, ahead of catch-up completion. Merge commit
  **`0aad07a0bdb2e6129adb879fd6185d049268bab8`** = `origin/main`; tree identical to `e4d2997`.
  Branch `fix-daily-ingestion` and this worktree kept.
- Release pinned: `/opt/data/bundestrack-release/current → 0aad07a…` (`RELEASE`
  records it); `pipeline/src` and `scripts` identical to the reviewed source.
- Host units = merged main: service sha256 `44375c2f7087b5ef`, timer `42a744d6ef337ce9`.
  Next tick **Thu 2026-10-22 02:17:00 UTC**.
- Run 1 untouched: its pipeline PID 1516543 keeps
  `PYTHONPATH=/opt/data/bundestrack-release/5b77270…/pipeline/src`.
- No frontend change in the PR (no `webapp/` files), so no Vercel deploy; no
  Convex function change, so no Convex deploy.

## 9. Known separate defect — every ballot shows "Ausstehend / Pending" (NOT fixed here)

Diagnosed separately (read-only) in
`/opt/data/reports/bundestracker-daily-freshness/pending-diagnosis.md`. Not part
of this freshness repair, and deliberately not expanded into it:

- `_ingest_ballot` (`sync.py`) never passes `result=` to `vote_sheet_payload`, and
  `ballot_vorgang_index` keeps DIP's `vorgang_id` but drops the matched
  `beschlusstenor`. Every stored ballot has `result: ""` (WP21 68/68, WP20 185/185),
  which the UI renders as "Ausstehend".
- **Consequence for this catch-up:** the new ballots it ingests (2026-09-24 →
  2026-10-15) will also carry `result: ""` and show "Ausstehend". Freshness (the
  ballots and their per-MP votes exist and are current) is fixed; the outcome
  badge is not. Outcomes must come from DIP's recorded `beschlusstenor`, never be
  inferred from the tally.
| 16:11:57 | both alive, pipeline elapsed 42:12 | motions stage **done** (5800 `/motion-sponsors` POSTs); speeches stage started at ~16:11: protocols fetched so far 21/103 21/102 21/101 21/100 21/099 ; 917 new / 0 updated speech segments; 0 non-200, 0 errors |

### Run 1 final report (verbatim summary, `daily-sync.log`)

```
sync WP21:
  watermark-repair: 21:activities: 2026-11-12T14:52:32+01:00 is in the future — rewound to 2026-07-20T15:56:04+01:00
  roster: 635 MPs (0 new, 635 updated, 2 requests)
  dip-persons: 832 DIP persons: 631 linked, 186 unmatched, 0 ambiguous; 4 roster MPs still have no DIP person id
  enrichment: 635 MPs (0 new, 635 updated); 2 mid-period entrants not yet in Stammdaten (Zschau 2026-07-20, Breilmann 2026-06-01)
  committees: 1791 committee seats (0 new, 1791 updated)
  committee-referrals: 8289 (1117 new, 7172 updated); 27804 steps scanned; 80 named-vote steps indexed
  activities: 24015 (14033 new, 9982 updated), 1900 skipped (DIP person not on roster)
    6781 questions (6002 new, 779 updated); 24015 feed events (14035 new); 57 vote explanations (10 new)
  motions: 8674 (2864 new, 5810 updated); 22021 sponsorships (13497 new, 8524 updated)
  speeches: 2324 speech segments (2324 new, 0 updated, 13 protocols); 9 protocols unchanged
  votes: 10625 vote records (10625 new); 17 ballots (17 new); stopped at already-ingested 21/90/8
  vote-scope: every vote record already carries its ballot's period
  dissent: roll-up scheduled for 635 members
  seating: 635 synthetic seats
  quarantine: 154 unresolved names held for a later sync
daily-sync: finished with status 0
```

**State after run 1** (`pipeline/.bundestrack-state.json`, `last_run 2026-10-21T16:15:23Z`):
every WP21 mark is a real observed DIP timestamp at or before the run start
(15:29:44 UTC), and none is in the future:
`21:activities 2026-10-21T13:52:10+02:00`, `21:motions 2026-10-21T17:19:25+02:00`
(= 15:19:25 UTC), `21:protocols 2026-10-20T13:29:22+02:00`,
`21:committee-referrals 2026-10-21T17:26:46+02:00` (= 15:26:46 UTC). WP21
ballot keys 68 → 85; the 17 new ones are sittings 96, 97, 99 and 102.

**Not caught up, with the reason:**
- *1900 activities skipped*: their DIP person has no roster match. This is the
  existing crosswalk boundary (§7.2); 4 roster MPs have no DIP id, and 2
  mid-period entrants are missing from the Stammdaten dump. They attach on a
  later sync once the source resolves.
- *Ballot outcomes*: the 17 new ballots carry `result: ""` and render
  "Ausstehend". This is a separate defect, see §9.

## 10. Verification after run 1

### Official vs production (read-only, measured 2026-10-21 16:15:49 UTC)

| Surface | Official | Production after run 1 | Before |
|---|---|---|---|
| Newest named ballot | 2026-10-15 (bundestag.de listing) | **2026-10-15**: 21/102/3 Unmiss, 102/2 Eunavfor Aspides, 102/4 BEHG | 2026-07-10 |
| WP21 ballots dated after 2026-07-10 | 17 | **17** | 0 |
| WP21 named ballots total | — | **85** (`getVoteSheetsPage.total`, `getChamberStats.namedVotes`) | 68 |
| Newest plenary protocol | 21/103, 2026-10-16 | speech feed newest **2026-10-16** | 2026-07-10 |
| Feed: motion / question | — | **2026-10-19 / 2026-10-21** | 2026-07-22 / 2026-07-29 |
| `getLatestIngestTime` | — | **2026-10-21 16:14:56 UTC** | 2026-07-30 18:51 |
| Future watermarks in state | — | **none** | `21:activities` 2026-11-12 |

Note: `getChamberStats.speeches` still reads 16 416. That is its own bounded
counter, not the speech table, and it was not part of this change. The speech
feed and the `speeches → 2324 new` load counts are the evidence for speeches.

### Live public /votes (headless Chromium, 2026-10-21 ~16:16 UTC)

`chromium --headless --dump-dom https://www.bundestracker.de/votes`, first rows:

```
Bundeswehreinsatz im Südsudan (Unmiss)                     | Sitting 102, vote 3 | 15/10/2026
Bundeswehreinsatz im Roten Meer (Eunavfor Aspides)         | Sitting 102, vote 2 | 15/10/2026
Änderung des Brennstoffemissionshandelsgesetzes            | Sitting 102, vote 4 | 15/10/2026
Entschließung zur Schienenausbaustrecke Hannover - Hamburg | Sitting 99, vote 10 | 09/10/2026
… sitting 99 votes 1–9 (08/10/2026), sitting 97 votes 1–3 (25/09/2026),
Klimaanpassung und Naturschutz im Grundgesetz verankern    | Sitting 96, vote 1  | 24/09/2026
Erster Entschließungsantrag der Linken zur GKV-Finanzreform | Sitting 90, vote 2 | 10/07/2026
```

The public page now leads with the authoritative latest ballots (2026-10-15),
matching the official listing one for one. Every row's outcome badge reads
**"Pending"** (50 occurrences on the page). That is the separate result defect
in §9, now visible on the 17 new ballots as well.

(DOM order per row is `date | title | sitting | outcome`; the first row is
`15/10/2026 | Bundeswehreinsatz im Südsudan (Unmiss) | Sitting 102, vote 3 | Pending`.)

## 11. Run 2 — second-run / idempotency check (merged release `0aad07a`)

- Started via the unit (`systemctl start --no-block`) at **16:16:46 UTC**,
  unit MainPID 2426483, wrapper PID 1560091, pipeline PID 1560143. Log header
  `code=/opt/data/bundestrack-release/0aad07a…@0aad07a… target=whimsical-bandicoot-307.convex.site`.
  Before starting, `pgrep` showed no other writers and the post-run-1 state was
  backed up to `.logs/bundestrack-state.post-run1-*.json`.
- **Exit 0 at 16:20:43 UTC (3 min 57 s)**. Status file `last_attempt`/`last_success`
  updated, pid 1560091, `consecutive_failures: 0`. 0 non-200 responses.
- No `watermark-repair` stage this time: nothing in the state was in the future.
- Result, compared with run 1:

| Stage | Run 1 | Run 2 |
|---|---|---|
| votes | 17 ballots / 10 625 records new | **0 / 0**. Stopped at the first listed sheet `21/102/4`; 1 sheet download |
| speeches | 2 324 new, 13 protocols | **0**. 2 protocols unchanged by `xml_hash`, 0 XML downloads |
| committee-referrals | 8 289 (1 117 new) | **0 posted**. 16 steps scanned in the 1 h overlap window |
| activities | 24 015 (14 033 new) | 29 (**1 new**, 28 updated). DIP records amended in the window since run 1 |
| motions | 8 674 (2 864 new) | 17 (**0 new**, 17 updated) |
| roster / committees | 635 / 1 791 updated | same. These are re-posted every run by design |

  The roster and committees upserts touch the same rows (`0 new`), and the few
  activity and motion rows are real upstream amendments in the overlap window,
  not duplicates. Every write is a natural-key upsert, and run 2 created no
  duplicate ballots or records. WP21 ballot keys stay at 85.
- State after run 2: `21:activities 2026-10-21T18:05:22+02:00`, `21:motions
  18:09:52+02:00`, `21:committee-referrals 18:10:23+02:00` (16:05–16:10 UTC, all
  before run 2's start at 16:16:47 UTC); `21:protocols 2026-10-20T13:29:22+02:00`.
  No mark is in the future.

## 12. Score coverage, Jul–Oct 2026

**Before** (read-only `activityScores:getRankings`, WP21, 16:17 UTC):

| month | rows | non-zero | max totalScore |
|---|---|---|---|
| period total | 635 | 634 | 2063.82 |
| 2026-07 | 635 | 633 | 333.59 |
| 2026-08 | 635 | 576 | 16.0 |
| 2026-09 | 635 | 576 | 16.0 |
| 2026-10 | 635 | 576 | 16.0 |

Aug, Sep and Oct each hold a uniform max of 16.0 across 576 MPs. That looks
like committee-only scores computed before any of the catch-up's activities,
speeches or votes existed. The nightly Convex sweep only rescores the *current*
month plus the period total. So Aug/Sep, and Jul, whose late-July records the
catch-up also added, would never be revisited.

**Action:** `pipeline scores --wp 21 --month M` for M = 2026-07, 08, 09, 10.
Each call also rescores the period total. Run by `/tmp/bt-freshness/rescore.sh`:

- PID 1563704, started 16:21:11 UTC, code `0aad07a`
- holds `.daily-sync.lock`, so the 02:17 tick or a manual sync cannot overlap
- `BUNDESTRACK_EXPECTED_DEPLOYMENT=whimsical-bandicoot-307`
- `pixi run --frozen`, 30 min bound per month
- log: `.logs/rescore-wp21-20261021.log`

It touches Convex only (no bundestag.de request) and covers only the four
current-period months the catch-up changed. No historical period is touched.

**After** (16:24 UTC; rescore exit 0 for every month, 0 non-200 responses, finished 16:23:50 UTC):

| month | rows | non-zero | max | median |
|---|---|---|---|---|
| period total | 635 | 634 | **2448.03** (was 2063.82) | 306.52 |
| 2026-07 | 635 | 633 | 336.59 | 115.0 |
| 2026-08 | 635 | **604** (was 576) | **97.0** (was 16.0) | 11.0 |
| 2026-09 | 635 | **633** (was 576) | **282.24** (was 16.0) | 116.27 |
| 2026-10 | 635 | **632** (was 576) | **287.08** (was 16.0) | 117.21 |

August is low on purpose: it is the summer recess, with no plenary sittings,
so there are only written questions and motions. The ~2–3 zero rows per month
are MPs with no recorded activity, or mandates that ended.

## 13. Acceptance summary

| Gate | Result |
|---|---|
| Freshness measured against official sources; absent upstream separated from failure | §1. All sources were reachable and publishing. The gap was ingestion |
| Root cause from scheduler, logs, env, code, state | §2: RC-1 no scheduler; RC-2 future-poisoned watermark |
| Focused regression tests | 406 pass at `0aad07a`. Mutation checks for every fix (§5) |
| Durable daily scheduling | §6/§8: host timer 02:17 UTC, `Persistent=true`, flock + writer check, 6 h bound with graceful stop, status file, pinned release `0aad07a`. **Next run Thu 2026-10-22 02:17 UTC** |
| Correct target only | Write host pinned in `Settings` (`whimsical-bandicoot-307.convex.site`). Every POST in runs 1 and 2 and in the rescore went to that host |
| Catch-up through real execution | §7: run 1 exit 0, all stages OK |
| Second-run / no-op safety | §11: run 2 exit 0. 0 new ballots, votes or speeches. Only upstream amendments in the overlap |
| Public `/votes` reflects the latest official ballot | §10: leads with sitting 102, 15/10/2026 = official newest |
| Scores / feed refreshed | §10 feed newest 2026-10-21. §12 Jul–Oct rescored |
| Merged and deployed | PR #74 → `0aad07a`, release pinned, units match main. No frontend or Convex change, so no Vercel/Convex deploy |

**Remaining gaps (disclosed, not fixed here):**

1. **Every ballot shows "Ausstehend / Pending"** (§9). This is a separate
   result-ingestion defect and includes the 17 new ballots.
2. 1 900 activities could not attach because 4 roster MPs have no DIP person
   id (DIP crosswalk).
3. 2 mid-period entrants are not yet in the Stammdaten dump (Zschau, Breilmann),
   and 154 quarantined names are held. All of these retry daily.
4. 40 MPs have no enrichment; the biography listing returned 0 profiles this run.
5. There is no push alert on failure. It is visible only as a failed unit plus
   the status file.
6. `getChamberStats.speeches` still reports 16 416 (separate counter; not investigated).
