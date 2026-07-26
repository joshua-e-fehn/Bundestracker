import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { isPublicPath } from "./auth-routes"

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
    expect(isPublicPath("/settings")).toBe(false)
  })
})
