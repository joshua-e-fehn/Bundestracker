# Bundestrack pipeline

Fetches parliamentary activity from the Bundestag Open Data API (DIP),
normalises it, and writes it into Convex.

## Why Python talks to a TypeScript database

The database is Convex, and Convex has no Python client. The bridge is Convex's
HTTP API: this pipeline POSTs to `/api/pipeline/*` on the deployment, which is
routed by `webapp/convex/http.ts` to internal mutations that upsert the records.
Requests authenticate with a shared key in an `Authorization: Bearer` header —
separate from Better Auth, because a browser session is not a thing a cron job
can obtain.

Ingestion upserts on the DIP record id, so a sync that dies halfway can simply
be re-run.

## Layout

```
src/bundestrack/
  cli.py        # click entry point: init / sync / backfill / scores / status
  config.py     # environment → Settings (pydantic-settings)
  api/          # httpx clients, one per source (see below)
  models/       # pydantic models for each source's wire format
  pipeline/     # orchestration: fetch → transform → load
    join.py       # the MP identity layer — three id spaces onto one
    transform.py  # pure model → Convex payload functions
    load.py       # the Convex HTTP ingestion client
    sync.py       # the stages, in the order the joins allow
    state.py      # the watermark, the quarantine, the document hashes
src/tests/      # pytest, against fixtures recorded from the live sources
```

## How a run is ordered, and why

The order is a dependency graph, not a preference (§11.1) — and Convex
enforces it, because every ingestion mutation rejects a record naming an MP who
is not on the roster:

1. **MdB-Stammdaten ZIP** → the roster, the internal ids, the name index,
   committees. Everything else joins to this.
2. **DIP `/person`** → the `dipPersonId` crosswalk, matched by folded name
   (§7.2, 99.1 %).
3. **DIP `/aktivitaet`** → activities, questions, sponsorships, the feed.
4. **DIP `/vorgang` + `/drucksache`** → motions, deduplicated on the procedure.
5. **Protocol XML** → speech segments, gated on `xml_hash`.
6. **Named-vote XLSX** → ballots and per-MP votes — the only source with
   absences (§4.2).
7. **Seating** → regenerated from the roster. Synthetic; §9 is definitive that
   no real seat assignment is published anywhere.

Stages 2–7 are independent of each other, so one source being down does not
cost the rest of the run: each reports its own outcome and the command exits
non-zero if any failed.

**Unmatched names are quarantined, never dropped.** The Stammdaten dump lags
reality (§7.3) — two MPs in a July 2026 ballot were missing from it entirely —
and a dropped vote row is a vote that silently never happened. `state.json`
holds them and every sync retries them against the fresher roster.

**The watermark is the max `aktualisiert` actually seen**, not wall-clock time,
overlapped by an hour for clock skew (§11.2). A clock-based watermark drops any
record whose timestamp fell between the query and the run finishing, and the
next window starts after it — so the record never comes back.

## The four sources

No single API answers "what did this MP do?", so `api/` has one client per
source. `docs/api-research.md` is the reference for all of them, and every
client cites the section a non-obvious decision comes from.

| Client | Source | Gives you |
| --- | --- | --- |
| `DIPClient` | `search.dip.bundestag.de/api/v1` | Vorgänge, Drucksachen, Aktivitäten, Personen, protocol metadata |
| `ProtocolClient` | `dserver.bundestag.de/btp/…` | Speaker-attributed speeches, **and** roll-call name lists |
| `VoteClient` | `bundestag.de/resource/blob/…` | Per-MP yes/no/abstain/**absent** |
| `StammdatenClient` | MdB-Stammdaten ZIP | The MP roster, mandates, committees |
| `AbgeordnetenwatchClient` | `abgeordnetenwatch.de/api/v2` | Validation, and mid-period successions |

Backfill order is not arbitrary: Stammdaten first, because it is the roster and
the name index everything else resolves against, then DIP `/person`, then the
rest (§11.1).

### Two constraints worth knowing before you touch `api/`

**Fetch sequentially.** Every `*.bundestag.de` host sits behind a bot-protection
WAF that IP-blocks *all* of them at once, including the unauthenticated OpenAPI
spec, and did not clear across an hour of backoff (§2.6). `BundestagClient`
enforces this: it paces requests, never follows redirects, and raises
`ConcurrentFetchError` if a second thread starts a request while one is in
flight. That is deliberate — serialising behind a lock would let a threaded
caller look correct while doubling the request rate.

**MPs have three incompatible ids.** DIP `/person` uses a short numeric id, the
Stammdaten dump and the protocol XML share an 8-digit one, and the vote sheets
have no id column at all (§7). Speeches and activities join by id; everything
else joins by name, via `models.stammdaten.NameIndex` — 628/630 on a real
ballot. Resolve once at ingest and store the crosswalk; never join on names at
query time.

## Configuration

Read from the environment, or a `.env` file in this directory:

| Variable                  | Required | Meaning                                              |
| ------------------------- | -------- | ---------------------------------------------------- |
| `CONVEX_URL`              | to write | `https://<deployment>.convex.cloud`                   |
| `CONVEX_HTTP_URL`         | no       | `https://<deployment>.convex.site` — derived from `CONVEX_URL` unless the deployment has a custom domain |
| `BUNDESTAG_API_KEY`       | yes      | DIP API key (the Bundestag publishes a public one)    |
| `BUNDESTAG_API_BASE_URL`  | no       | Defaults to `https://search.dip.bundestag.de/api/v1`  |
| `PIPELINE_API_KEY`        | to write | Must match `PIPELINE_API_KEY` on the Convex deployment |
| `BUNDESTRACK_STATE_PATH`  | no       | Where the watermark and quarantine live. Defaults to `.bundestrack-state.json` |

⚠ A Convex deployment answers on **two** hosts, and `/api/pipeline/*` is on the
`.convex.site` one: anything registered on the `httpRouter` is served from the
site URL, while `.convex.cloud` serves the generated client API. Posting to the
wrong host returns a 404 that looks exactly like a missing route, so the
pipeline converts one to the other rather than making you set both.

`pixi run pipeline status` prints the resolved configuration — including the
last watermark and the quarantine size — without making a single API call. It
is the quickest way to tell whether a cron host is set up and keeping up.

## Running

From the repo root, via Pixi:

```bash
pixi run pipeline status            # print config, touch nothing
pixi run pipeline init              # full backfill of the current period
pixi run pipeline sync              # daily incremental (what the cron runs)
pixi run pipeline backfill --wp 20  # one named electoral period
pixi run pipeline scores            # recompute activity scores now
pixi run pipeline --dry-run sync    # fetch and transform, write nothing
```

`init` on WP21 is **hours**: 80 537 activities over ~806 pages, 90 protocols
and every named ballot, fetched strictly sequentially because the WAF blocks a
pipeline that hurries (§2.6). It is resumable — every write is an upsert on a
natural key, so a run that dies is re-run rather than repaired.

`scores` is worth running after a backfill. The nightly Convex cron recomputes
the current month plus each MP's period total, so a backfill's older months
would otherwise stay at zero until something touched them.

Or directly, inside this directory:

```bash
python -m bundestrack.cli sync
```

The daily sync runs from a system cron that calls `pixi run pipeline sync`.
Convex's own crons handle in-Convex aggregation (score recomputation, ranking
updates); the API fetch happens here.

## Development

```bash
pixi run lint      # ruff check
pixi run format    # ruff format + safe fixes
pixi run test      # pytest
```
