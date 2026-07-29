# webapp

Next.js 16 (App Router, Turbopack) + Convex + shadcn/ui. The repo-level story —
what Bundestracker is, how the Python pipeline reaches a TypeScript database —
is in the root `README.md` and `AGENTS.md`; this file covers what is specific to
running the frontend.

Bun is the only JS package manager here. Never npm, pnpm or yarn: the lockfile
is `bun.lock`, and another manager would resolve a different dependency tree
than the one CI tests.

## Bootstrap

A fresh clone needs one command:

```bash
bun install
```

That is enough to run `bun run lint`, `bun run typecheck` and `bun test` — every
gate passes on a clean checkout with **no Convex credentials**, because
`convex/_generated/` and `convex/betterAuth/_generated/` are committed. See
below for why.

To run the app you also need a Convex deployment:

```bash
bunx convex dev     # writes .env.local, regenerates convex/_generated/
bun run dev
```

`NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` are needed at
**build** time, not only at runtime — `lib/auth-server.ts` validates them while
Next.js collects page data, so `bun run build` fails without them. See
`.env.example`, which also lists the auth secrets; those are set on the Convex
deployment with `bunx convex env set`, not in a file.

## Why `convex/_generated/` is committed

It is derived code, and derived code is normally ignored. It is committed here
because it **cannot be re-derived without deployment credentials**:

```
$ bunx convex codegen
✖ No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project
```

and supplying a deployment name is not enough either — the full `api.d.ts` and
the Better Auth component's `component.ts` are built from a deployment's own
analysis of the pushed modules, so the command needs access to that project.
Convex's CLI says as much in its own help text: *"This code is generated
automatically while running `npx convex dev` and should be committed to the repo
(your code won't typecheck without it!)"*.

While these files were gitignored, a clean checkout could not typecheck (46
`tsc` errors — `Cannot find module '@/convex/_generated/api'` and the
implicit-`any` cascade behind it) and five Convex test suites failed to import
`./_generated/server`. That put a Convex login between a new contributor — or
CI, or a fork's pull request — and the ability to run the gates at all.

The cost of committing derived code is that it can go stale silently, so
`bun run check:codegen` (also `pixi run check-codegen`, and a step in CI) asserts
the checked-in `api.d.ts` still lists every module under `convex/`. That is the
only way these files drift *without* a deployment: every signature in `api.d.ts`
is a `typeof import(...)` resolved from source at typecheck time, so renaming an
argument cannot desync it — but adding `convex/foo.ts` leaves `api.foo` missing,
and the error surfaces at the call site rather than naming codegen.

After adding or removing anything under `convex/`, regenerate and commit:

```bash
bunx convex dev --once
```

## Commands

```bash
bun run dev            # dev server (Turbopack)
bun run build          # production build; deploys Convex if CONVEX_DEPLOY_KEY is set
bun run build:full     # always deploys Convex first
bun run lint           # Biome lint
bun run format         # Biome format
bun run check          # Biome format + safe fixes + organise imports
bun run typecheck      # tsc --noEmit
bun run check:codegen  # committed Convex codegen still matches convex/
bun test               # bun test
```

Each is also reachable from the repo root through Pixi (`pixi run lint`,
`typecheck`, `test`, `build`, `check-codegen`), which is what CI runs — so the
gates a pull request faces cannot drift from the ones you run locally.
