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
 * The OAuth app is missing: `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are unset
 * on the Convex deployment, and Better Auth's failure for an unconfigured
 * provider is a redirect to a GitHub error page rather than an error this app
 * can catch and explain.
 *
 * The button stays *listed and disabled* rather than removed, so its arrival is
 * visibly a switch being flipped rather than a feature appearing. A build cannot
 * read Convex's environment — these credentials live on the deployment, not in
 * `.env.local` (see webapp/.env.example) — so this is a constant rather than a
 * `process.env` read that would be `undefined` in the browser and silently
 * disable the provider everywhere.
 *
 * ## This flag and the backend's are two halves
 *
 * `convex/betterAuth/auth.ts` used to register GitHub unconditionally, so the
 * backend answered `POST /api/auth/sign-in/social {"provider":"github"}` with a
 * 200 and a URL containing `client_id=undefined` — a broken flow advertised by
 * an endpoint, even with no user-reachable path to it. It now registers the
 * provider only when both env vars are set, so an unconfigured deployment
 * answers 404 PROVIDER_NOT_FOUND like any other unknown provider.
 *
 * The two flags cannot be one: this constant is compiled into the browser
 * bundle and the credentials are only visible to Convex. This one decides
 * whether the button is offered; that one decides whether the provider exists.
 *
 * **To enable:** set the two Convex env vars — which is all the backend needs —
 * then flip this to `true` so the button becomes clickable.
 *
 *   bunx convex env set GITHUB_CLIENT_ID <>
 *   bunx convex env set GITHUB_CLIENT_SECRET <>
 */
export const GITHUB_ENABLED = false

/** Google is configured and working — the one provider the picker offers. */
export const GOOGLE_ENABLED = true
