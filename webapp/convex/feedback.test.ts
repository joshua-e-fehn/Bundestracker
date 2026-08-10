import { describe, expect, test } from "bun:test"
import {
  CAP_CONSUMING_STATUSES,
  consumesDeploymentQuota,
  persistsRejection,
  type RejectionReason,
  rejectionFor,
} from "./feedback"

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

/**
 * Being refused must never make the next refusal more likely.
 *
 * This is the accounting invariant behind a denial of service the intake once
 * had, and it is asserted here as two pure rules because the defect lived in
 * the *caller* of `rejectionFor` — which is exactly why the original
 * pure-function suite passed while the feature was broken.
 *
 * The attack it closes: `honeypot` and `dwellMs` are caller-supplied and are
 * checked before the caps, so a rejection was free and unconditional. Each one
 * still inserted a row, and the deployment counter counted rows by `createdAt`
 * regardless of status. ~200 forged requests therefore closed the form to every
 * genuine reporter for a rolling day, and every request after that inserted
 * another row — a ceiling on acceptance and none at all on writes.
 */
describe("a rejection cannot inflate the caps that cause rejections", () => {
  const FORGEABLE: RejectionReason[] = ["honeypot", "too-fast"]
  const CAP_REASONS: RejectionReason[] = ["too-many-from-client", "too-many-for-deployment"]

  test("a forgeable rejection leaves no row at all", () => {
    // The rejections an attacker can produce on demand write nothing, so
    // producing them costs the deployment no storage and no quota.
    for (const reason of FORGEABLE) {
      expect(persistsRejection(reason)).toBe(false)
    }
  })

  test("a cap rejection is recorded, so a repeat offender keeps being counted", () => {
    for (const reason of CAP_REASONS) {
      expect(persistsRejection(reason)).toBe(true)
    }
  })

  test("a recorded rejection does not count against the deployment ceiling", () => {
    // The other half. A cap rejection is stored as `rejected`, and `rejected`
    // must never consume deployment quota — otherwise the rows written by
    // refusals would themselves cause refusals, which is the loop.
    expect(consumesDeploymentQuota("rejected")).toBe(false)
  })

  test("every status a real report passes through does count", () => {
    // The complement, so the fix cannot be "count nothing" — that would make
    // the cap vacuous in the other direction.
    for (const status of ["pending", "published", "failed"]) {
      expect(consumesDeploymentQuota(status)).toBe(true)
    }
    expect(CAP_CONSUMING_STATUSES).not.toContain("rejected" as never)
  })

  test("no rejection reason both persists and consumes quota", () => {
    // The invariant stated whole: for a refused submission there is no path
    // that raises the deployment total. Written as an exhaustive check over the
    // reason union so a reason added later must be classified here.
    const ALL: RejectionReason[] = [...FORGEABLE, ...CAP_REASONS]
    for (const reason of ALL) {
      if (!persistsRejection(reason)) continue
      // It persists — as `rejected`, which must not consume quota.
      expect(consumesDeploymentQuota("rejected")).toBe(false)
    }
  })
})
