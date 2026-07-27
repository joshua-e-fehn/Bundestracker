import { v } from "convex/values"
// Relative, not "@/lib/...": convex/tsconfig.json defines no path aliases —
// the same import shape convex/parties.ts uses.
import {
  QUORUM_SHARE,
  type QuorumCombination,
  quorumSummary,
  RULED_OUT_AS_OF,
} from "../lib/inquiry"
import { PARTY_KEYS, type PartyKey } from "../lib/parties"
import { query } from "./_generated/server"
import { literalUnion } from "./lib/validators"

/**
 * The Untersuchungsausschuss quorum — Art. 44(1) GG, evaluated against a
 * period's roster.
 *
 * ## Why this is a query at all, when the arithmetic is in lib/
 *
 * The arithmetic *is* in lib/inquiry.ts, and deliberately: it is pure, tested,
 * and shared. What this adds is the one thing the browser cannot do — read the
 * roster. It counts a period's mandates by Fraktion and hands them to
 * `quorumSummary`, so the page makes **one** subscription instead of fetching
 * group sizes and then recomputing a threshold client-side against a total it
 * derived separately.
 *
 * That matters beyond round trips. `getFractionSizes` returns counts per stored
 * spelling, and the fold onto one entry per party (§6.4, §5.2) is what decides
 * whether a bloc is tested against the threshold whole or in halves. Doing it
 * once, server-side, means the seat table, the combination list and the summary
 * sentence are three views of one computation rather than three chances to fold
 * differently — the failure `foldFractionSizes` was extracted to prevent.
 *
 * ## ⚠ Half of this response is maintained, not sourced
 *
 * `seats`, `totalSeats`, `threshold` and every `reaches` are counted from the
 * roster: official, checkable, the one seating fact §9 says is derivable.
 * `blocked` and `blockedBy` come from `RULED_OUT` in lib/inquiry.ts, which is a
 * hand-maintained political fact in the same sense as `GOVERNING_PARTIES` — no
 * Bundestag dataset records who refuses to work with whom.
 *
 * The response keeps them in separate fields all the way to the renderer and
 * carries `ruledOutAsOf` so the page can date the editorial half. Returning a
 * single "viable" boolean would have been smaller and would have laundered an
 * editorial claim into what looks like a computed result.
 *
 * ## Read cost
 *
 * One indexed scan of a period's `mps` — 630-odd rows (§6.2), the same bound
 * `getFractionSizes` and `getPartyComparison` already rely on, two orders of
 * magnitude inside Convex's ~16 000-document budget. Nothing else is read.
 */

const partyKey = literalUnion(PARTY_KEYS as unknown as readonly [PartyKey, PartyKey, ...PartyKey[]])

/** One group's seats and share. `fraktion` is the stored spelling that
 * represented the folded group, which `partyLabel` maps to a canonical short
 * form — and which an unrecognised group keeps as its own label rather than
 * collapsing to a dash. */
const quorumGroup = v.object({
  party: partyKey,
  fraktion: v.string(),
  seats: v.number(),
  share: v.number(),
  reachesAlone: v.boolean(),
  /** Whether these seats may count toward a *joint* motion. False for
   * `fraktionslos` and `unknown`, which are residual categories rather than
   * blocs — they stay in `totalSeats`, since the quarter is a quarter of all
   * members. See `eligibleGroups`. */
  eligible: v.boolean(),
  /** ⚠ Government or opposition — maintained, like the exclusions. */
  role: literalUnion(["government", "opposition", "unknown"]),
})

const quorumCombination = v.object({
  parties: v.array(partyKey),
  seats: v.number(),
  share: v.number(),
  /** Counted from the roster. */
  reaches: v.boolean(),
  /** ⚠ From the maintained exclusion table, not from any record. */
  blocked: v.boolean(),
  blockedBy: v.array(v.object({ a: partyKey, b: partyKey })),
  viable: v.boolean(),
})

/**
 * Tuples flattened to objects for the wire.
 *
 * `[PartyKey, PartyKey]` is the right shape in TypeScript and is not
 * expressible as a Convex validator — `v.array(partyKey)` would accept a
 * three-element array and lose the pairing the field exists to carry. Named
 * fields say "two parties, and which is which" in the response itself, so a
 * consumer reading `blockedBy` does not have to know that index 0 and index 1
 * mean something.
 */
function serialiseCombination(combination: QuorumCombination) {
  return {
    parties: combination.parties,
    seats: combination.seats,
    share: combination.share,
    reaches: combination.reaches,
    blocked: combination.blocked,
    blockedBy: combination.blockedBy.map(([a, b]) => ({ a, b })),
    viable: combination.viable,
  }
}

/**
 * The opposition-only answer — the scope in which this page has a finding.
 *
 * ⚠ Null when the period's coalition is unrecorded. See `oppositionScope`: an
 * opposition inferred by treating every group as opposition would be a fiction,
 * and the page says "not available for this period" instead.
 */
const oppositionScope = v.object({
  /** The non-governing groups, in arc order. */
  groups: v.array(quorumGroup),
  /** Their seats in total — below the threshold in WP21 once the AfD is set
   * aside, which is what the page leads with. */
  seats: v.number(),
  combinations: v.array(quorumCombination),
  reachingCount: v.number(),
  viableCount: v.number(),
  blockedCount: v.number(),
  /** Seats the largest unblocked opposition combination still lacks. Nine, in
   * WP21. Null when one reaches. */
  shortfall: v.union(v.null(), v.number()),
})

/**
 * Every Fraktion's seats, the quarter they are measured against, and every
 * one-, two- and three-group combination — for one period.
 *
 * Returns the **full** combination list rather than only the ones that reach.
 * The near misses are the page's actual finding: a reader asking why no inquiry
 * can be established needs the combinations that fail and by how much, not a
 * filtered list of successes that answers a different question. It is a few
 * dozen rows.
 *
 * An empty roster yields `totalSeats: 0`, `threshold: 0` and no rows rather
 * than a threshold computed from nothing — see `quorumThreshold`, and the same
 * decision `getCurrentWahlperiode` makes by returning null. A fresh deployment
 * has no roster until the first pipeline run, and a page reporting that one
 * signature compels an inquiry would be worse than a page saying it has no data.
 */
export const getQuorum = query({
  args: {
    wahlperiode: v.number(),
    /** Largest combination to enumerate. Defaults to 3, the size beyond which
     * a combination is arithmetically true and politically meaningless — see
     * `quorumCombinations`. Bounded at 4 so a caller cannot ask for the full
     * power set of a chamber. */
    maxSize: v.optional(v.number()),
  },
  returns: v.object({
    wahlperiode: v.number(),
    /** Mandates on the roster. The quarter is a quarter of *this*. */
    totalSeats: v.number(),
    /** Signatures that compel an inquiry — `ceil(totalSeats / 4)`. */
    threshold: v.number(),
    /** The constitutional share itself, so the page states the rule rather
     * than a number it asks the reader to trust. */
    share: v.number(),
    groups: v.array(quorumGroup),
    combinations: v.array(quorumCombination),
    /** Combinations at or above the threshold with no declared refusal. Empty
     * in this Bundestag, which is the whole finding. */
    viableCount: v.number(),
    /** Reaching combinations blocked by a declared refusal. */
    blockedCount: v.number(),
    /** Seats the largest unblocked combination still lacks, or null when one
     * reaches. Null rather than 0 — "no shortfall" and "short by zero" are
     * different claims. */
    shortfall: v.union(v.null(), v.number()),
    /** ⚠ The same question over the opposition groups alone — the scope in
     * which the answer is a finding. Null where the coalition is unrecorded. */
    opposition: v.union(v.null(), oppositionScope),
    /** ⚠ When the exclusion table was last checked. Rendered on the page: a
     * maintained fact with no date is one nobody can tell is stale. */
    ruledOutAsOf: v.string(),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    // Counted by stored spelling here and folded onto one entry per party
    // inside `quorumSummary` — the same two steps `getFractionSizes` and
    // `foldFractionSizes` take, through the same functions, so this page and
    // the seating map cannot disagree about how large a Fraktion is.
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.fraktion, (counts.get(row.fraktion) ?? 0) + 1)
    const sizes = [...counts.entries()].map(([fraktion, count]) => ({ fraktion, count }))

    const maxSize = Math.max(1, Math.min(4, Math.floor(args.maxSize ?? 3)))
    const summary = quorumSummary(sizes, args.wahlperiode, { maxSize })
    const { opposition } = summary

    return {
      wahlperiode: args.wahlperiode,
      totalSeats: summary.totalSeats,
      threshold: summary.threshold,
      share: QUORUM_SHARE,
      groups: summary.groups,
      combinations: summary.combinations.map(serialiseCombination),
      viableCount: summary.viable.length,
      blockedCount: summary.blocked.length,
      shortfall: summary.shortfall,
      opposition:
        opposition === null
          ? null
          : {
              groups: opposition.groups,
              seats: opposition.seats,
              combinations: opposition.combinations.map(serialiseCombination),
              reachingCount: opposition.reaching.length,
              viableCount: opposition.viable.length,
              blockedCount: opposition.blocked.length,
              shortfall: opposition.shortfall,
            },
      ruledOutAsOf: RULED_OUT_AS_OF,
    }
  },
})
