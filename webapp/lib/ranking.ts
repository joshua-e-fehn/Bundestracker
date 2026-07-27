/**
 * Competition ranking — the one rule, in one place.
 *
 * **Ties share a rank.** Two MPs on 40 speeches are both rank 3 and the next is
 * rank 5. The alternative, numbering by position, would break the tie by
 * whatever order the query happened to return — ingestion order — so two records
 * that are identical would be told one is ahead, and *which* one would change
 * between deployments. Ranking is the claim these pages make, so it must not
 * assert a difference the data does not have.
 *
 * That rule had three implementations before this module: `ranked` in
 * convex/rankings.ts, an inline loop in `getPartyMembers`, and a `sharedRank`
 * helper in components/party-score-table.tsx that rescanned backwards per row.
 * All three agreed, which is the point — three copies of a rule agree until one
 * of them is edited, and this one is subtle enough (the skip after a tied block
 * is the part people get wrong) that the drift would look like a real ordering.
 *
 * Deliberately outside `convex/` and free of React, like lib/scoring.ts and
 * lib/taxonomy.ts: the server ranks a roster and the browser numbers a table of
 * already-ranked rows, and both need the same answer.
 */

/**
 * Ranks for an **already-ordered** list of values, by position.
 *
 * Takes values rather than rows so it is agnostic about what is being ranked —
 * a score, a mean, a dissent count. The caller has already sorted; this only
 * numbers, which is what lets the same function serve a query that sorts and a
 * component that renders someone else's ordering.
 *
 * `null` means "no measured value" and yields **rank 0**, distinguishable from
 * every real rank because those start at 1. It does not consume a rank and does
 * not break a tied run — an unscored mandate is not in the ranking, it is beside
 * it, and the UI renders 0 as a dash. That is the same distinction
 * `getMPsWithScores` draws by returning null rather than 0: an MP the nightly
 * sweep has not reached and an MP who did nothing are different claims.
 *
 * ⚠ Ranks are positions in the list as given. Passing an unsorted list produces
 * numbers that are not ranks, and this function cannot tell — sorting is the
 * caller's, because only the caller knows the tie-break.
 */
export function competitionRanks(values: readonly (number | null)[]): number[] {
  const ranks: number[] = []
  let previousValue: number | null = null
  let previousRank = 0

  for (const [index, value] of values.entries()) {
    if (value === null) {
      ranks.push(0)
      continue
    }
    // `index + 1`, not a running counter: that is what makes the rank *after* a
    // tied block skip — two members sharing rank 3 are followed by rank 5.
    const rank = previousValue !== null && value === previousValue ? previousRank : index + 1
    ranks.push(rank)
    previousValue = value
    previousRank = rank
  }

  return ranks
}
