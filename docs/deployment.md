# Deployment

Bundestracker deploys as two halves that must know each other's URLs: the
Next.js frontend on **Vercel**, and the Convex backend that holds the data,
serves the ingestion API and runs Better Auth.

Neither half is useful alone, and the coupling runs in both directions — which
is the thing to understand before running any command below:

- Vercel needs the Convex URLs **at build time**, not only at runtime.
  `lib/auth-server.ts:22` reads them when the module loads, which happens while
  Next.js collects page data, so `bun run build` fails with
  `CONVEX_SITE_URL is not set` rather than deploying something broken.
- Convex needs the Vercel origin: `SITE_URL` is Better Auth's `baseURL` and its
  only trusted origin (`convex/betterAuth/auth.ts:33,41`).

So the first deployment is circular — the site URL is not known until Vercel has
assigned one. Deploy Convex first, deploy Vercel to learn the domain, then set
`SITE_URL` on Convex and redeploy it. Steps 1–6 are in that order.

## Current state

| Piece | State |
| --- | --- |
| Vercel project | **created** — `joshuas-projects-dc895e08/bundestracker` (`prj_70YQKuQQId0wWEBhqAPwht6I03KT`) |
| `NEXT_PUBLIC_SITE_URL`, `BUNDESTAG_API_KEY` on Vercel | **set** (production) |
| Convex project | **not created** — needs an interactive login, see below |
| Everything downstream of Convex | blocked on that |

### Why the Convex project is not created

`bunx convex deploy` creates a project on first run, but only for a logged-in
CLI, and `convex login` is a device flow that ends in a browser. The token in
`~/.convex/config.json` expired on 2026-07-20 (`/api/dashboard/teams` returns
401 `AccessTokenInvalid`), and the CLI declines to create anything in anonymous
mode.

There *are* Convex deploy keys in 1Password (`Mya` vault, item `Convex`), but
they belong to **cambridge-tracker**: `convex deploy --dry-run` with the prod
key reports `joshua-fehn:cambridge-tracker:production`, and the dev key matches
the `CONVEX_DEPLOYMENT` in Cambridge's own `.env.local`. Deploying Bundestrack's
schema with them would push this app's functions over another live app's
backend. They are the wrong keys, not a shortcut.

Run this once, on a machine with a browser, as the account that should own the
project:

```bash
cd webapp && bunx convex login
```

Then steps 1–6 run unattended.

## 1. Create and deploy the Convex production backend

```bash
cd webapp
bunx convex deploy          # creates the project on first run
```

Note the deployment name it prints. The two URLs derive from it, and they are
**different hosts serving different things** — `.convex.cloud` is the client
API, `.convex.site` is the HTTP router (Better Auth's callbacks and the
pipeline's `/api/pipeline/*`). Posting to the wrong one 404s in a way that
looks exactly like a missing route.

## 2. Set the secrets on Convex

Better Auth runs *inside* Convex, so these belong to the deployment. A value put
on Vercel instead is simply never read.

```bash
cd webapp
bunx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
bunx convex env set PIPELINE_API_KEY   "$(openssl rand -base64 32)"
bunx convex env set GOOGLE_CLIENT_ID     <id>      # 1Password: Mya → "Google OAuth"
bunx convex env set GOOGLE_CLIENT_SECRET <secret>
bunx convex env set GITHUB_CLIENT_ID     pending   # no OAuth app registered yet
bunx convex env set GITHUB_CLIENT_SECRET pending
```

`SITE_URL` is deliberately not set here — it needs the domain from step 4.

Keep `PIPELINE_API_KEY`; the cron host needs the same value in step 6, and
`convex/http.ts:58` compares against it on every ingestion request.

## 3. Give Vercel the Convex URLs

`CONVEX_DEPLOY_KEY` is what makes a build deploy Convex as part of itself
(`webapp/scripts/convex-deploy-if-key.sh`); without it the build skips the
Convex half, which is what preview builds want and production never does.
Generate one in the Convex dashboard under *Settings → Deploy keys*.

```bash
cd webapp
vercel env add NEXT_PUBLIC_CONVEX_URL      production  # https://<deployment>.convex.cloud
vercel env add NEXT_PUBLIC_CONVEX_SITE_URL production  # https://<deployment>.convex.site
vercel env add CONVEX_DEPLOY_KEY           production  # prod:<deployment>|<key>
```

## 4. Deploy the frontend

```bash
cd webapp && vercel --prod
```

`vercel.json` already pins bun as the install command and `bun run build` as the
build, matching the repo's package manager.

## 5. Close the loop

With the production domain known, point Convex back at it and redeploy so the
trusted origin and the OAuth callbacks are right:

```bash
cd webapp
bunx convex env set SITE_URL https://<domain>
bunx convex deploy
```

If the domain differs from the `NEXT_PUBLIC_SITE_URL` guessed at project
creation (`https://bundestracker.vercel.app`), update that on Vercel too and
redeploy — it is what the auth client and the `/api/auth` rewrite use.

Register both OAuth callbacks against the **Convex site** URL, not the Vercel
one; Better Auth serves them from Convex:

```
https://<deployment>.convex.site/api/auth/callback/google
https://<deployment>.convex.site/api/auth/callback/github
```

## 6. The data pipeline

Nothing is on the site until the pipeline has run — the deployment starts empty.
It runs from a host with a checkout, not from Vercel: `init` is hours of strictly
sequential fetching (docs/api-research.md §2.6), which no serverless function
will sit through.

Environment for that host (see `pipeline/README.md`):

```bash
CONVEX_URL=https://<deployment>.convex.cloud
PIPELINE_API_KEY=<the value from step 2>
BUNDESTAG_API_KEY=<DIP key>
```

```bash
pixi run pipeline status   # prints resolved config, makes no API call
pixi run pipeline init     # full backfill, hours
```

Then schedule the daily incremental. `scripts/daily-sync.sh` is the cron entry
point — it fixes up `PATH`, takes a lock so two syncs can never overlap (the WAF
IP-blocks on concurrent requests, §2.6), logs to `.logs/`, and exits non-zero if
any stage failed:

```cron
17 4 * * * /path/to/bundestrack/scripts/daily-sync.sh
```

Secrets can live outside the repo and be pointed at with
`BUNDESTRACK_ENV_FILE=/etc/bundestrack.env`.

## Verifying

```bash
curl -sI https://<domain>/ | head -1                  # 200
curl -s  https://<domain>/votes | grep -c Abstimmung  # non-zero once seeded
```

Sign-in is optional by design — every page must render signed out. A page that
redirects to a non-existent `/sign-in` is usually a missing entry in
`lib/auth-routes.ts`, not an auth fault; `lib/auth-routes.test.ts` guards it.
