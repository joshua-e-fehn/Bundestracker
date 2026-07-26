# Task — scaffold-monorepo

Scaffold the Bundestrack monorepo. Create the following structure:

1. Pixi root (pixi.toml) with these tasks:
   - dev: cd webapp && bun run dev
   - build: cd webapp && bun run build
   - pipeline: cd pipeline && python -m bundestrack.cli
   - lint: runs Ruff on pipeline/ and Biome on webapp/
   - format: runs Ruff format on pipeline/ and Biome format on webapp/
   - typecheck: cd webapp && bun run typecheck
   - test: runs pytest on pipeline/ and any JS tests on webapp/

2. Python pipeline directory (pipeline/):
   - pyproject.toml with Ruff config (linting + formatting), httpx, pydantic dependencies
   - src/bundestrack/__init__.py
   - src/bundestrack/cli.py (placeholder with click/argparse CLI structure)
   - src/bundestrack/config.py (env var loading: CONVEX_URL, BUNDESTAG_API_KEY, BUNDESTAG_API_BASE_URL)
   - src/bundestrack/api/ (empty __init__.py — will be filled by pipeline agents)
   - src/bundestrack/models/ (empty __init__.py)
   - src/bundestrack/pipeline/ (empty __init__.py)
   - src/tests/__init__.py
   - README.md

3. Next.js webapp (webapp/):
   - Initialize Next.js 16 with Bun (bun create next-app with App Router, TypeScript, Tailwind CSS, Turbopack)
   - Install: convex, @convex-dev/better-auth, better-auth, shadcn (radix-ui), lucide-react, tailwind-merge, clsx, class-variance-authority, next-themes, zod, @tanstack/react-query, framer-motion, tw-animate-css
   - Initialize shadcn/ui (components.json)
   - Initialize Convex (bunx convex init) in webapp/convex/
   - Initialize Biome (biome.json) for TS linting + formatting
   - Setup Better Auth:
     - webapp/convex/betterAuth/ (auth.ts, schema.ts, adapter.ts, convex.config.ts)
     - webapp/convex/auth.ts (getCurrentUser query)
     - webapp/convex/auth.config.ts
     - webapp/convex/http.ts (HTTP endpoint for auth + pipeline ingestion)
     - webapp/lib/auth-routes.ts (all paths public — PUBLIC_PATHS = ['/', '/sign-in', '/sign-up', '/api'])
     - webapp/proxy.ts (pass-through middleware, no auth gating)
     - webapp/providers/auth-provider.tsx (Better Auth client)
     - webapp/components/providers/auth-guard.tsx (client-side, optional auth)
   - Social providers: Google + GitHub OAuth (multi-user, NO single-user lockdown)
   - Environment variables template (.env.example): CONVEX_DEPLOYMENT, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SITE_URL
   - vercel.json with build script
   - scripts/convex-deploy-if-key.sh (same as cambridge tracker pattern)

4. Copy the exact Better Auth pattern from the Cambridge tracker at /opt/data/workspace/cambridge/webapp/convex/betterAuth/ and /opt/data/workspace/cambridge/webapp/convex/auth.ts — but REMOVE the single-user lockdown (no databaseHooks.user.create.before check). Make it multi-user. Add GitHub alongside Google in socialProviders.

5. Setup i18n foundation: lib/i18n.ts with DE as default locale, EN as secondary. Create a simple translation function (can use next-intl or a lightweight custom solution).

6. Commit everything and push to main branch.

IMPORTANT: Use bun exclusively (never npm/pnpm/yarn). Use bun.lock (Bun 1.2+). This is a monorepo — the root has pixi.toml, the webapp has package.json, the pipeline has pyproject.toml.
