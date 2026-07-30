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
 * When a genuinely private route arrives, it is added by *omission*: drop "/"
 * from this list and enumerate the public ones. The guard starts gating with no
 * change; `proxy.ts` is where the import goes back if the redirect should also
 * happen before render.
 *
 * That note used to name "an account settings page, say" as the example. The
 * settings page now exists and is **public**, which is not a retreat from the
 * rule — it is what the rule asks for once you look at what the page does. It
 * renders for a signed-out reader too, saying what an account holds and linking
 * to the picker (components/settings-page.tsx). Gating it would replace that
 * explanation with a redirect to `/sign-in` from a link the reader can see in
 * the navigation: the guard would fire *before* the page could say why, which
 * is exactly the "silently demands an account" failure the ⚠ below describes,
 * arriving through the front door instead of by accident. A route that has a
 * signed-out rendering is not a private route.
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
 * `/sign-in`, so an omitted route silently becomes a sign-in prompt for a page
 * that needs no account, and the obvious suspect is the route itself.
 * `/rankings` and `/feed` each spent a debugging session on it, and `/seating`
 * then spent a third — which is why lib/auth-routes.test.ts now reads `app/`
 * and asserts that every directory with a `page.tsx` is listed here, rather
 * than trusting anyone to remember. Until a genuinely private route exists,
 * every content route belongs on this list.
 *
 * (That redirect used to land on a 404, because `/sign-in` was listed here
 * before the page existed. `app/sign-in/page.tsx` has existed since, so the
 * symptom is now a sign-in panel rather than a missing page — the same bug,
 * wearing the disguise the entry was always meant to give it.)
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
  // The dashboard — the stats row, both leaderboards, the Fraktionen, the
  // ballots and the feed, which is what `/` was before the narrative page took
  // that route. Public for the reason everything above it is, and with the
  // sharpest version of the ⚠: it is now the *only* route showing several of
  // those sections in one place, and it is linked from the header and the
  // footer of every page on the site. Omitting it here would send every reader
  // who clicked "Dashboard" to a 404 that looks like a broken route.
  //
  // The three `/home-*` candidates that used to be listed here are gone: `/`
  // is Concept A, and B and C were deleted with their components. That is the
  // resolution the note they carried anticipated — "each goes when its concept
  // does — either deleted, or promoted to `/`, in which case the existing '/'
  // entry already covers it."
  "/dashboard",
  // The Untersuchungsausschuss quorum calculator, and the eighth time the
  // filesystem check has caught this before a browser did — it failed on the
  // commit that added `app/inquiry-quorum/page.tsx` with no line here, and
  // again when this merge dropped that line. Public like everything else: the
  // page is arithmetic over the public roster, and the one figure on it that is
  // not official is marked as ours rather than hidden behind an account.
  "/inquiry-quorum",
  // The motions list. Ninth time the filesystem check has demanded this line —
  // it fails on the commit that adds `app/motions/page.tsx` without it. Public
  // like everything else: DIP's procedure records are open data, and the page
  // links out to the same PDFs anyone can fetch unauthenticated.
  "/motions",
  // The committees directory (§6.3 of docs/api-research.md is the source
  // reasoning; convex/committees.ts opens with the WP21-only caveat that
  // reaches the reader here). Tenth time the filesystem check has demanded a
  // line on this file. Public like everything else: Stammdaten publishes the
  // membership list openly, and this route is the reachable rendering of it.
  // The prefix covers `/committees/<name>` for the same reason `/mps` covers
  // profile pages.
  "/committees",
  // The reader's own saved choices — weights, language, follow list. The one
  // route on this site whose *contents* need an account, and still public,
  // because the page has a signed-out rendering that explains what an account
  // is for and links to `/sign-in`. Gating it would send a reader who clicked
  // "Einstellungen" in the navigation to a sign-in prompt with no explanation,
  // and the explanation is the whole point of the branch. See the note above,
  // and components/settings-page.tsx.
  //
  // Nothing is leaked by this: every `userPreferences` function takes the user
  // id from the session and never as an argument (convex/userPreferences.ts),
  // so a signed-out reader loading this page gets the documented defaults —
  // no weights, no follows — rather than anyone else's.
  "/settings",
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
