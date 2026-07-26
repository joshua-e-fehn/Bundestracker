import { describe, expect, test } from "bun:test"
import {
  bucketFor,
  computeScore,
  DEFAULT_WEIGHTS,
  rescore,
  resolveWeights,
  SCORE_COMPONENTS,
  type ScoreInputs,
} from "./scoring"

/**
 * Tests for the scoring formula.
 *
 * lib/scoring.ts is the one piece of real logic shared across the Convex/browser
 * boundary — the cron scores with it and a signed-in user re-weights their own
 * view with it — so an error here is wrong on both sides at once and looks like
 * bad data rather than a bug.
 *
 * The bucketing tests double as the guard on the finding in §3.5 of
 * docs/api-research.md: `aktivitaetsart` is an open string, so an unknown value
 * must be *counted* as `other` and never silently scored at zero.
 */

const NO_ACTIVITY: ScoreInputs = {
  motions: 0,
  speeches: 0,
  questions: 0,
  reports: 0,
  voteParticipation: 0,
  committees: 0,
  billSponsorships: 0,
}

describe("bucketFor", () => {
  test("routes the activity kinds observed in the research", () => {
    // The values sampled in §3.5 and §5.2, which are the ones the pipeline is
    // certain to meet on day one.
    expect(bucketFor("Kleine Anfrage")).toBe("questions")
    expect(bucketFor("Große Anfrage")).toBe("questions")
    expect(bucketFor("Rede")).toBe("speeches")
    expect(bucketFor("Gesetzentwurf")).toBe("billSponsorships")
    expect(bucketFor("Bericht")).toBe("reports")
  })

  test("a Zwischenfrage is a speech, not a written question", () => {
    // It contains "anfrage" as a substring but is a spoken intervention during
    // someone else's speech — §5.2 counts the intervener's own words, and
    // protocol 21/90 has seven of them. Bucketing it with the written Anfragen
    // would credit an interjection as a parliamentary question.
    expect(bucketFor("Zwischenfrage")).toBe("speeches")
    expect(bucketFor("Kurzintervention")).toBe("speeches")
  })

  test("matches on substrings, so qualified kinds bucket with their base", () => {
    // "Rede (zu Protokoll gegeben)" is a real §5.2 value: a written speech
    // submitted for the record. It is still a speech.
    expect(bucketFor("Rede (zu Protokoll gegeben)")).toBe("speeches")
    expect(bucketFor("Schriftliche Erklärung gem. § 31 GO BT")).toBe("speeches")
  })

  test("is case-insensitive", () => {
    expect(bucketFor("REDE")).toBe("speeches")
    expect(bucketFor("kleine anfrage")).toBe("questions")
  })

  test("routes an unknown kind to `other` rather than dropping it", () => {
    // The §3.5 guarantee. The observed values are a sample of 80 537 records,
    // so unknown kinds are expected — they must land somewhere countable, or a
    // whole class of parliamentary work vanishes from every score with no error.
    expect(bucketFor("Eine völlig neue Aktivitätsart")).toBe("other")
    expect(bucketFor("")).toBe("other")
  })
})

describe("computeScore", () => {
  test("a period with no recorded activity scores zero", () => {
    const { totalScore, breakdown } = computeScore(NO_ACTIVITY)
    expect(totalScore).toBe(0)
    for (const component of SCORE_COMPONENTS) {
      expect(breakdown[component].weighted).toBe(0)
    }
  })

  test("the total is the sum of the weighted components", () => {
    const { totalScore, breakdown } = computeScore({
      ...NO_ACTIVITY,
      motions: 2,
      questions: 3,
      committees: 1,
    })
    // 2*5 + 3*3 + 1*2
    expect(totalScore).toBe(21)
    expect(breakdown.motions).toEqual({ raw: 2, weight: 5, weighted: 10 })
    expect(breakdown.questions).toEqual({ raw: 3, weight: 3, weighted: 9 })
  })

  test("every component is retained in the breakdown, including the zeroes", () => {
    // A total is only ever displayed next to what produced it, so a component
    // that contributed nothing still has to be visible as such.
    const { breakdown } = computeScore({ ...NO_ACTIVITY, speeches: 100 })
    expect(Object.keys(breakdown).sort()).toEqual([...SCORE_COMPONENTS].sort())
  })

  test("speech volume is weighted per word, not per speech", () => {
    // The §5.2 finding: ranking by speech count put Habeck 36 speeches above
    // Scholz for saying 25 % less. A 1 500-word speech is worth ~15 points,
    // roughly three written questions — not 0.01.
    const { totalScore } = computeScore({ ...NO_ACTIVITY, speeches: 1500 })
    expect(totalScore).toBe(15)
  })

  test("vote participation is a 0…1 rate, scaled", () => {
    const full = computeScore({ ...NO_ACTIVITY, voteParticipation: 1 })
    const half = computeScore({ ...NO_ACTIVITY, voteParticipation: 0.5 })
    expect(full.totalScore).toBe(100)
    expect(half.totalScore).toBe(50)
  })

  test("rounds to two places so equal scores do not order on a float bit", () => {
    // The rankings index sorts on this value; 17.330000000000002 and 17.33
    // must not be two different scores.
    const { totalScore } = computeScore({ ...NO_ACTIVITY, speeches: 1733 })
    expect(totalScore).toBe(17.33)
  })

  test("custom weights change the total", () => {
    const inputs = { ...NO_ACTIVITY, speeches: 1000, questions: 1 }
    const withDefaults = computeScore(inputs)
    const speechesOnly = computeScore(inputs, { ...DEFAULT_WEIGHTS, questions: 0 })
    expect(withDefaults.totalScore).toBe(13)
    expect(speechesOnly.totalScore).toBe(10)
  })
})

describe("resolveWeights", () => {
  test("null and undefined mean the defaults", () => {
    expect(resolveWeights(null)).toEqual(DEFAULT_WEIGHTS)
    expect(resolveWeights(undefined)).toEqual(DEFAULT_WEIGHTS)
  })

  test("a partial override leaves the rest at their defaults", () => {
    const resolved = resolveWeights({ motions: 99 })
    expect(resolved.motions).toBe(99)
    expect(resolved.questions).toBe(DEFAULT_WEIGHTS.questions)
  })

  test("rejects NaN and Infinity, falling back to the default", () => {
    // A non-finite weight makes every total it produces NaN, which then sorts
    // unpredictably in the rankings index and cannot be repaired by a later
    // write. It must never reach the formula.
    expect(resolveWeights({ motions: Number.NaN }).motions).toBe(DEFAULT_WEIGHTS.motions)
    expect(resolveWeights({ speeches: Number.POSITIVE_INFINITY }).speeches).toBe(
      DEFAULT_WEIGHTS.speeches,
    )
  })

  test("a zero weight is honoured, not treated as absent", () => {
    // Turning a component off is a legitimate choice and must survive the
    // falsy-value trap that `||` would introduce.
    expect(resolveWeights({ motions: 0 }).motions).toBe(0)
  })
})

describe("rescore", () => {
  test("recomputes a stored breakdown under new weights", () => {
    // What the browser does as a weight slider moves: the raw counts are
    // already in the document, so no query is needed.
    const original = computeScore({ ...NO_ACTIVITY, motions: 4, questions: 2 })
    expect(original.totalScore).toBe(26)

    const doubled = rescore(original.breakdown, { ...DEFAULT_WEIGHTS, motions: 10 })
    // 4*10 + 2*3
    expect(doubled.totalScore).toBe(46)
    expect(doubled.breakdown.motions.raw).toBe(4)
  })

  test("round-trips unchanged under the same weights", () => {
    const original = computeScore({ ...NO_ACTIVITY, speeches: 500, committees: 3 })
    expect(rescore(original.breakdown, DEFAULT_WEIGHTS)).toEqual(original)
  })
})
