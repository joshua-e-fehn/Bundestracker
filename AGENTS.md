# AGENTS.md

> Repo-specific contract for any coding agent working here. `CLAUDE.md` is a
> symlink to this file. The shared vibe protocol lives in `.vibe/PROTOCOL.md`
> and is imported below — keep this file for what is true of *this repo only*.

@.vibe/PROTOCOL.md

## Project Overview

Bundestracker is an objective activity tracker for members of the German
Bundestag — a "GitHub contributions graph for MPs." It surfaces transparent,
measurable parliamentary activity from official public data: motions,
speeches, votes, questions, committee work. No subjective scoring — every
metric is backed by Bundestag records.

The platform is public (no auth required to browse). Optional Better Auth
(Google + GitHub OAuth) lets logged-in users save custom activity score
weightings and follow specific MPs.

Bilingual: German (default) and English.

## Techstack

- **Pixi** is the monorepo root. All tasks — Python and JS/TS — are defined
  in `pixi.toml` and run via `pixi run <task>`. Pixi manages both the Python
  environment and delegates to Bun for JS/TS.
- **Next.js 16** (App Router, Turbopack) renders the frontend. All pages are
  server components by default; client components only where interactivity is
  needed (charts, filters, auth state). Lives in `webapp/`.
- **Convex** is the backend — schema, queries, mutations, real-time
  subscriptions, scheduled crons. Lives in `webapp/convex/`. The Convex
  deployment URL is set via `CONVEX_DEPLOYMENT` env var.
- **Better Auth** via `@convex-dev/better-auth` handles authentication.
  Google + GitHub OAuth, multi-user (no single-user lockdown). Auth is
  optional — all pages are publicly browsable. AuthGuard is client-side only;
  `proxy.ts` (Next.js middleware) lets all requests through. Auth config in
  `webapp/convex/betterAuth/auth.ts`, options in `webapp/convex/auth.ts`.
- **shadcn/ui + Tailwind CSS** for the component library. Components in
  `webapp/components/`, configured via `webapp/components.json`.
- **Python** (httpx + pydantic) is the data pipeline. Fetches from the
  Bundestag Open Data API, transforms, and writes to Convex via HTTP API
  mutations. Lives in `pipeline/`.
- **Ruff** lints and formats Python. **Biome** lints and formats TS/JS.
- **Bun** is the only JS/TS package manager. Never use npm/pnpm/yarn.
  Lockfile is `bun.lock` (Bun 1.2+).

## Non-obvious structure

- The data pipeline is Python but the database is Convex (TypeScript).
  The bridge is Convex's HTTP API: the Python pipeline POSTs to
  `https://<deployment>.convex.cloud/api/mutation` to call mutations
  that ingest data. The Convex HTTP endpoint is defined in
  `webapp/convex/http.ts` (same pattern as the Cambridge tracker).
- `proxy.ts` is intentionally a pass-through — it does NOT gate routes.
  All paths are public. Auth state is managed client-side via AuthGuard.
  This is deliberate: the platform is a public data dashboard.
- Better Auth tables (user, session, account, verification) live in the
  Better Auth component's schema, not in the main Convex schema. The main
  schema references users by their Better Auth user ID (string), not by a
  local `v.id("user")`.
- The pipeline runs daily via a system cron that executes
  `pixi run pipeline sync`. Convex crons handle in-Convex aggregation
  (score recomputation, ranking updates) but the actual API fetch happens
  in Python.
- i18n: German is the default locale. All user-facing strings must be
  bilingual (DE/EN). The language toggle is in the navigation bar.

## Operational commands

### Pixi (monorepo root)
```bash
pixi run dev          # Start Next.js dev server (Turbopack)
pixi run build        # Build the webapp for production
pixi run pipeline     # Run the Python data pipeline
pixi run lint         # Run Ruff (Python) + Biome (TS)
pixi run format       # Format all code (Ruff format + Biome format)
pixi run typecheck     # TypeScript type check
pixi run test         # Run all tests (Python + JS)
```

### Frontend (webapp/)
```bash
cd webapp
bun install           # Install JS dependencies
bun run dev           # Next.js dev server with Turbopack
bun run build         # Production build (includes Convex deploy if key present)
bun run lint          # Biome lint
bun run format        # Biome format
bun run typecheck     # tsc --noEmit
```

### Convex (webapp/convex/)
```bash
cd webapp
bunx convex dev       # Start Convex dev mode (watches schema, auto-deploys)
bunx convex deploy    # Deploy Convex to production
```

### Python Pipeline (pipeline/)
```bash
cd pipeline
python -m bundestrack.cli init      # Initial backfill (full fetch of current WP)
python -m bundestrack.cli sync      # Daily incremental sync
python -m bundestrack.cli backfill --wp 20   # Backfill specific electoral period
ruff check .          # Lint
ruff format .        # Format
```

- Third-party source is vendored under `.vibe/sources/`. To read a
  dependency's real implementation instead of guessing, run
  `vibe vendor <pkg>`. Prefer this over recalling the API from memory.