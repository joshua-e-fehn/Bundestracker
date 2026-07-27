import { createClient } from "@convex-dev/better-auth"
import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js"
import { convex } from "@convex-dev/better-auth/plugins"
import type { GenericCtx } from "@convex-dev/better-auth/utils"
import type { BetterAuthOptions } from "better-auth"
import { betterAuth } from "better-auth"
import { components } from "../_generated/api"
import type { DataModel } from "../_generated/dataModel"
import authConfig from "../auth.config"
import schema from "./schema"

// Better Auth Component
//
// `components.betterAuth` is typed as `AnyComponentReference` until `convex dev`
// has run against a deployment — codegen falls back to `AnyComponents` when it
// cannot reach one, which drops the `adapter` property `createClient` requires.
// The assertion restores the real shape from the type the package ships for
// exactly this purpose, so the repo typechecks from a clean clone with no
// deployment configured. It is not a widening: `ComponentApi` is the same type
// codegen writes into betterAuth/_generated/component.ts once a deployment exists.
export const authComponent = createClient<DataModel, typeof schema>(
  components.betterAuth as unknown as ComponentApi<"betterAuth">,
  {
    local: { schema },
    verbose: false,
  },
)

// Better Auth Options
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  return {
    appName: "Bundestrack",
    baseURL: process.env.SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    // The browser calls the auth API from the Next.js origin while this
    // backend runs on Convex, so that origin has to be trusted explicitly.
    // `registerRoutes(http, createAuth, { cors: true })` in convex/http.ts
    // reads this same list to build its Access-Control-Allow-Origin — one
    // source of truth for "who may talk to auth", set per deployment:
    //   bunx convex env set SITE_URL https://bundestrack.example
    trustedOrigins: [process.env.SITE_URL ?? "http://localhost:3000"],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      // OAuth only. Bundestrack stores no passwords, so there is no reset
      // flow, no password table use, and no email deliverability to own.
      enabled: false,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      // GitHub is registered only when it has credentials.
      //
      // It used to be listed unconditionally with `process.env.GITHUB_CLIENT_ID!`
      // — a non-null assertion that promises at compile time a value the
      // deployment does not hold at runtime. The result was a backend that
      // advertised a provider it could not complete:
      //
      //   POST /api/auth/sign-in/social {"provider":"github"}
      //   → 200  https://github.com/login/oauth/authorize?…&client_id=undefined
      //
      // An unknown provider correctly returns 404 PROVIDER_NOT_FOUND; GitHub
      // slipped through only because it was *registered* with undefined values.
      // Nothing user-reachable led there — the button is genuinely `disabled`
      // (components/sign-in-panel.tsx) — but an endpoint that answers 200 with a
      // broken URL is worse than one that says the provider does not exist.
      //
      // Spreading a conditional rather than gating on `GITHUB_ENABLED` in
      // lib/auth-providers.ts: that constant is compiled into the *browser*
      // bundle and cannot read Convex's environment, which is where these
      // credentials live. So the frontend flag says whether to offer the button
      // and this says whether the provider exists at all — and setting the two
      // env vars is what flips this half, with no deploy.
      ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: process.env.GITHUB_CLIENT_ID,
              clientSecret: process.env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
    },
    // No `databaseHooks.user.create.before` gate here, deliberately.
    // Bundestrack is a public dashboard and signing in is *optional* — an
    // account only buys custom score weightings and a follow list. Anyone may
    // create one, so every Google/GitHub account that completes the OAuth
    // callback gets a user row. (The Cambridge tracker this pattern came from
    // locks itself to the first account; that restriction is intentionally
    // absent.)
    plugins: [convex({ authConfig })],
  } satisfies BetterAuthOptions
}

// For `auth` CLI
export const options = createAuthOptions({} as GenericCtx<DataModel>)

// Better Auth Instance
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth(createAuthOptions(ctx))
}
