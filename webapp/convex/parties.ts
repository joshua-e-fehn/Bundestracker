import { v } from "convex/values"
// Relative, not "@/lib/...": convex/tsconfig.json defines no path aliases.
import { PARTY_KEYS, type PartyKey, partyFor } from "../lib/parties"
import { competitionRanks } from "../lib/ranking"
import { mandateType, RANKING_METRICS } from "../lib/taxonomy"
import type { Doc } from "./_generated/dataModel"
import { type QueryCtx, query } from "./_generated/server"
import { literalUnion } from "./lib/validators"
import { photoFields } from "./mps"
import { majorityOf } from "./votes"

/**
 * Fraktionen compared against each other — the `/parties` dashboard.
 *
 * ## Why this is a module and not a slice of `rankings.ts`
 *
 * That one ranks *members* and filters by group. This one makes the group the
 * unit of analysis, which changes three things that cannot be expressed as
 * arguments to a member query:
 *
 *  - **The grouping key is a folded party key, not `mps.fraktion`.** The sources
 *    spell one Fraktion at least four ways (§6.4, and §5.2's non-breaking
 *    space), and this is not hypothetical bookkeeping: a live deployment
 *    produced `Fraktionslos` and `fraktionslos` as two rows of
 *    `getFractionSizes`, which components/seating-legend.tsx now folds back
 *    together in the browser. Grouping through `partyFor` here means the
 *    dashboard never has that bug to fix, and the legend's workaround does not
 *    have to be copied into six more places.
 *  - **Nothing is summed.** Every figure returned is a mean per scored member.
 *    convex/stats.ts sets out why a per-MP count may not be added up — §3.4's
 *    "one record per MP per document", so a forty-signatory Kleine Anfrage is
 *    forty rows — and the error would scale with party size, which is the very
 *    axis this page compares on. See lib/party-comparison.ts' header.
 *  - **Discipline is not a column anywhere.** It exists only relative to how the
 *    rest of a group voted in the same division, so it is computed from ballots
 *    like `getCrossPartyRankings`, and bounded the same way.
 *
 * ## Read cost
 *
 * `getPartyComparison` is bounded by the roster: one indexed scan of a period's
 * `mps` (630-odd, §6.2) and one of its period `activityScores` (the same),
 * which is the bound convex/rankings.ts already relies on and two orders of
 * magnitude inside Convex's ~16 000-document budget.
 *
 * `getPartyDiscipline` is not, and says so at length where it is defined.
 */

// --- read models ----------------------------------------------------------

const partyKey = literalUnion(PARTY_KEYS as unknown as readonly [PartyKey, PartyKey, ...PartyKey[]])

/**
 * One value per rankable metric.
 *
 * Built from `RANKING_METRICS` rather than restated, the same guard
 * `scoreWeights` puts on `SCORE_COMPONENTS` in convex/schema.ts: a metric added
 * to lib/taxonomy.ts is a type error here until it is handled, rather than a
 * field the UI reads as `undefined` and renders as a zero bar.
 */
const metricValues = v.object({
  totalScore: v.number(),
  motionCount: v.number(),
  speechCount: v.number(),
  speechWordCount: v.number(),
  questionCount: v.number(),
  reportCount: v.number(),
  voteParticipationRate: v.number(),
  committeeCount: v.number(),
  billSponsorshipCount: v.number(),
})

const partyAggregate = v.object({
  partyKey,
  /** Mandates folded into this group, scored or not — the seat count. */
  mandates: v.number(),
  /** Mandates with a period score row. The denominator of every mean. */
  scored: v.number(),
  means: metricValues,
  medianScore: v.number(),
  /** Mandates by how they were won. A count, not a mean — see `PartyAggregate`
   * in lib/party-comparison.ts, which explains why this one figure is allowed
   * to be a total and why `unknown` is a third bucket rather than folded into
   * `list`. Sums to `mandates`. */
  mandateSplit: v.object({
    direct: v.number(),
    list: v.number(),
    unknown: v.number(),
  }),
})

/** One MP in a party's own ranked list. A trimmed `rankingRow` — this table
 * shows a name, a portrait and a score, so the nine metric columns and the
 * breakdown would be read and discarded. */
const partyMemberRow = v.object({
  rank: v.number(),
  mpInternalId: v.string(),
  name: v.string(),
  fraktion: v.string(),
  ...photoFields,
  constituency: v.union(v.null(), v.string()),
  /** Null, never 0, for a mandate the nightly sweep has not reached. The
   * distinction `getMPsWithScores` draws for the same reason: an unscored MP
   * and an inactive one are different claims, and a 0 in a ranked column
   * asserts the second. Unscored members sort last regardless of direction. */
  totalScore: v.union(v.null(), v.number()),
  voteParticipationRate: v.union(v.null(), v.number()),
})

// --- aggregation -----------------------------------------------------------

/** A running total per metric, plus the scores the median is taken over. */
type Accumulator = {
  mandates: number
  scored: number
  sums: Record<string, number>
  scores: number[]
  /** Counted off the roster, so unlike every other figure here it is complete
   * rather than bounded by the sweep. See `mandateSplit` on `partyAggregate`. */
  mandateSplit: { direct: number; list: number; unknown: number }
}

function emptyAccumulator(): Accumulator {
  const sums: Record<string, number> = {}
  for (const metric of RANKING_METRICS) sums[metric] = 0
  return {
    mandates: 0,
    scored: 0,
    sums,
    scores: [],
    mandateSplit: { direct: 0, list: 0, unknown: 0 },
  }
}

/**
 * The middle value of a sorted list, or the mean of the middle two.
 *
 * Sorted here rather than assumed: the caller accumulates in roster order.
 * Returns 0 for an empty list, which is only reachable for a group with no
 * scored member — and `rankPartiesBy` drops those before anything is drawn, so
 * the zero never reaches a chart.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * A period's roster and its period-total scores, joined and folded by party.
 *
 * Shared by both public queries below so the seat counts on the dashboard and
 * the member list of one party cannot disagree about who is in a group.
 */
async function rosterByParty(
  ctx: QueryCtx,
  wahlperiode: number,
): Promise<{
  mps: Doc<"mps">[]
  scores: Map<string, Doc<"activityScores">>
}> {
  const [mps, scoreRows] = await Promise.all([
    ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", wahlperiode))
      .collect(),
    ctx.db
      .query("activityScores")
      .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
        // The period total only. The monthly rows are its parts, so reading
        // both would count every MP once per month they were scored in — see
        // the note on `activityScoreInput` in convex/schema.ts.
        q
          .eq("wahlperiode", wahlperiode)
          .eq("month", null),
      )
      .collect(),
  ])
  return { mps, scores: new Map(scoreRows.map((row) => [row.mpInternalId, row])) }
}

// --- public queries --------------------------------------------------------

/**
 * Every Fraktion's mean activity, for one period — the dashboard's one read.
 *
 * One query rather than one per chart: the ranked table, the radar and the nine
 * bar charts are three views of the same 6×9 grid of numbers, and fetching it
 * three times would be three chances for them to disagree about what a party's
 * mean is. It is a handful of rows on the wire.
 *
 * Groups are returned even when no member has been scored — `scored: 0`, every
 * mean 0 — rather than omitted. A group that exists on the roster and has no
 * scores is a fact about the nightly sweep, and dropping it would make a
 * partly-swept deployment look like a smaller Bundestag. The consumers filter
 * them out of charts (`rankPartiesBy`) and the page states the gap.
 */
export const getPartyComparison = query({
  args: { wahlperiode: v.number() },
  returns: v.object({
    parties: v.array(partyAggregate),
    /** Mandates on the roster, across every group — the denominator for
     * "these figures cover N of M members". */
    totalMandates: v.number(),
    /** Mandates with a period score row. Below `totalMandates` whenever the
     * sweep has not reached everyone, which the page says rather than quietly
     * averaging over whoever happens to have a row. */
    totalScored: v.number(),
  }),
  handler: async (ctx, args) => {
    const { mps, scores } = await rosterByParty(ctx, args.wahlperiode)

    const byParty = new Map<PartyKey, Accumulator>()
    let totalScored = 0

    for (const mp of mps) {
      const key = partyFor(mp.fraktion).key
      const accumulator = byParty.get(key) ?? emptyAccumulator()
      accumulator.mandates++

      // Off the stored `MANDATSART`, narrowed through the shared vocabulary —
      // never derived from `constituency === null`. The two agree today and are
      // different claims, and here the difference would be visible: a direct
      // mandate whose constituency name failed to ingest would move a segment
      // from one side of the bar to the other rather than into `unknown`.
      const mandate = mandateType(mp.electionMethod)
      if (mandate === "Direktwahl") accumulator.mandateSplit.direct++
      else if (mandate === "Landesliste") accumulator.mandateSplit.list++
      else accumulator.mandateSplit.unknown++

      const score = scores.get(mp.internalId)
      if (score) {
        accumulator.scored++
        totalScored++
        accumulator.scores.push(score.totalScore)
        // Read off the score row by name rather than spread, so a field renamed
        // in the schema is a compile error here rather than a silent zero.
        accumulator.sums.totalScore += score.totalScore
        accumulator.sums.motionCount += score.motionCount
        accumulator.sums.speechCount += score.speechCount
        accumulator.sums.speechWordCount += score.speechWordCount
        accumulator.sums.questionCount += score.questionCount
        accumulator.sums.reportCount += score.reportCount
        accumulator.sums.voteParticipationRate += score.voteParticipationRate
        accumulator.sums.committeeCount += score.committeeCount
        accumulator.sums.billSponsorshipCount += score.billSponsorshipCount
      }

      byParty.set(key, accumulator)
    }

    const parties = [...byParty.entries()]
      .map(([key, accumulator]) => {
        const means = {
          totalScore: 0,
          motionCount: 0,
          speechCount: 0,
          speechWordCount: 0,
          questionCount: 0,
          reportCount: 0,
          voteParticipationRate: 0,
          committeeCount: 0,
          billSponsorshipCount: 0,
        }
        if (accumulator.scored > 0) {
          for (const metric of RANKING_METRICS) {
            means[metric] = accumulator.sums[metric] / accumulator.scored
          }
        }
        return {
          partyKey: key,
          mandates: accumulator.mandates,
          scored: accumulator.scored,
          means,
          medianScore: median(accumulator.scores),
          mandateSplit: accumulator.mandateSplit,
        }
      })
      // Largest group first, so the table and the radar's legend read like the
      // chamber — the same ordering `getFractionSizes` and `breakdownRows` use,
      // and for the reason stated there: listing alphabetically opens on the
      // three-member group. Ties break on the key so the order is stable.
      .sort((a, b) => b.mandates - a.mandates || a.partyKey.localeCompare(b.partyKey))

    return { parties, totalMandates: mps.length, totalScored }
  },
})

/**
 * One Fraktion's members, ranked by activity score — what a party's page shows.
 *
 * Scoped through `partyFor` rather than by an exact `fraktion` string, which is
 * the whole reason this is not `getMPsWithScores` with a filter: that one
 * narrows through the `by_wahlperiode_and_fraktion` index on the stored
 * spelling, so a group recorded two ways returns half its members and the other
 * half appear nowhere. Reading the period's roster and folding is the only way
 * to be sure a party page lists its whole party.
 *
 * Unscored mandates are returned with `totalScore: null` and sorted last. They
 * are members of the group, so omitting them would make the list disagree with
 * the seat count above it — but they have no measured activity to rank, and
 * placing them at "least active" would assert one.
 */
export const getPartyMembers = query({
  args: {
    wahlperiode: v.number(),
    party: partyKey,
    limit: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(partyMemberRow),
    /** Members of the group, scored or not — the size of the whole list, so a
     * truncated page is distinguishable from a small Fraktion. */
    total: v.number(),
    /** How many of them carry a score. The denominator every rank here is
     * against; the rest are the tail. */
    scored: v.number(),
  }),
  handler: async (ctx, args) => {
    const { mps, scores } = await rosterByParty(ctx, args.wahlperiode)

    const members = mps.filter((mp) => partyFor(mp.fraktion).key === args.party)

    const rows = members.map((mp) => {
      const score = scores.get(mp.internalId)
      return {
        mpInternalId: mp.internalId,
        name: mp.name,
        fraktion: mp.fraktion,
        photoUrl: mp.photoUrl,
        photoCredit: mp.photoCredit ?? null,
        constituency: mp.constituency,
        totalScore: score?.totalScore ?? null,
        voteParticipationRate: score?.voteParticipationRate ?? null,
      }
    })

    // Scored first, descending; unscored last in alphabetical order. Ranks are
    // assigned only to the scored ones — see below.
    rows.sort((a, b) => {
      if (a.totalScore === null && b.totalScore === null) {
        return a.name.localeCompare(b.name, "de")
      }
      if (a.totalScore === null) return 1
      if (b.totalScore === null) return -1
      return b.totalScore - a.totalScore || a.name.localeCompare(b.name, "de")
    })

    // Competition ranking over the scored members — `competitionRanks` in
    // lib/ranking.ts, the same function convex/rankings.ts numbers its
    // leaderboards with, so a Fraktion's own list and the chamber-wide board
    // cannot disagree about what a tie means. Rank 0 is its marker for an
    // unscored mandate; the table renders it as a dash.
    const ranks = competitionRanks(rows.map((row) => row.totalScore))
    const ranked = rows.map((row, index) => ({ ...row, rank: ranks[index] }))

    const limit = args.limit === undefined ? ranked.length : Math.max(1, Math.floor(args.limit))
    return {
      rows: ranked.slice(0, limit),
      total: ranked.length,
      scored: ranked.filter((row) => row.rank > 0).length,
    }
  },
})

/**
 * How often each Fraktion's members vote with their own group's majority.
 *
 * ## What the figure means
 *
 * The complement of `getCrossPartyRankings`, aggregated by group rather than by
 * member, and it applies exactly the same rule so the two can never disagree
 * about who dissented:
 *
 *  - A group's line on a ballot is the **modal vote among members who cast
 *    one**, via `majorityOf` (convex/votes.ts) — the same function the ballot
 *    page and the profile page use.
 *  - **Absences are excluded from both numerator and denominator.**
 *    `nichtabgegeben` is "did not vote" (§4.1), not a position, so it cannot
 *    contradict one. Counting it as indiscipline would rank the members who turn
 *    up least as the most loyal or the least, depending which way you counted —
 *    both meaningless.
 *  - A group with **no line** on a ballot — an exact split, or nobody voting —
 *    contributes nothing from that ballot. There is no line to keep.
 *  - The group is `partyAtVote` where the ballot recorded one, falling back to
 *    the roster's current Fraktion, then folded through `partyFor`. §6.4 records
 *    six WP21 members changing group mid-period; reading a March vote against
 *    their July group would manufacture dissent out of a transfer.
 *
 * ⚠ **A high figure is not a finding about a party's character.** Most named
 * ballots are whipped and near-unanimous within every group, so the interesting
 * signal is the small difference between 97 % and 99 %, not the level. The page
 * says so — `parties.disciplineCaveat`.
 *
 * ## The read this makes, and why it is bounded
 *
 * The one query in this module whose cost is not bounded by the roster, exactly
 * as `getCrossPartyRankings` is not: it reads the period's ballots and every
 * vote record on them, ~630 per ballot, so ~25 ballots reach Convex's ~16 000
 * read limit. `maxBallots` bounds it explicitly at a default of 20 and the
 * response states the window it used, because a discipline rate computed over an
 * unnamed subset of ballots is a number with no meaning. A period-wide figure
 * needs the tally maintained at ingest; that is a schema change and belongs with
 * the pipeline.
 */
export const getPartyDiscipline = query({
  args: {
    wahlperiode: v.number(),
    /** Most recent ballots to examine. See the read-cost note above. */
    maxBallots: v.optional(v.number()),
  },
  returns: v.object({
    parties: v.array(
      v.object({
        partyKey,
        /** Votes cast in line with the group's majority. */
        withLine: v.number(),
        /** Votes cast against it. */
        against: v.number(),
        /** `withLine + against` — cast votes on ballots where the group had a
         * line. The denominator, without which the rate cannot be read. */
        cast: v.number(),
        /** `withLine / cast`, or 0 when nothing was cast. */
        rate: v.number(),
        /** Ballots in the window where this group had a line at all. Below
         * `ballotsExamined` when a group split exactly, or did not vote. */
        ballots: v.number(),
      }),
    ),
    /** The window actually examined, so the page can state it. */
    ballotsExamined: v.number(),
  }),
  handler: async (ctx, args) => {
    // 20 ballots × ~630 records ≈ 12 600 documents, inside the ~16 000 limit
    // with room for the roster and the sheets themselves — the same arithmetic
    // and the same ceiling as `getCrossPartyRankings`.
    const maxBallots = Math.max(1, Math.min(40, Math.floor(args.maxBallots ?? 20)))

    const sheets = await ctx.db
      .query("voteSheets")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .take(maxBallots)

    const roster = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()
    const fraktionOf = new Map(roster.map((mp) => [mp.internalId, mp.fraktion]))

    type Tally = { withLine: number; against: number; ballots: number }
    const tallies = new Map<PartyKey, Tally>()

    for (const sheet of sheets) {
      const records = await ctx.db
        .query("voteRecords")
        .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
        .collect()

      // Group this ballot's cast votes by folded party, then take each group's
      // modal position as its line.
      const votesByParty = new Map<PartyKey, Array<Doc<"voteRecords">["vote"]>>()
      for (const record of records) {
        if (record.vote === "absent") continue
        const group = record.partyAtVote ?? fraktionOf.get(record.mpInternalId)
        if (group === undefined || group === "") continue
        const key = partyFor(group).key
        const votes = votesByParty.get(key) ?? []
        votes.push(record.vote)
        votesByParty.set(key, votes)
      }

      for (const [key, votes] of votesByParty) {
        const line = majorityOf(votes)
        // No line — an exact split, which `majorityOf` reports as null rather
        // than picking one of two tied positions and calling the other half
        // rebels. Nobody in the group is on or off a line that does not exist.
        if (line === null) continue
        const tally = tallies.get(key) ?? { withLine: 0, against: 0, ballots: 0 }
        tally.ballots++
        for (const vote of votes) {
          if (vote === line.vote) tally.withLine++
          else tally.against++
        }
        tallies.set(key, tally)
      }
    }

    const parties = [...tallies.entries()]
      .map(([key, tally]) => {
        const cast = tally.withLine + tally.against
        return {
          partyKey: key,
          withLine: tally.withLine,
          against: tally.against,
          cast,
          rate: cast === 0 ? 0 : tally.withLine / cast,
          ballots: tally.ballots,
        }
      })
      // Most disciplined first. Ties break on the key so a redraw cannot
      // reshuffle two groups that whipped identically.
      .sort((a, b) => b.rate - a.rate || a.partyKey.localeCompare(b.partyKey))

    return { parties, ballotsExamined: sheets.length }
  },
})
