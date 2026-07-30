import { describe, expect, test } from "bun:test"
import type { Doc } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { boundsOf, recordingCtx } from "./lib/readRecorder.testing"
import { getRankingFilterOptions, passes } from "./rankings"

/**
 * Convex wraps a `query()` handler as `_handler`, invisible in the public
 * type but present at runtime — the same cast `stats.test.ts` uses, restated
 * here per that file's note that duplicating it beats a shared
 * `*_Handler` refactor for a handful of read-only assertions.
 */
type QueryHandler<TArgs, TResult> = (ctx: QueryCtx, args: TArgs) => Promise<TResult>
function handlerOf<TArgs, TResult>(fn: unknown): QueryHandler<TArgs, TResult> {
  return (fn as { _handler: QueryHandler<TArgs, TResult> })._handler
}

/**
 * The federal-state filter, at the predicate every leaderboard runs it through.
 *
 * ## Why this file exists
 *
 * `passes` decides which members a board holds, and every way it can be wrong
 * produces a *plausible* page rather than an error: a filter that matches
 * nobody looks like a state nobody is from, and one that matches too many looks
 * like a popular Land. Neither raises, neither shows up in a typecheck, and the
 * browser sweep that found the last such bug (components/mp-table.tsx's four
 * copies of `initials`) only found it because it was on screen.
 *
 * It was wrong, for the whole life of the feature. Until `mps.federalState`
 * existed the state was recovered by reading a trailing `(BW)` off the
 * constituency *name* — and measured against the real Stammdaten dump, **0** of
 * 13 046 `WKR_NAME` values end in a parenthetical. So the filter selected
 * nobody in any period, and because the UI hides a filter with no options
 * (correctly, for a different case) it never appeared at all. GAP-021.
 *
 * The tests below are therefore about the *three* states a mandate can be in —
 * a code, an explicit null, and an absent key — because the bug that got here
 * was one of them being unreachable.
 */

/** A mandate row carrying only what `passes` reads.
 *
 * No cast, which is the point: `passes` takes a `Pick` of the three columns it
 * filters on — the same shape `peakConcurrentMandates` takes in convex/stats.ts
 * — so this is a real value of that type rather than a lie about a full
 * `Doc<"mps">`. A fourth filter added to the predicate is then a type error
 * here, where an `as unknown as` would have silently kept compiling. */
type Mandate = Pick<Doc<"mps">, "fraktion" | "federalState" | "birthDate">

function mandate(fields: Partial<Mandate>): Mandate {
  return { fraktion: "CDU/CSU", birthDate: "1975-04-12", ...fields }
}

/** Fixed rather than `Date.now()`: the age-bracket arm of `passes` is a
 * function of the clock, and a test whose meaning changes on someone's birthday
 * is a test that fails on a Tuesday for no reason. */
const NOW = Date.parse("2026-07-29T00:00:00Z")

describe("the federal-state filter", () => {
  test("selects the members whose record names that Land", () => {
    expect(passes(mandate({ federalState: "BW" }), { state: "BW" }, NOW)).toBe(true)
    expect(passes(mandate({ federalState: "NW" }), { state: "BW" }, NOW)).toBe(false)
  })

  test("a member the source states no Land for is in no state's board", () => {
    // 21 of WP21's 635 mandates: list members with no constituency block at
    // all. They must not fall into a default Land, and must not be quietly
    // dropped from an *unfiltered* board either — see the last test here.
    expect(passes(mandate({ federalState: null }), { state: "BW" }, NOW)).toBe(false)
  })

  test("a row written before the column existed is treated the same way", () => {
    // The stored column is `v.optional`, so a mandate ingested by an older
    // pipeline has no key at all and reads back as `undefined`. It must behave
    // as unknown rather than throwing or matching: mid-backfill, a deployment
    // holds both shapes at once, and the two arms differing would make a
    // board's membership depend on ingest order.
    expect(passes(mandate({ federalState: undefined }), { state: "BW" }, NOW)).toBe(false)
  })

  test("no state filter keeps every member, including the stateless ones", () => {
    // The asymmetry that matters. "Not from Baden-Württemberg" is a reason to
    // leave a board scoped to BW; it is not a reason to leave the chamber-wide
    // one. Folding the two would silently shrink every unfiltered leaderboard
    // by the 21 members whose Land the source does not publish — and a
    // leaderboard is exactly where a missing row is invisible.
    for (const federalState of ["BW", null, undefined]) {
      expect(passes(mandate({ federalState }), {}, NOW)).toBe(true)
    }
  })

  test("codes are compared verbatim, so a period's own vocabulary matches", () => {
    // ⚠ Period-scoped: WP1–17 spell Lower Saxony `NDS` where WP18–21 spell it
    // `NI` (§6.2). Nothing normalises between them, deliberately — a mapping
    // would need to be per-period and would rename entities that no longer
    // exist. The consequence under test: a historical board filtered to `NDS`
    // finds its members, and one filtered to `NI` does not find them by
    // accident.
    expect(passes(mandate({ federalState: "NDS" }), { state: "NDS" }, NOW)).toBe(true)
    expect(passes(mandate({ federalState: "NDS" }), { state: "NI" }, NOW)).toBe(false)
  })

  test("a constituency name is not a state, and is no longer read as one", () => {
    // The regression guard for GAP-021 itself. The old rule mined
    // `constituency` for a parenthetical; if anything ever routes that column
    // back into this filter, `Ludwigsburg` must not satisfy `BW`.
    expect(passes(mandate({ federalState: "BW" }), { state: "Ludwigsburg" }, NOW)).toBe(false)
  })

  test("the state filter composes with the others rather than replacing them", () => {
    // Each filter is `undefined`-means-no-filter, and they AND together. Worth
    // pinning because the failure is silent in the other direction too: a
    // state filter that ignored the Fraktion would show one group's members
    // under another's board.
    const mp = mandate({ fraktion: "SPD", federalState: "BW" })
    expect(passes(mp, { state: "BW", fraktion: "SPD" }, NOW)).toBe(true)
    expect(passes(mp, { state: "BW", fraktion: "CDU/CSU" }, NOW)).toBe(false)
  })
})

/**
 * `getRankingFilterOptions`'s month list, at the read shape rather than the
 * output.
 *
 * ## Why this file needs a cost assertion, not just a value one
 *
 * The bug this guards was invisible to a value assertion: for a small fixture
 * the wrong query and the right one return the same `months` array. It only
 * differed in production, where a closed Wahlperiode's `activityScores` table
 * holds one row per MP per month — tens of thousands for WP14–20 — and reading
 * all of them to find the distinct month strings overran Convex's per-query
 * document-read ceiling and 500'd the roster dropdown for every historical
 * period. `readRecorder.testing.ts` exists for exactly this class of bug (see
 * its own header); `stats.test.ts` and `mps.ts`'s `listPeriods` are the
 * established instances of the same "probe, don't collect" pattern.
 */
describe("getRankingFilterOptions' month list", () => {
  test("probes each candidate month once, rather than reading every score row", async () => {
    const { ctx, cost } = recordingCtx({
      mps: [
        {
          _id: "mp1",
          wahlperiode: 20,
          fraktion: "SPD",
          federalState: "BW",
          birthDate: "1975-04-12",
          datesInOffice: { start: "2021-11-01", end: "2021-12-31" },
        },
      ],
      // Only November has a score row. December is still a candidate month —
      // it falls inside the mandate span — but the sweep never scored it.
      activityScores: [{ _id: "score1", wahlperiode: 20, month: "2021-11", totalScore: 10 }],
    })

    const handler = handlerOf<{ wahlperiode: number }, { months: string[] }>(
      getRankingFilterOptions,
    )
    const result = await handler(ctx, { wahlperiode: 20 })

    // The value the old, unbounded query also got right — asserted so a
    // future change to the probing loop can't silently drop December's
    // absence or invent a month outside the mandate span.
    expect(result.months).toEqual(["2021-11"])

    // The shape the old query got wrong: one bounded probe per candidate
    // month, not a single `.collect()` over the whole period's rows.
    const scoreReads = cost.reads.filter((read) => read.table === "activityScores")
    expect(scoreReads).toHaveLength(2)
    for (const read of scoreReads) {
      expect(boundsOf(read)).toContain("month")
      expect(read.returned).toBeLessThanOrEqual(1)
    }
  })

  test("an mp with no datesInOffice contributes no candidate months", async () => {
    // A row ingested before the field existed, or one the source publishes no
    // mandate span for — `datesInOffice: null` (schema.ts). Must not throw
    // and must not widen the range to `undefined`'s NaN-like comparisons.
    const { ctx } = recordingCtx({
      mps: [
        {
          _id: "mp1",
          wahlperiode: 20,
          fraktion: "SPD",
          federalState: "BW",
          birthDate: "1975-04-12",
          datesInOffice: null,
        },
      ],
      activityScores: [],
    })

    const handler = handlerOf<{ wahlperiode: number }, { months: string[] }>(
      getRankingFilterOptions,
    )
    const result = await handler(ctx, { wahlperiode: 20 })

    expect(result.months).toEqual([])
  })
})
