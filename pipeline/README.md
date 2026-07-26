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
  cli.py        # click entry point: init / sync / backfill / status
  config.py     # environment → Settings (pydantic-settings)
  api/          # httpx clients, one per source (see below)
  models/       # pydantic models for each source's wire format
  pipeline/     # orchestration: fetch → transform → load
src/tests/      # pytest, against fixtures recorded from the live sources
```

`pipeline/` is still a scaffold; everything else is implemented.

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
| `BUNDESTAG_API_KEY`       | yes      | DIP API key (the Bundestag publishes a public one)    |
| `BUNDESTAG_API_BASE_URL`  | no       | Defaults to `https://search.dip.bundestag.de/api/v1`  |
| `PIPELINE_API_KEY`        | to write | Must match `PIPELINE_API_KEY` on the Convex deployment |

`pixi run pipeline status` prints the resolved configuration without making a
single API call — the quickest way to tell whether a cron host is set up.

## Running

From the repo root, via Pixi:

```bash
pixi run pipeline status            # print config, touch nothing
pixi run pipeline init              # full backfill of the current period
pixi run pipeline sync              # daily incremental (what the cron runs)
pixi run pipeline backfill --wp 20  # one named electoral period
pixi run pipeline --dry-run sync    # fetch and transform, write nothing
```

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
