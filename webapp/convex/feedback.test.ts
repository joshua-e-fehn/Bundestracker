import { describe, expect, test } from "bun:test"
import { rejectionFor } from "./feedback"

/**
 * The intake's abuse gate.
 *
 * `bun test` has no Convex runtime, so the mutation itself is not callable
 * here. That is the constraint `convex/userPreferences.test.ts` and
 * `convex/votes.test.ts` work under, and the same answer applies: the rule is
 * pulled out as a pure function and the handler around it is plumbing.
 *
 * The feature's *structural* guarantees — that the diagnostics validator stays
 * closed, that the publishing query never selects the contact column, that the
 * retention sweep is actually scheduled — are asserted in
 * lib/feedback-boundaries.test.ts, which reads the source. They live there
 * rather than here because they need `node:fs`, and a `convex/` module that
 * imports a Node builtin is a bundling failure waiting to happen even when the
 * file is a test.
 */

const DEFAULTS = {
  clientReportsToday: 0,
  deploymentReportsToday: 0,
  dwellMs: 60_000,
  honeypot: "",
}

describe("rejectionFor", () => {
  test("accepts an ordinary report", () => {
    expect(rejectionFor(DEFAULTS)).toBeNull()
  })

  test("refuses a filled honeypot", () => {
    expect(rejectionFor({ ...DEFAULTS, honeypot: "http://spam.example" })).toBe("honeypot")
    // Whitespace is not a fill — an autofill that types a space must not lock
    // a real reporter out.
    expect(rejectionFor({ ...DEFAULTS, honeypot: "   " })).toBeNull()
  })

  test("refuses a submission faster than a person could type", () => {
    expect(rejectionFor({ ...DEFAULTS, dwellMs: 0 })).toBe("too-fast")
    expect(rejectionFor({ ...DEFAULTS, dwellMs: 1999 })).toBe("too-fast")
    expect(rejectionFor({ ...DEFAULTS, dwellMs: 2000 })).toBeNull()
  })

  test("caps one browser's daily reports", () => {
    expect(rejectionFor({ ...DEFAULTS, clientReportsToday: 4 })).toBeNull()
    expect(rejectionFor({ ...DEFAULTS, clientReportsToday: 5 })).toBe("too-many-from-client")
  })

  test("caps the whole deployment, which is the control that actually holds", () => {
    // The per-client key is resettable by clearing storage; this one is not
    // reachable by the caller at all.
    expect(rejectionFor({ ...DEFAULTS, deploymentReportsToday: 199 })).toBeNull()
    expect(rejectionFor({ ...DEFAULTS, deploymentReportsToday: 200 })).toBe(
      "too-many-for-deployment",
    )
  })

  test("reports the more fundamental reason when both caps are hit", () => {
    // An operator reading the table should see "the deployment is saturated",
    // not "this one browser was chatty".
    expect(rejectionFor({ ...DEFAULTS, clientReportsToday: 99, deploymentReportsToday: 999 })).toBe(
      "too-many-for-deployment",
    )
  })

  test("the honeypot outranks every other reason", () => {
    // A filled honeypot says the most about the caller, so it is the reason
    // recorded even when the caps would also have refused.
    expect(
      rejectionFor({
        clientReportsToday: 99,
        deploymentReportsToday: 999,
        dwellMs: 0,
        honeypot: "x",
      }),
    ).toBe("honeypot")
  })
})
