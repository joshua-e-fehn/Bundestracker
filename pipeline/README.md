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
  api/          # httpx clients: DIP (read), Convex (write)
  models/       # pydantic models for DIP records and Convex documents
  pipeline/     # orchestration: fetch → transform → load
src/tests/      # pytest
```

Only `cli.py` and `config.py` are implemented — the rest are scaffolds awaiting
the pipeline work.

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
