import { describe, expect, test } from "bun:test"
import type { PartyKey } from "./parties"
import {
  buildRadarSeries,
  byDirectShare,
  chamberMandateSplit,
  coalitionSplit,
  coverageGapKey,
  DEFAULT_PARTY_METRIC_ID,
  hasCoalitionSplit,
  PARTY_METRICS,
  type PartyAggregate,
  type PartyMetricValues,
  partyMetricById,
  RADAR_MAX,
  RADAR_METRICS,
  rankPartiesBy,
} from "./party-comparison"

/**
 * Same premise as lib/seating.test.ts and lib/trends.test.ts: this is the part
 * that can be wrong without looking wrong.
 *
 * A radar normalised against the wrong maximum still draws a plausible hexagon.
 * A coalition mean weighted by party rather than by member still renders two
 * bars. A ranking that keeps unscored groups still fills a chart. None of them
 * throws, and none of them looks like a defect on screen — which is exactly what
 * makes them worth a test on a page whose whole purpose is comparing groups of
 * very different sizes.
 */

/** WP21 as §9 counts it, minus the FDP, which holds no seats in it. */
const WP21 = 21

function values(overrides: Partial<PartyMetricValues> = {}): PartyMetricValues {
  return {
    totalScore: 0,
    motionCount: 0,
    speechCount: 0,
    speechWordCount: 0,
    questionCount: 0,
    reportCount: 0,
    voteParticipationRate: 0,
    committeeCount: 0,
    billSponsorshipCount: 0,
    ...overrides,
  }
}

function party(
  partyKey: PartyKey,
  mandates: number,
  scored: number,
  means: Partial<PartyMetricValues> = {},
  medianScore = 0,
  /** Defaults to every mandate on the state list, which keeps the split summing
   * to `mandates` for the coalition and radar tests that do not care about it.
   * The mandate tests below pass their own. */
  mandateSplit: Partial<PartyAggregate["mandateSplit"]> = {},
): PartyAggregate {
  return {
    partyKey,
    mandates,
    scored,
    means: values(means),
    medianScore,
    mandateSplit: { direct: 0, list: mandates, unknown: 0, ...mandateSplit },
  }
}

describe("PARTY_METRICS", () => {
  test("every metric has a distinct id, and the default names one of them", () => {
    const ids = PARTY_METRICS.map((metric) => metric.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(partyMetricById(DEFAULT_PARTY_METRIC_ID)).toBeDefined()
  })

  test("the radar has exactly the six axes Wave 9 names", () => {
    // Motions, speeches, questions, votes, committees, bills. `speeches` is the
    // *word count* rather than the segment count, which is the one substitution
    // here and the reason it is asserted: §5.2's finding is that segment counts
    // rank a minister answering question time above a member who said more, and
    // on a party radar that would draw the governing groups outward for holding
    // the offices that answer.
    expect(RADAR_METRICS.map((metric) => metric.field)).toEqual([
      "motionCount",
      "speechWordCount",
      "questionCount",
      "voteParticipationRate",
      "committeeCount",
      "billSponsorshipCount",
    ])
  })

  test("the segment count is offered, but not as a radar axis", () => {
    const speeches = PARTY_METRICS.find((metric) => metric.field === "speechCount")
    expect(speeches).toBeDefined()
    expect(speeches?.radar).toBe(false)
    // Offered *with* the caveat, not hidden: removing the count would not
    // answer the question, it would make the answer unavailable.
    expect(speeches?.caveatKey).toBe("rankings.caveat.speechCount")
  })

  test("every count-derived metric formats as a mean, not as an integer", () => {
    // These are averages of whole things, so they land on 0.5 and 8.5. Rounded
    // to whole numbers, 0.5 and 1.0 both render "1" — the committee bar chart's
    // axis came out reading "0 0 1 1 1" with duplicate ticks, and a Fraktion
    // averaging 8.5 motions was reported as 8. Caught on screen; pinned here so
    // a new metric cannot reintroduce it.
    for (const metric of PARTY_METRICS) {
      if (metric.field === "totalScore") {
        expect(metric.format).toBe("score")
      } else if (metric.field === "voteParticipationRate") {
        expect(metric.format).toBe("rate")
      } else {
        expect(metric.format).toBe("mean")
      }
    }
  })

  test("the three metrics with structural limits carry a caveat", () => {
    // Named ballots only (§4.4), committees current-period only (§6.4), and
    // speech segments (§5.2). A caveat lost in a refactor is invisible on
    // screen — the figure simply appears without its qualification.
    const withCaveat = (field: string) =>
      PARTY_METRICS.find((metric) => metric.field === field)?.caveatKey
    expect(withCaveat("voteParticipationRate")).toBe("rankings.caveat.namedVotesOnly")
    expect(withCaveat("committeeCount")).toBe("rankings.caveat.committeesCurrentOnly")
    expect(withCaveat("speechWordCount")).toBe("score.caveat.speechWords")
  })
})

describe("rankPartiesBy", () => {
  test("orders by the metric, highest first", () => {
    const rows = [
      party("spd", 122, 122, { totalScore: 40 }),
      party("cdu-csu", 209, 209, { totalScore: 30 }),
      party("gruene", 88, 88, { totalScore: 55 }),
    ]
    expect(rankPartiesBy(rows, "totalScore").map((row) => row.partyKey)).toEqual([
      "gruene",
      "spd",
      "cdu-csu",
    ])
  })

  test("drops a group with no scored member rather than sorting it to zero", () => {
    // A mean over zero members is undefined, not zero, and a bar at the origin
    // asserts the second. The group still exists on the roster — the table
    // above the chart lists it with its seat count.
    const rows = [
      party("spd", 122, 122, { totalScore: 40 }),
      party("fraktionslos", 3, 0, { totalScore: 0 }),
    ]
    const ranked = rankPartiesBy(rows, "totalScore")
    expect(ranked.map((row) => row.partyKey)).toEqual(["spd"])
  })

  test("breaks ties stably, so a redraw cannot reshuffle two equal groups", () => {
    const rows = [
      party("spd", 122, 122, { motionCount: 7 }),
      party("afd", 152, 152, { motionCount: 7 }),
      party("linke", 67, 67, { motionCount: 7 }),
    ]
    const once = rankPartiesBy(rows, "motionCount").map((row) => row.partyKey)
    const again = rankPartiesBy([...rows].reverse(), "motionCount").map((row) => row.partyKey)
    expect(once).toEqual(again)
  })
})

describe("buildRadarSeries", () => {
  const label = (metric: { shortLabelKey: string }) => metric.shortLabelKey

  test("normalises each axis to its own leader, not to a shared scale", () => {
    // The whole reason the radar is normalised. Word counts reach five digits
    // and committee seats reach one: on a shared radius, five of six axes
    // collapse onto the origin and the chart becomes a picture of which metric
    // has the largest units.
    const rows = [
      party("spd", 122, 122, { speechWordCount: 20_000, committeeCount: 1 }),
      party("cdu-csu", 209, 209, { speechWordCount: 10_000, committeeCount: 2 }),
    ]
    const points = buildRadarSeries(rows, RADAR_METRICS, label)

    const words = points.find((point) => point.metric === "speech-words")
    expect(words?.values.spd).toBe(RADAR_MAX)
    expect(words?.values["cdu-csu"]).toBe(RADAR_MAX / 2)

    // The *other* party leads this axis — which is the point: each axis is
    // scaled independently, so leading one does not lift a group on the rest.
    const committees = points.find((point) => point.metric === "committees")
    expect(committees?.values["cdu-csu"]).toBe(RADAR_MAX)
    expect(committees?.values.spd).toBe(RADAR_MAX / 2)
  })

  test("carries the raw mean and the axis maximum alongside the normalised value", () => {
    // Without these the tooltip could only report a percentage, and a reader
    // would have no way back to the figure that was actually measured.
    const rows = [party("spd", 122, 122, { questionCount: 12 })]
    const points = buildRadarSeries(rows, RADAR_METRICS, label)
    const questions = points.find((point) => point.metric === "questions")
    expect(questions?.raw.spd).toBe(12)
    expect(questions?.max).toBe(12)
  })

  test("keeps the raw means off `values`, where recharts would plot them", () => {
    // `values` is what the `<Radar dataKey>` reads. A raw word count leaking in
    // would draw one polygon a thousand times outside the chart's radius.
    const rows = [party("spd", 122, 122, { speechWordCount: 20_000 })]
    const points = buildRadarSeries(rows, RADAR_METRICS, label)
    for (const point of points) {
      for (const value of Object.values(point.values)) {
        expect(value).toBeLessThanOrEqual(RADAR_MAX)
        expect(value).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test("draws an all-zero axis at zero rather than dropping it", () => {
    // Committee work in a historical Wahlperiode is uniformly zero (§6.4
    // publishes nothing), and that is the true shape. Removing the axis would
    // turn the hexagon into a pentagon, which a reader would compare against
    // another period's hexagon without noticing it had lost a side.
    const rows = [party("spd", 122, 122, { committeeCount: 0, motionCount: 4 })]
    const points = buildRadarSeries(rows, RADAR_METRICS, label)
    expect(points).toHaveLength(RADAR_METRICS.length)
    const committees = points.find((point) => point.metric === "committees")
    expect(committees?.values.spd).toBe(0)
    expect(committees?.max).toBe(0)
  })

  test("never produces NaN, which recharts renders as a silent gap", () => {
    const rows = [party("spd", 122, 122), party("afd", 152, 152)]
    for (const point of buildRadarSeries(rows, RADAR_METRICS, label)) {
      for (const value of Object.values(point.values)) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  test("excludes an unscored group from the series entirely", () => {
    const rows = [party("spd", 122, 122, { motionCount: 5 }), party("fraktionslos", 3, 0)]
    const points = buildRadarSeries(rows, RADAR_METRICS, label)
    for (const point of points) {
      expect(point.values.fraktionslos).toBeUndefined()
    }
  })
})

describe("coalitionSplit", () => {
  test("splits WP21 into the recorded coalition and everyone else", () => {
    // GOVERNING_PARTIES records CDU/CSU + SPD for WP21 (lib/seating.ts). Read
    // from there rather than restated, so the seating map's coalition colouring
    // and this card cannot disagree about who governs.
    const rows = [
      party("cdu-csu", 209, 209, { totalScore: 30 }),
      party("spd", 122, 122, { totalScore: 40 }),
      party("afd", 152, 152, { totalScore: 50 }),
      party("gruene", 88, 88, { totalScore: 60 }),
    ]
    const split = coalitionSplit(rows, WP21)
    expect(split.government.parties.sort()).toEqual(["cdu-csu", "spd"])
    expect(split.opposition.parties.sort()).toEqual(["afd", "gruene"])
    expect(split.unknown.parties).toEqual([])
    expect(hasCoalitionSplit(split)).toBe(true)
  })

  test("weights a bloc by scored members, not by party", () => {
    // The bug this exists to catch. A plain average of the two parties' means
    // would be (30 + 40) / 2 = 35, giving a 122-seat group the same weight as a
    // 209-seat one; weighted by members it is
    // (209·30 + 122·40) / 331 = 33.69…, which is what the card claims.
    const rows = [
      party("cdu-csu", 209, 209, { totalScore: 30 }),
      party("spd", 122, 122, { totalScore: 40 }),
    ]
    const split = coalitionSplit(rows, WP21)
    expect(split.government.scored).toBe(331)
    expect(split.government.means.totalScore).toBeCloseTo((209 * 30 + 122 * 40) / 331, 10)
    expect(split.government.means.totalScore).not.toBeCloseTo(35, 5)
  })

  test("counts mandates and scored mandates separately", () => {
    // A bloc whose sweep is incomplete must not silently average over whoever
    // happens to have a row while reporting the full seat count.
    const rows = [
      party("cdu-csu", 209, 200, { totalScore: 30 }),
      party("spd", 122, 122, { totalScore: 40 }),
    ]
    const split = coalitionSplit(rows, WP21)
    expect(split.government.mandates).toBe(331)
    expect(split.government.scored).toBe(322)
  })

  test("puts every group in `unknown` for a period with no recorded coalition", () => {
    // ⚠ Which groups govern is in no Bundestag dataset — `GOVERNING_PARTIES` is
    // hand-maintained. A period missing from it must not colour the whole
    // chamber as opposition, which is what a boolean default would do.
    const rows = [
      party("cdu-csu", 209, 209, { totalScore: 30 }),
      party("spd", 122, 122, { totalScore: 40 }),
    ]
    const split = coalitionSplit(rows, 19)
    expect(split.unknown.parties.sort()).toEqual(["cdu-csu", "spd"])
    expect(split.government.parties).toEqual([])
    expect(hasCoalitionSplit(split)).toBe(false)
  })

  test("reports no split when one bloc has nothing scored", () => {
    // Rendering two bars, one of which is a confident zero, would be the worse
    // failure — the card shows its caveat instead.
    const rows = [
      party("cdu-csu", 209, 0, { totalScore: 0 }),
      party("spd", 122, 0, { totalScore: 0 }),
      party("afd", 152, 152, { totalScore: 50 }),
    ]
    const split = coalitionSplit(rows, WP21)
    expect(split.government.scored).toBe(0)
    expect(hasCoalitionSplit(split)).toBe(false)
  })

  test("leaves a bloc's means at zero rather than dividing by nothing", () => {
    const split = coalitionSplit([party("afd", 152, 152, { totalScore: 50 })], WP21)
    expect(split.government.scored).toBe(0)
    for (const value of Object.values(split.government.means)) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBe(0)
    }
  })

  test("recognises a Fraktion however the roster spelled it", () => {
    // The aggregation folds to a `PartyKey` server-side, so by the time a row
    // reaches here the original spelling is gone. `coalitionSplit` therefore
    // has to resolve the role from the key — this is the assertion that it does
    // not accidentally depend on a raw string it no longer has.
    const split = coalitionSplit([party("gruene", 88, 88, { totalScore: 60 })], 20)
    // WP20's Ampel: SPD, Grüne, FDP.
    expect(split.government.parties).toEqual(["gruene"])
  })
})

describe("coverageGapKey", () => {
  test("says nothing when the sweep has reached everyone", () => {
    // A second sentence reading "0 are missing" trains the reader to skip both.
    expect(coverageGapKey(0)).toBeNull()
  })

  test("picks the singular key at exactly one", () => {
    // The bug this replaced: a single `{missing}` placeholder rendered
    // "1 Mandate" / "1 mandates". Caught on screen against seeded data.
    expect(coverageGapKey(1)).toEqual({ key: "parties.coverageGapOne", missing: 1 })
  })

  test("picks the plural key above one", () => {
    expect(coverageGapKey(7)).toEqual({ key: "parties.coverageGap", missing: 7 })
  })

  test("treats a negative gap as no gap", () => {
    // Unreachable while `scored <= mandates`, which the query guarantees — but a
    // negative here would otherwise print "−2 mandates are missing".
    expect(coverageGapKey(-2)).toBeNull()
  })
})

describe("chamberMandateSplit", () => {
  test("sums the groups rather than restating the roster", () => {
    // WP21's real figures (§9): 276 direct against 359 list across 635
    // mandates. The headline is the sum of the bars underneath it precisely so
    // a reader can add them up and get the same number.
    const rows = [
      party("cdu-csu", 209, 209, {}, 0, { direct: 172, list: 37 }),
      party("afd", 150, 150, {}, 0, { direct: 41, list: 109 }),
      party("spd", 121, 121, {}, 0, { direct: 44, list: 77 }),
      party("gruene", 87, 87, {}, 0, { direct: 12, list: 75 }),
      party("linke", 65, 65, {}, 0, { direct: 6, list: 59 }),
      party("fraktionslos", 3, 3, {}, 0, { direct: 1, list: 2 }),
    ]
    expect(chamberMandateSplit(rows)).toEqual({
      direct: 276,
      list: 359,
      unknown: 0,
      total: 635,
    })
  })

  test("counts an un-ingested mandate as unknown, not as a list seat", () => {
    // The whole reason `unknown` is a third bucket. Folding it into `list`
    // would report this group as 90 % list when a tenth of it is simply not
    // known — and the total would still look right, which is what makes the
    // collapse invisible.
    const split = chamberMandateSplit([
      party("spd", 10, 10, {}, 0, { direct: 3, list: 6, unknown: 1 }),
    ])
    expect(split).toEqual({ direct: 3, list: 6, unknown: 1, total: 10 })
  })

  test("totals nothing for an empty chamber", () => {
    // The pre-ingest state. A zero total is what the card's own guard divides
    // by, so this pins that it is 0 rather than NaN or undefined.
    expect(chamberMandateSplit([])).toEqual({ direct: 0, list: 0, unknown: 0, total: 0 })
  })
})

describe("byDirectShare", () => {
  test("orders by share, not by count", () => {
    // The distinction the ordering exists for. CDU/CSU has by far the most
    // direct mandates in absolute terms, but sorting on the count would just
    // reproduce the seat order of the table above — and here the smaller group
    // is the more direct-mandate one.
    const big = party("cdu-csu", 100, 100, {}, 0, { direct: 60, list: 40 })
    const small = party("spd", 10, 10, {}, 0, { direct: 9, list: 1 })
    expect(byDirectShare([big, small]).map((row) => row.partyKey)).toEqual(["spd", "cdu-csu"])
  })

  test("sorts a group with no known mandate types last, not at zero", () => {
    // An unmeasured group is not a group without direct mandates. At 0 % it
    // would sort above nobody and below everybody — which happens to be the
    // same place, so this asserts the *reason*: a group that genuinely has no
    // direct mandates must still outrank one whose types were never ingested.
    const unknown = party("linke", 5, 5, {}, 0, { direct: 0, list: 0, unknown: 5 })
    const allList = party("gruene", 5, 5, {}, 0, { direct: 0, list: 5 })
    expect(byDirectShare([unknown, allList]).map((row) => row.partyKey)).toEqual([
      "gruene",
      "linke",
    ])
  })

  test("does not mutate the array it was given", () => {
    // The rows come straight from a Convex subscription's result, which React
    // holds across renders; sorting it in place would reorder the ranked table
    // above as a side effect of drawing this card.
    const rows = [
      party("spd", 10, 10, {}, 0, { direct: 1, list: 9 }),
      party("cdu-csu", 10, 10, {}, 0, { direct: 9, list: 1 }),
    ]
    byDirectShare(rows)
    expect(rows.map((row) => row.partyKey)).toEqual(["spd", "cdu-csu"])
  })

  test("keeps every group, including the unscored ones", () => {
    // `rankPartiesBy` drops groups the sweep has not reached, because a mean
    // over nobody is not a figure. A mandate split is known regardless — it is
    // read off the roster — so dropping one here would make this card disagree
    // with the seat counts in the table above.
    const rows = [
      party("spd", 10, 0, {}, 0, { direct: 4, list: 6 }),
      party("cdu-csu", 10, 10, {}, 0, { direct: 5, list: 5 }),
    ]
    expect(byDirectShare(rows)).toHaveLength(2)
  })
})
