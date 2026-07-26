# Bundestracker

Objective activity tracker for members of the German Bundestag. A "GitHub contributions graph for MPs" — transparent, measurable parliamentary activity based on publicly available official data.

## Structure

- `pipeline/` — Python data pipeline (fetches Bundestag API data, writes to Convex)
- `webapp/` — Next.js 16 + Convex + shadcn/ui frontend

## Tech Stack

- **Monorepo:** Pixi
- **Frontend:** Next.js 16, Bun, shadcn/ui, Tailwind CSS, Biome
- **Backend:** Convex
- **Auth:** Better Auth (convex-dev/better-auth), Google + GitHub OAuth
- **Data Pipeline:** Python (httpx, pydantic, Ruff)
- **i18n:** Bilingual DE/EN, German default

## Getting started

Prerequisites: [Pixi](https://pixi.sh) and [Bun](https://bun.sh) ≥ 1.2. Pixi
provides Python; Bun is not on conda-forge so it is installed separately.

```bash
pixi install          # solve and install the Python environment
pixi run install-web  # bun install in webapp/
```

Then point the webapp at a Convex deployment. This writes
`webapp/.env.local` and generates `convex/_generated/`:

```bash
cd webapp && bunx convex dev
```

Both `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` are required at
**build** time, not only at runtime — `bun run build` fails without them. See
`webapp/.env.example`, which also lists the auth secrets; those are set on the
Convex deployment with `bunx convex env set`, not in a file.

## Commands

Every task runs from the repo root through Pixi, covering both languages:

```bash
pixi run dev          # Next.js dev server (Turbopack)
pixi run build        # Production build of the webapp
pixi run pipeline     # Python data pipeline, e.g. `pixi run pipeline sync`
pixi run lint         # Ruff (Python) + Biome (TS)
pixi run format       # Ruff format + Biome, with safe fixes
pixi run typecheck    # tsc --noEmit
pixi run test         # pytest + bun test
```

Each has a per-language half if you want just one: `lint-python`, `lint-web`,
`test-python`, `test-web`, and so on.

Bun is the only JS package manager here — never npm, pnpm or yarn. The lockfile
is `bun.lock`.

## Auth

Signing in is **optional**. Every page is browsable without an account: the
platform is a public dashboard of public parliamentary data. An account (Google
or GitHub) only saves custom activity-score weightings and a list of followed
MPs.

That makes the deployment multi-user by design — anyone who completes the OAuth
callback gets an account. `webapp/proxy.ts` is a deliberate pass-through and
gates nothing; see `webapp/lib/auth-routes.ts`.

## How the Python pipeline reaches a TypeScript database

Convex has no Python client. The pipeline POSTs to `/api/pipeline/*` on the
deployment, routed by `webapp/convex/http.ts` to mutations that upsert records,
authenticating with a shared key in an `Authorization: Bearer` header. Details
in `pipeline/README.md`.

The daily sync runs from a system cron calling `pixi run pipeline sync`. Convex's
own crons handle in-Convex aggregation; the API fetch happens in Python.
