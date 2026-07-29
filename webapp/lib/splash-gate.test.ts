import { describe, expect, test } from "bun:test"
import { STALE_AFTER_MS, shouldRunSplash } from "./splash-gate"

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

  test("never runs once the page has already been up too long", () => {
    // The overlay is `fixed inset-0 z-100`, above the header. Dropped over a
    // page the reader is already using, it both looks like a fault and eats the
    // first click — which was one of the two ways this app produced "on a cold
    // load the first click does nothing". Measured on a production build: the
    // splash opened at 4.5 s at 6× CPU throttling and 7.5 s at 10×.
    expect(shouldRunSplash({ elapsedMs: STALE_AFTER_MS + 1 })).toBe(false)
    expect(shouldRunSplash({ elapsedMs: 7500 })).toBe(false)
    // …and lateness outranks an otherwise perfect environment, the same way
    // reduced motion does.
    expect(
      shouldRunSplash({
        reduceMotion: false,
        saveData: false,
        alreadySeen: false,
        elapsedMs: 7500,
      }),
    ).toBe(false)
  })

  test("still runs for a load that arrives in time", () => {
    // The other direction, which is the one that fails invisibly: a threshold
    // set too tight would disable the opening for ordinary readers and nobody
    // would report it. 1.0 s is the measured 1× case and 2.9 s the 4× case;
    // the boundary itself is inclusive.
    expect(shouldRunSplash({ elapsedMs: 1004 })).toBe(true)
    expect(shouldRunSplash({ elapsedMs: STALE_AFTER_MS })).toBe(true)
    expect(shouldRunSplash({ elapsedMs: 0 })).toBe(true)
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
