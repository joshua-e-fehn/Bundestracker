/**
 * The single source of truth for which routes are reachable without a session.
 *
 * On Bundestrack that is *every* route. The platform is a public dashboard of
 * public parliamentary data: browsing MPs, motions and activity scores never
 * requires an account. Signing in only adds personalisation — custom score
 * weightings and a follow list — so there is nothing here to gate.
 *
 * The list is kept, rather than collapsed to a `return true`, because the
 * decision needs one home. Its consumer today is
 * `components/providers/auth-guard.tsx`, which does the actual session check
 * and also catches a session expiring while the app is open. `proxy.ts` does
 * not import it — with every path public there is nothing for middleware to
 * ask, and a call whose answer is always the same reads as a gate that works.
 *
 * When a genuinely private route arrives (an account settings page, say), it
 * is added by *omission*: drop "/" from this list and enumerate the public
 * ones. The guard starts gating with no change; `proxy.ts` is where the
 * import goes back if the redirect should also happen before render.
 *
 * Note the matcher only treats "/" as an exact match: for path "/" the prefix
 * test becomes startsWith("//"), which never fires for a normal pathname. So
 * "/" alone would not make the whole site public — the explicit `PUBLIC_PATHS`
 * entries below do that, and "/api" is among them because Better Auth's own
 * callback routes live under it and must stay reachable while signed out.
 *
 * ⚠ **A new page must be added here or it is not reachable.** That consequence
 * follows from the exact-match note above and is easy to miss, because the
 * failure does not look like an auth problem: `AuthGuard` redirects to
 * `/sign-in`, which does not exist yet, so the page renders a 404 and the
 * obvious suspect is the route itself. `/rankings` and `/feed` each spent a
 * debugging session on it. Until a genuinely private route exists, every
 * content route belongs on this list.
 */
export const PUBLIC_PATHS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/api",
  "/rankings",
  "/feed",
  // Not built on this branch — the MP pages belong to `frontend-mp-profiles` —
  // but listed because the feed and every leaderboard row links to
  // `/mps/<internalId>`, and a link that redirects to a 404 is worse than one
  // that reaches a page not yet written.
  "/mps",
]

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}
