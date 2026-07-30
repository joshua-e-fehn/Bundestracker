import { describe, expect, test } from "bun:test"
import { parseSittingParams } from "./sitting"

/**
 * The pair parser rejects everything that is not a valid `(wp, sitzungnr)`.
 *
 * Each failing input names a specific wrong-thing the route would render if the
 * parser were lax — a URL a reader could easily land on and see an empty page
 * where they should see a 404.
 */
describe("parseSittingParams", () => {
  test("accepts a well-formed pair inside the tracked range", () => {
    expect(parseSittingParams("21", "90")).toEqual({ wahlperiode: 21, sitzungnr: 90 })
    expect(parseSittingParams("19", "239")).toEqual({ wahlperiode: 19, sitzungnr: 239 })
  })

  test("accepts the tracked lower bound WP14", () => {
    // `EARLIEST_TRACKED_WAHLPERIODE`. A URL a reader might type by hand.
    expect(parseSittingParams("14", "1")).toEqual({ wahlperiode: 14, sitzungnr: 1 })
  })

  test("rejects a period below the tracked range", () => {
    // WP13 and earlier have no source in this codebase — a page for them would
    // render empty rather than 404, which is the failure `parsePeriodParam`
    // (lib/period.ts) also exists to prevent. The sitting parser follows the
    // same rule so the two routes agree on what a valid period is.
    expect(parseSittingParams("13", "1")).toBeNull()
    expect(parseSittingParams("0", "1")).toBeNull()
  })

  test("rejects a period above the parseable ceiling", () => {
    // `LATEST_PARSEABLE_WAHLPERIODE` is 99. A three-digit period is a typo
    // rather than a Bundestag that will exist within any planning horizon.
    expect(parseSittingParams("100", "1")).toBeNull()
    expect(parseSittingParams("999", "1")).toBeNull()
  })

  test("rejects sitting 0", () => {
    // The Bundestag numbers its sittings from 1. A `Sitzung 0` label reads as
    // a placeholder — never a real address.
    expect(parseSittingParams("21", "0")).toBeNull()
  })

  test("rejects a sitting above the four-digit ceiling", () => {
    // The protocol URL zero-pads to three digits (`btp/21/21090.pdf`), so a
    // four-digit sitting is a typo the source itself does not emit.
    expect(parseSittingParams("21", "1000")).toBeNull()
  })

  test("rejects non-digit strings that Number() would accept loosely", () => {
    // Each of these coerces to a number, and each would misroute if the parser
    // did the coercion first. `parsePositiveInt` shape-checks *before* Number,
    // which is the whole point.
    for (const bad of ["", " ", "  21  ", "1e2", "0x15", "21.5", "-3", "+21", "21abc", "abc"]) {
      expect(parseSittingParams(bad, "90")).toBeNull()
      expect(parseSittingParams("21", bad)).toBeNull()
    }
  })

  test("rejects a leading zero on a multi-digit number", () => {
    // `021` and `21` would otherwise render the same page under two URLs — the
    // pipeline never emits the padded form, so the parser refuses it. A
    // single `0` is a bare zero, which the range check rejects on its own.
    expect(parseSittingParams("021", "90")).toBeNull()
    expect(parseSittingParams("21", "090")).toBeNull()
  })
})
