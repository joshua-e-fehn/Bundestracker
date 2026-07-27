/**
 * Reading a dissent tally — the rate, and when it is worth marking.
 *
 * The *rule* for what counts as a dissent lives in convex/votes.ts (`majorityOf`
 * and `isRebel`) and is applied once, at ingest, against a whole ballot. Nothing
 * here re-derives it. This module answers the two questions that come after the
 * counting, both of which the browser asks and the server also has to know:
 *
 *  1. What is the rate, given a count and a denominator that may be zero?
 *  2. Is it high enough to put a mark on someone's name?
 *
 * Outside `convex/` and free of React, like lib/scoring.ts and lib/ranking.ts,
 * for the same reason: the card, the profile and the leaderboard all show this
 * number, and three copies of "is this MP notable" is how one of them ends up
 * badging a member who cast four votes.
 */

/** What a maintained tally holds. Structural, so a caller can pass a Convex row,
 * a leaderboard row or a test fixture without adapting any of them. */
export type DissentTally = {
  /** Ballots voted against the own group's line. */
  dissents: number
  /** Cast votes with a group to be measured against — the denominator. */
  ballotsCast: number
}

/**
 * Dissents as a share of votes cast, or **null** when nothing was cast.
 *
 * Null rather than 0, and the distinction is the whole point: an MP who cast no
 * vote in any named ballot has no dissent rate, where 0 says "voted, always with
 * the group". Rendering the first as the second would credit an absent member
 * with perfect loyalty. The same choice `voteParticipation` in convex/votes.ts
 * makes for the same reason.
 */
export function dissentRate(tally: DissentTally): number | null {
  if (!Number.isFinite(tally.ballotsCast) || tally.ballotsCast <= 0) return null
  return tally.dissents / tally.ballotsCast
}

/**
 * The rate at which a card marks a member — 5 % of votes cast.
 *
 * Chosen against the shape of the data rather than as a round number: named
 * ballots are whipped and near-unanimous inside every group (see
 * `parties.disciplineCaveat`), so group-line agreement sits between 97 % and
 * 100 % and a member breaking with their group in one vote in twenty is well
 * outside that band. A 1 % threshold would mark most of the chamber and say
 * nothing.
 */
export const DISSENT_BADGE_RATE = 0.05

/**
 * Votes cast below which no rate is claimed at all.
 *
 * ⚠ The part that is easy to leave out, and the reason this is a function rather
 * than a `>` at three call sites. A member sworn in last week may have cast one
 * ballot; if they broke with their group in it, their rate is 100 % and they
 * would carry the loudest mark on the site for a single vote. Twenty is the
 * point at which one dissent (5 %) is exactly the threshold, so the badge's two
 * constants are the same statement read two ways: *at least one dissent in
 * twenty votes, measured over at least twenty*.
 *
 * Below it the honest answer is no mark — not a low rate, and not a zero.
 */
export const DISSENT_MIN_BALLOTS = 20

/**
 * Whether this member's dissent is worth marking on a card.
 *
 * Both conditions, always. `rate >= DISSENT_BADGE_RATE` alone badges the
 * one-vote newcomer; `ballotsCast >= DISSENT_MIN_BALLOTS` alone badges nobody
 * interesting. See the two constants above.
 *
 * Takes `null | undefined` because the tally is genuinely absent for a member
 * the backfill has not reached, and every caller would otherwise write the same
 * guard — which is how one of them writes `?? 0` instead and badges an unmeasured
 * member with a confident zero.
 */
export function isNotableDissenter(tally: DissentTally | null | undefined): boolean {
  if (!tally) return false
  if (tally.ballotsCast < DISSENT_MIN_BALLOTS) return false
  const rate = dissentRate(tally)
  return rate !== null && rate >= DISSENT_BADGE_RATE
}
