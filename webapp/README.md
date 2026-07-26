# webapp

The Next.js 16 frontend and the Convex backend that serves it.

Everything here runs through the repo root: Pixi owns the tasks and Bun is the
only JS package manager. See the root `README.md` for the full command list and
`docs/deployment.md` for how this is deployed.

```bash
pixi run dev        # dev server (Turbopack) — or `bun run dev` from here
pixi run build      # production build
pixi run typecheck  # tsc --noEmit
pixi run test       # pytest + bun test
```

`bun run build` needs `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`
at **build** time, not just at runtime — `lib/auth-server.ts` reads them while
Next.js collects page data. Run `bunx convex dev` once to have both written to
`.env.local`, and see `.env.example` for the rest, including which secrets
belong on the Convex deployment rather than in a file.

## Layout

| Path | What |
| --- | --- |
| `app/` | App Router pages — server components by default |
| `components/` | shadcn/ui components and the app's own |
| `convex/` | schema, queries, mutations, crons, the pipeline's HTTP ingestion API |
| `lib/` | i18n dictionaries, party colours, auth helpers, shared vocabularies |
| `providers/` | client-side context providers |
| `proxy.ts` | deliberate pass-through — every route is public |

A new page must be added to `lib/auth-routes.ts` or it is not reachable;
`lib/auth-routes.test.ts` enforces that.
