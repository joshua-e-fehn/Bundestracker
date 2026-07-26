/**
 * The activity score: what it counts, how it weighs it, and what it refuses to
 * claim.
 *
 * This file is deliberately outside `convex/`, because both sides need it.
 * Convex computes and stores a score under the default weights (the daily cron
 * in convex/crons.ts); a signed-in user can re-weight their own view
 * (`userPreferences.customWeights`), and that has to recompute in the browser
 * as they drag a slider rather than round-trip per keystroke. Two
 * implementations of one formula would drift, and the drift would look like a
 * bug in the data.
 *
 * ## What the score is not
 *
 * Bundestracker's premise is that every figure is backed by a Bundestag record
 * (see AGENTS.md). Weighting is unavoidably editorial — some choice has to be
 * made for the default view — so the honest thing is to make it explicit,
 * adjustable, and shown alongside its components rather than presented as a
 * verdict. `scoreBreakdown` is stored for that reason: a total is only ever
 * displayed next to what produced it.
 *
 * Three limits are structural rather than provisional, and no weighting fixes
 * them. They come from docs/api-research.md and belong in the UI, not just
 * here:
 *
 *  - **Vote participation covers named ballots only.** Roughly 1 015 votes in
 *    the Bundestag's entire history were recorded by name (§4.4); every other
 *    vote is a show of hands with no per-MP record in existence.
 *  - **Committee work is current-period only.** All 1 744 committee entries in
 *    the Stammdaten dump belong to WP21, by design (§6.4). For an earlier
 *    period `committeeCount` is 0 because nothing was published, not because
 *    nobody sat on a committee.
 *  - **Speech volume is measured in words, not speeches.** Question time
 *    fragments one minister's turn into dozens of short replies, which ranked
 *    Robert Habeck 36 speeches above Olaf Scholz for saying 25 % less (§5.2).
 */

/** The seven inputs to a score. `convex/schema.ts` builds its `scoreWeights`
 * and `scoreBreakdown` validators from this list, so adding a component here is
 * a type error there until the schema is updated too. */
export const SCORE_COMPONENTS = [
  "motions",
  "speeches",
  "questions",
  "reports",
  "voteParticipation",
  "committees",
  "billSponsorships",
] as const

export type ScoreComponent = (typeof SCORE_COMPONENTS)[number]

export type ScoreWeights = Record<ScoreComponent, number>

/** What each component measures, before weighting. */
export type ScoreInputs = Record<ScoreComponent, number>

export type ScoreBreakdown = Record<
  ScoreComponent,
  { raw: number; weight: number; weighted: number }
>

/**
 * Default weights.
 *
 * The units differ by component, so these are not a ranking of what matters —
 * they are the conversion factors that put seven different measures on one
 * scale. `speeches` is per *word* and the rest are per *record*, which is why
 * it is three orders of magnitude smaller: at 0.01, a 1 500-word speech scores
 * 15, roughly one substantial debate contribution against three written
 * questions. `voteParticipation` is a 0…1 rate scaled to 100 so full
 * attendance is worth about as much as twenty questions.
 *
 * Nothing here is derived from the sources; it is a starting point the user can
 * override, which is what `customWeights` is for.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  motions: 5,
  speeches: 0.01,
  questions: 3,
  reports: 4,
  voteParticipation: 100,
  committees: 2,
  billSponsorships: 5,
}

/**
 * Buckets an `aktivitaetsart` — the DIP activity kind — into a score component.
 *
 * ⚠ `aktivitaetsart` is an open string, not an enum. §3.5 of the research is
 * explicit: the OpenAPI spec types it as a bare `string`, publishes no value
 * list, and offers no catalogue endpoint, and the values seen in research came
 * from a few hundred sampled records out of 80 537. So this cannot be a total
 * mapping, and the failure mode of pretending otherwise is the bad one — an
 * unrecognised value silently contributing nothing means a whole class of
 * parliamentary work vanishes from every MP's score with no error anywhere.
 *
 * Hence `other`: unrecognised kinds are counted and surfaced (see
 * `convex/activities.ts:listUnrecognisedActivityKinds`) rather than dropped, so
 * a new activity kind shows up as a question to answer instead of as a number
 * quietly going down. Matching is substring-based and case-folded for the same
 * reason — `Rede (zu Protokoll gegeben)` should bucket with `Rede`.
 */
export type ActivityBucket = ScoreComponent | "other"

export function bucketFor(aktivitaetsart: string): ActivityBucket {
  const kind = aktivitaetsart.toLowerCase()

  // Order matters, and this first case is why. A `Zwischenfrage` is a spoken
  // intervention during someone else's speech — §5.2 counts the intervener's
  // own words — so it belongs with speeches, not with the written Anfragen.
  // Checked before `anfrage` because it contains it as a substring.
  if (kind.includes("zwischenfrage") || kind.includes("kurzintervention")) return "speeches"

  // `Kleine Anfrage` and `Große Anfrage`: written questions the government must
  // answer. §3.5 shows these dominate the activity feed.
  if (kind.includes("anfrage")) return "questions"

  // `Rede`, `Rede (zu Protokoll gegeben)` — a written speech submitted for the
  // record, §5.2 — and `Schriftliche Erklärung gem. § 31 GO BT`.
  if (kind.includes("rede") || kind.includes("erklärung")) return "speeches"

  if (kind.includes("antrag") || kind.includes("entschließung")) return "motions"
  if (kind.includes("gesetzentwurf")) return "billSponsorships"
  if (kind.includes("bericht")) return "reports"

  return "other"
}

/** Weights, with any missing component falling back to its default. Accepts the
 * `null` that `customWeights` stores for "no override". */
export function resolveWeights(custom: Partial<ScoreWeights> | null | undefined): ScoreWeights {
  if (!custom) return DEFAULT_WEIGHTS
  const resolved = { ...DEFAULT_WEIGHTS }
  for (const component of SCORE_COMPONENTS) {
    const value = custom[component]
    // `Number.isFinite` rather than `!= null`: a NaN or Infinity reaching this
    // makes `totalScore` NaN, which then sorts unpredictably in the rankings
    // index and cannot be fixed by any later write.
    if (typeof value === "number" && Number.isFinite(value)) {
      resolved[component] = value
    }
  }
  return resolved
}

/**
 * The formula: a weighted sum, with every term retained.
 *
 * Linear on purpose. A curve — diminishing returns on speech volume, say —
 * would be defensible but it would also be an opinion the user cannot see, and
 * the whole point of storing `breakdown` is that a total can be taken apart.
 */
export function computeScore(
  inputs: ScoreInputs,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): { totalScore: number; breakdown: ScoreBreakdown } {
  const breakdown = {} as ScoreBreakdown
  let totalScore = 0
  for (const component of SCORE_COMPONENTS) {
    const raw = inputs[component]
    const weight = weights[component]
    const weighted = raw * weight
    breakdown[component] = { raw, weight, weighted }
    totalScore += weighted
  }
  // Rounded to two places: the rankings index sorts on this, and an unrounded
  // float makes two identical scores order arbitrarily on the last bit.
  return { totalScore: Math.round(totalScore * 100) / 100, breakdown }
}

/** Recomputes a stored total under different weights, from its own breakdown.
 * This is what the browser calls as a weight slider moves — the raw counts are
 * already in the document, so no query is needed. */
export function rescore(
  breakdown: ScoreBreakdown,
  weights: ScoreWeights,
): { totalScore: number; breakdown: ScoreBreakdown } {
  const inputs = {} as ScoreInputs
  for (const component of SCORE_COMPONENTS) {
    inputs[component] = breakdown[component].raw
  }
  return computeScore(inputs, weights)
}
