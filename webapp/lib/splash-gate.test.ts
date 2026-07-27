import { describe, expect, test } from "bun:test"
import { shouldRunSplash } from "./splash-gate"

/**
 * Tests for the opening animation's gate.
 *
 * The gate is the part with a wrong answer nobody sees. Failing *open* — a
 * splash that runs when it should not — is visible and gets reported; failing
 * *closed* is invisible, and an animation nobody can reproduce is one nobody
 * can fix. So both directions are asserted, and each of §6's three refusals has
 * its own case rather than being covered incidentally by another.
 */

describe("shouldRunSplash", () => {
  test("runs for a first-time visitor with no objections", () => {
    expect(shouldRunSplash({ reduceMotion: false, saveData: false, alreadySeen: false })).toBe(true)
  })

  test("never runs under reduced motion", () => {
    // §9: skipped entirely, not shortened. Reduced motion is the resting state,
    // and the resting state of a splash is its absence.
    expect(shouldRunSplash({ reduceMotion: true })).toBe(false)
    // …and it outranks everything else, including a first visit on a fast link.
    expect(shouldRunSplash({ reduceMotion: true, saveData: false, alreadySeen: false })).toBe(false)
  })

  test("never runs under Save-Data", () => {
    expect(shouldRunSplash({ saveData: true })).toBe(false)
  })

  test("runs at most once per session", () => {
    expect(shouldRunSplash({ alreadySeen: true })).toBe(false)
  })

  test("an unknown environment is not an objection", () => {
    // Absent means "could not tell", and the conservative reading of a media
    // query that could not be asked is the one the query itself returns: no
    // preference expressed. Treating unknown as a refusal would disable the
    // splash on every browser without `navigator.connection` — which is
    // Firefox and Safari, i.e. most of the readers it was written for.
    expect(shouldRunSplash({})).toBe(true)
  })
})
