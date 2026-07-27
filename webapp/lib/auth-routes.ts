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
 * debugging session on it, and `/seating` then spent a third — which is why
 * lib/auth-routes.test.ts now reads `app/` and asserts that every directory
 * with a `page.tsx` is listed here, rather than trusting anyone to remember.
 * Until a genuinely private route exists, every content route belongs on this
 * list.
 */
export const PUBLIC_PATHS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/api",
  "/rankings",
  "/feed",
  "/seating",
  "/votes",
  // Not built on this branch — the MP pages belong to `frontend-mp-profiles` —
  // but listed because the feed and every leaderboard row links to
  // `/mps/<internalId>`, and a link that redirects to a 404 is worse than one
  // that reaches a page not yet written.
  "/mps",
  // The fourth route to be added without this entry — see the ⚠ above. The
  // voting explorer (PR #13) shipped with `app/votes/page.tsx` and no line
  // here, so `lib/auth-routes.test.ts` has been failing on main since: the
  // filesystem check that exists precisely to catch this caught it, and the
  // fix is the one line it was written to demand.
  "/votes",
  // The Fraktion comparison dashboard, and its `/parties/<key>` member lists —
  // covered by the prefix, like `/mps/<internalId>`. Caught by the filesystem
  // check on the commit that added the page rather than in a browser later,
  // which is the fifth time that test has earned its keep.
  "/parties",
  // The sixth, and the one the ⚠ above describes most exactly: the keyword
  // search (PR #24) shipped `app/search/page.tsx` with no line here, so every
  // reader following the header's search box — which is on *every* page — would
  // have been redirected to a 404 that looks like a broken route rather than a
  // guard. The filesystem check caught it here; nothing else would have.
  "/search",
  // The methodology page. Public for the same reason as everything above it,
  // and with a sharper edge: it is the page that explains what the figures mean
  // and what they do not, so gating it would put the site's own caveats behind
  // an account while leaving the numbers they qualify in the open.
  "/about",
]

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/**
 * Whether "continue without an account" may go *back* rather than to the home page.
 *
 * `components/sign-in-panel.tsx` called `router.back()` whenever
 * `window.history.length > 1`, which is true of almost every visit — including
 * one that arrived from another site. Reproduced: example.com → /sign-in →
 * "Ohne Konto weiterlesen" → back on example.com. A reader who clicks *continue
 * without an account* is saying they want to browse Bundestrack; ejecting them
 * to wherever they came from is the one outcome that cannot be what they meant.
 *
 * `history.length` is the wrong question because it counts the tab's whole
 * session, including entries from other origins, and the History API
 * deliberately exposes nothing about their URLs. `document.referrer` is what is
 * available, and it answers the question that matters: did the previous page
 * belong to this site?
 *
 * Three cases, and only the first may go back:
 *
 *  - **Same-origin referrer** — an internal navigation, so "back" is a
 *    Bundestrack page and going there is exactly right.
 *  - **Cross-origin referrer** — going back leaves the site. Home instead.
 *  - **Empty referrer** — a pasted URL, a bookmark, or a link with
 *    `rel="noreferrer"`. There may still be history to go back to, and it is
 *    not knowably ours, so home.
 *
 * Here rather than inline in the component so it can be tested without a DOM,
 * and beside `isPublicPath` because both answer "where may this reader be sent"
 * — the decision this module already owns.
 */
export function continueWithoutAccountTarget(
  /** `document.referrer` — an absolute URL, or "" when there is none. */
  referrer: string,
  /** `window.location.origin` — the origin the app is served from. */
  origin: string,
): "back" | "/" {
  if (!referrer) return "/"
  // `URL.canParse` rather than try/catch: a malformed referrer is a value to
  // decline, not an exception to handle.
  if (!URL.canParse(referrer)) return "/"
  return new URL(referrer).origin === origin ? "back" : "/"
}
