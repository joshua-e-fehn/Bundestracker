import { describe, expect, test } from "bun:test"
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
