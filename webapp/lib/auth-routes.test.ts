import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { continueWithoutAccountTarget, isPublicPath } from "./auth-routes"

/**
 * Tests for the public-route list.
 *
 * Written after the bug they describe. `/mps` was added as a route and not
 * added here, and the failure mode is close to invisible: the page still
 * returns 200, the HTML still contains a full `<head>`, and the body is empty
 * because `AuthGuard` renders a spinner and then redirects a signed-out visitor
 * to /sign-in. Everything looks fine from a status code, and the site quietly
 * demands an account for the public record it exists to publish.
 *
 * So the assertion worth making is not "the list contains what it contains" but
 * "the sections that are supposed to be browsable signed-out are".
 */

describe("isPublicPath", () => {
  test("every browsable section is public", () => {
    // AGENTS.md: the platform is a public data dashboard, and signing in only
    // adds personalisation. Any page a reader can reach from the nav belongs
    // in this list.
    expect(isPublicPath("/")).toBe(true)
    expect(isPublicPath("/mps")).toBe(true)
    expect(isPublicPath("/mps/bt-0001")).toBe(true)
  })

  test("every route with a page under app/ is public", () => {
    // The list above is hand-written, so it only catches the routes someone
    // remembered to add to it — and this is a bug whose whole character is
    // being forgotten. `/seating` was the third route to hit it, after `/mps`
    // and `/rankings`.
    //
    // So this reads the filesystem instead: every directory under app/ holding
    // a page.tsx is a route a reader can navigate to, and every one of them
    // must be browsable signed out. A new page fails here on the commit that
    // adds it rather than in a browser weeks later. Route groups and private
    // folders are skipped — they do not appear in a URL — and so are dynamic
    // segments, which are covered by their parent's prefix.
    const appDir = new URL("../app/", import.meta.url).pathname
    for (const entry of readdirSync(appDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (/^[(_[@]/.test(entry.name)) continue
      if (entry.name === "api") continue
      if (!existsSync(join(appDir, entry.name, "page.tsx"))) continue
      expect(isPublicPath(`/${entry.name}`)).toBe(true)
    }
  })

  test("settings is public, because it has a signed-out rendering", () => {
    // The one route whose *contents* need an account, and still on the list.
    // Gating it would have `AuthGuard` redirect to /sign-in before the page
    // could say what an account is for — a bounce from a link visible in the
    // navigation, which is the same "silently demands an account" failure the
    // ⚠ in auth-routes.ts describes, arriving through the front door.
    //
    // Nothing leaks by this: every `userPreferences` function takes the user id
    // from the session and never as an argument, so a signed-out reader gets
    // the documented defaults rather than anyone else's data
    // (convex/userPreferences.ts, and the API-shape tests beside it).
    expect(isPublicPath("/settings")).toBe(true)
  })

  test("an id with an encoded character is still public", () => {
    // `internalId` is minted by the pipeline and reaches the guard already
    // decoded by Next. A prefix test on "/mps" covers it either way, but the
    // case is worth pinning: a guard that failed only for MPs with an unusual
    // id would be found by a reader, not by a developer.
    expect(isPublicPath("/mps/bt%2F0001")).toBe(true)
    expect(isPublicPath("/mps/Brand (Fulda)")).toBe(true)
  })

  test("Better Auth's own routes stay reachable while signed out", () => {
    // The callback cannot require a session; it is what creates one.
    expect(isPublicPath("/api/auth/callback/google")).toBe(true)
    expect(isPublicPath("/sign-in")).toBe(true)
  })

  test("a prefix match does not leak to a sibling with the same start", () => {
    // "/mps" must not make "/mpsecret" public. The matcher requires either
    // equality or a "/"-delimited prefix, which is what stops that.
    expect(isPublicPath("/mpsecret")).toBe(false)
    expect(isPublicPath("/api-internal")).toBe(false)
  })

  test("an unlisted path is gated, which is the point of the list", () => {
    // The day a genuinely private route arrives it is added by omission — see
    // the note in auth-routes.ts. This asserts omission still means gated.
    //
    // `/settings` used to be the example here, on the assumption that a
    // settings page is by definition private. It is not: the page renders for a
    // signed-out reader, saying what an account holds and linking to the
    // picker, so gating it would replace that explanation with a bounce to
    // /sign-in from a link visible in the navigation. A route with a signed-out
    // rendering is a public route; a hypothetical id stands in for the example
    // so the property is still asserted.
    expect(isPublicPath("/account/export")).toBe(false)

    // A URL matching no route at all is *also* false here, and that is correct
    // for this function: it answers "is this path on the public list", and a
    // nonexistent path is not.
    //
    // It is not, however, the whole answer to "may a signed-out reader see
    // this", and treating it as such was a real bug: a mistyped URL returned a
    // genuine 404, rendered app/not-found.tsx, and was then client-redirected
    // to /sign-in a beat later — so the site asked for an account before
    // admitting the page did not exist, and the app-wide 404 was unreachable.
    //
    // The fix is in components/providers/auth-guard.tsx, which treats Next's
    // `/_not-found` segment as public before consulting this list, rather than
    // a catch-all entry here that would defeat the omission rule above. Pinned
    // as a test so the distinction is not "fixed" later by widening the list.
    expect(isPublicPath("/this-route-does-not-exist")).toBe(false)
  })
})

/**
 * Where "Ohne Konto weiterlesen" sends the reader.
 *
 * The bug this replaces was reproduced end to end in a browser: from
 * example.com → /sign-in → click the button → back on example.com. The old test
 * was `window.history.length > 1`, which counts the tab's whole session
 * including other origins, so it was true for exactly the visit that must not
 * go back.
 */
describe("continueWithoutAccountTarget", () => {
  const ORIGIN = "https://www.bundestracker.de"

  test("goes back when the reader came from within the site", () => {
    // The case the button was written for: a reader who was browsing, hit
    // sign-in, and changed their mind wants the page they were on.
    expect(continueWithoutAccountTarget(`${ORIGIN}/mps`, ORIGIN)).toBe("back")
    expect(continueWithoutAccountTarget(`${ORIGIN}/`, ORIGIN)).toBe("back")
    expect(continueWithoutAccountTarget(`${ORIGIN}/mps/bt-11002735?tab=votes`, ORIGIN)).toBe("back")
  })

  test("goes home when back would leave the site", () => {
    // The reproduction, exactly. A visitor who clicks "continue without an
    // account" is asking to browse Bundestrack.
    expect(continueWithoutAccountTarget("https://example.com/", ORIGIN)).toBe("/")
    expect(continueWithoutAccountTarget("https://news.ycombinator.com/item?id=1", ORIGIN)).toBe("/")
  })

  test("treats a lookalike origin as external", () => {
    // Origin comparison, not a prefix or a hostname `includes` — the two
    // shortcuts that would send a reader "back" to somebody else's site.
    expect(continueWithoutAccountTarget("https://www.bundestracker.de.evil.com/", ORIGIN)).toBe("/")
    expect(continueWithoutAccountTarget("https://evil.com/www.bundestracker.de", ORIGIN)).toBe("/")
  })

  test("distinguishes scheme and port, which are part of an origin", () => {
    // Same host, different origin. On localhost the dev server and a preview on
    // another port are genuinely different sites to the browser.
    expect(continueWithoutAccountTarget("http://www.bundestracker.de/mps", ORIGIN)).toBe("/")
    expect(continueWithoutAccountTarget("http://localhost:3001/", "http://localhost:3000")).toBe(
      "/",
    )
    expect(continueWithoutAccountTarget("http://localhost:3000/mps", "http://localhost:3000")).toBe(
      "back",
    )
  })

  test("goes home when there is no referrer to judge", () => {
    // A pasted URL, a bookmark, or a link with rel="noreferrer". There may well
    // be history behind it, and none of it is knowably ours.
    expect(continueWithoutAccountTarget("", ORIGIN)).toBe("/")
  })

  test("declines a referrer it cannot parse rather than throwing", () => {
    // `document.referrer` is a browser-supplied string; a value that is not a
    // URL is one to decline, not to crash the only button on the page that
    // gets a reader out of the sign-in flow.
    expect(continueWithoutAccountTarget("not a url", ORIGIN)).toBe("/")
    expect(continueWithoutAccountTarget("///", ORIGIN)).toBe("/")
  })
})
