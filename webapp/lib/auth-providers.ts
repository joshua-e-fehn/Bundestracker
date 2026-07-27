/**
 * Which OAuth providers the sign-in page actually offers.
 *
 * One flag rather than a check in each consumer, for the reason
 * `lib/auth-routes.ts` keeps its list: the decision needs one home. Two
 * components ask this question — the sign-in panel, which greys out what is
 * unavailable, and `components/user-menu.tsx`, which used to bypass the whole
 * page by calling `signIn.social({ provider: "github" })` directly.
 *
 * ## Why GitHub is off
 *
 * Not because the backend lacks it. `convex/betterAuth/auth.ts` configures both
 * providers, so the code path exists end to end; what is missing is the OAuth
 * app — `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are unset on the deployment,
 * and Better Auth's failure for an unconfigured provider is a redirect to a
 * GitHub error page rather than an error this app can catch and explain.
 *
 * It stays *listed and disabled* rather than removed, so the button's arrival
 * is visibly a switch being flipped rather than a feature appearing. A build
 * cannot read Convex's environment — these credentials live on the Convex
 * deployment, not in `.env.local` (see webapp/.env.example) — so this is a
 * constant rather than an `process.env` read that would be `undefined` in the
 * browser and silently disable the provider everywhere.
 *
 * **To enable:** set the two Convex env vars, then flip this to `true`.
 *
 *   bunx convex env set GITHUB_CLIENT_ID <>
 *   bunx convex env set GITHUB_CLIENT_SECRET <>
 */
export const GITHUB_ENABLED = false

/** Google is configured and working — the one provider the picker offers. */
export const GOOGLE_ENABLED = true
