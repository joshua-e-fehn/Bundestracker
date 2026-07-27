import { type Validator, v } from "convex/values"
// Relative, not "@/lib/...": convex/tsconfig.json defines no path aliases.
import { occupationOf, stateOf } from "../lib/bundestag"
import {
  AGE_GROUP_KEYS,
  type AgeGroup,
  inAgeGroup,
  RANKING_METRICS,
  type RankingMetric,
} from "../lib/taxonomy"
import type { Doc } from "./_generated/dataModel"
import { type QueryCtx, query } from "./_generated/server"
import { monthWindow } from "./activityScores"
import { pageLimit } from "./lib/ingest"
import { literalUnion } from "./lib/validators"
import { scoreBreakdown } from "./schema"

/**
 * The leaderboards.
 *
 * `activityScores.getRankings` already answers "top N by total score" straight
 * off the `by_wahlperiode_and_month_and_totalScore` index, and that remains the
 * right shape for the home page's top five. This module exists for the nine
 * boards the rankings page needs, which that query cannot serve:
 *
 *  - **Eight of them rank by a different column.** The index is keyed on
 *    `totalScore`, so "most speeches" is not a slice of it — the rows have to be
 *    read and re-sorted. See `roster` below for the bound that makes that safe.
 *  - **All of them filter.** By Fraktion, by federal state, by age group — none
 *    of which live on `activityScores`; they are roster fields, so a filtered
 *    board is a join, and a `.take(50)` before the join returns a page that is
 *    50 rows *before* filtering and often far fewer after. That is the failure
 *    mode this whole file is arranged to avoid: a short page is
 *    indistinguishable from "there are no more".
 *  - **Two are not columns at all.** Cross-party dissent is computed from
 *    ballots (`crossPartyVotes`), and "rising this month" compares two months
 *    (`getRisingRankings`). Neither is a field anything could be indexed on.
 *
 * ## Why these queries collect the period and sort in memory
 *
 * A Wahlperiode is 630-odd MPs and therefore 630-odd `activityScores` rows for
 * any one month — two orders of magnitude inside Convex's ~16 000-document read
 * limit, and the same bound `mps.getFractionSizes` and `seating.generateSeating`
 * already rely on. Ranking is inherently whole-population: "rank 51" has no
 * meaning computed over an arbitrary 50 rows, so paging *before* ranking would
 * produce numbered rows that are not ranks. The page boundary therefore belongs
 * after the sort, which is where `limit`/`offset` apply it.
 *
 * The one query here that is not bounded by the roster is `crossPartyVotes`,
 * and it says so at length.
 */

// --- read models ----------------------------------------------------------

/**
 * One row of a leaderboard.
 *
 * Every metric rides along rather than only the one being ranked, so the table
 * can show "speeches, and the word count beside it" without a second query, and
 * so switching tabs re-sorts data the client already has. It is 630 small rows;
 * the alternative is nine queries returning nine subsets of the same document.
 */
const rankingRow = v.object({
  rank: v.number(),
  mpInternalId: v.string(),
  name: v.string(),
  fraktion: v.string(),
  party: v.string(),
  photoUrl: v.union(v.null(), v.string()),
  /** What the MP does now (abgeordnetenwatch, 88.1 % of WP21), falling back to
   * what they did before (Stammdaten `BERUF`, 94.3 %). Resolved server-side so
   * the member table's occupation column is one field rather than two the
   * client has to choose between. */
  occupation: v.union(v.null(), v.string()),
  /** Federal state, from the constituency (`WKR_LAND`) — null for a list MP
   * whose record carries no state. See `stateOf`. */
  state: v.union(v.null(), v.string()),
  birthDate: v.union(v.null(), v.string()),
  totalScore: v.number(),
  motionCount: v.number(),
  speechCount: v.number(),
  speechWordCount: v.number(),
  questionCount: v.number(),
  reportCount: v.number(),
  voteParticipationRate: v.number(),
  committeeCount: v.number(),
  billSponsorshipCount: v.number(),
  scoreBreakdown,
})

const rankingMetric: Validator<RankingMetric> = literalUnion(RANKING_METRICS)

/** `AGE_GROUP_KEYS` is `AgeGroup[]`, not a tuple, so its arity is asserted here
 * rather than inferred — `AGE_GROUPS` is an object literal and `Object.keys`
 * cannot preserve how many entries it had. The annotation still catches a group
 * added to lib/taxonomy.ts without being accepted here. */
const ageGroup: Validator<AgeGroup> = literalUnion(
  AGE_GROUP_KEYS as unknown as readonly [AgeGroup, AgeGroup, ...AgeGroup[]],
)

/** Filters every board accepts. Optional throughout: absent means "no filter",
 * which is distinct from a filter matching nothing. */
const rankingFilters = {
  fraktion: v.optional(v.string()),
  state: v.optional(v.string()),
  ageGroup: v.optional(ageGroup),
}

/** Where a page starts and how long it is. `offset` rather than a cursor
 * because the rank *is* the offset — a reader on page 2 of "most speeches" is
 * asking for ranks 51…100, and a cursor would make that the one thing the API
 * could not express. */
const pageArgs = {
  limit: v.optional(v.number()),
  offset: v.optional(v.number()),
}

/** A page, plus the size of the whole board. `total` is what lets the UI say
 * "51–100 of 630" and know there is a next page — without it, a full page is
 * indistinguishable from the last one. */
function paged<T>(rows: T[], offset: number, limit: number) {
  return { rows: rows.slice(offset, offset + limit), total: rows.length }
}

// --- roster join ----------------------------------------------------------

/**
 * The roster for one period, by `internalId`.
 *
 * Read once per query and shared by every row, rather than `mpLabel` per score.
 * `mpLabel` is the right tool for a handful of rows and the wrong one for 630 —
 * it is an indexed lookup each, so a leaderboard would issue 630 of them where
 * one full scan of a 630-row table does. The extra fields (`party`,
 * `constituency`, `birthDate`) are what the filters need and `mpLabel` does not
 * return.
 */
async function roster(ctx: QueryCtx, wahlperiode: number): Promise<Map<string, Doc<"mps">>> {
  const rows = await ctx.db
    .query("mps")
    .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", wahlperiode))
    .collect()
  return new Map(rows.map((mp) => [mp.internalId, mp]))
}

type Filters = { fraktion?: string; state?: string; ageGroup?: AgeGroup }

/**
 * Whether a mandate passes the filters.
 *
 * `nowMs` is threaded in rather than read from `Date.now()` here so every row in
 * one query is bracketed against the same instant — an MP whose birthday falls
 * mid-query should not land in two different brackets.
 */
function passes(mp: Doc<"mps">, filters: Filters, nowMs: number): boolean {
  if (filters.fraktion !== undefined && mp.fraktion !== filters.fraktion) return false
  if (filters.state !== undefined && stateOf(mp.constituency) !== filters.state) return false
  if (filters.ageGroup !== undefined && !inAgeGroup(mp.birthDate, filters.ageGroup, nowMs)) {
    return false
  }
  return true
}

/**
 * Joins a period's scores to the roster, dropping what the filters exclude.
 *
 * A score whose MP is absent from the roster is dropped rather than rendered
 * under its own `internalId`. That differs from `mpLabel`, deliberately: on a
 * profile page the id-as-name fallback makes a gap visible where the reader is
 * already looking at one MP, but on a leaderboard it would seat an unidentified
 * row among 630 identified ones — and `upsertScore`'s own comment names this as
 * the case that puts an orphan on the public leaderboard. `requireMandate`
 * makes it unreachable through the ingestion API; this makes it harmless if it
 * ever becomes reachable another way.
 */
async function scoredRoster(
  ctx: QueryCtx,
  wahlperiode: number,
  month: string | null,
  filters: Filters,
): Promise<Array<{ score: Doc<"activityScores">; mp: Doc<"mps"> }>> {
  const [scores, mps] = await Promise.all([
    ctx.db
      .query("activityScores")
      .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
        q.eq("wahlperiode", wahlperiode).eq("month", month),
      )
      .collect(),
    roster(ctx, wahlperiode),
  ])

  const nowMs = Date.now()
  const joined = []
  for (const score of scores) {
    const mp = mps.get(score.mpInternalId)
    if (!mp || !passes(mp, filters, nowMs)) continue
    joined.push({ score, mp })
  }
  return joined
}

/** The wire shape, minus the rank — assigned after sorting. */
function toRow(score: Doc<"activityScores">, mp: Doc<"mps">) {
  return {
    mpInternalId: score.mpInternalId,
    name: mp.name,
    fraktion: mp.fraktion,
    party: mp.party,
    photoUrl: mp.photoUrl,
    occupation: occupationOf(mp),
    state: stateOf(mp.constituency),
    birthDate: mp.birthDate,
    totalScore: score.totalScore,
    motionCount: score.motionCount,
    speechCount: score.speechCount,
    speechWordCount: score.speechWordCount,
    questionCount: score.questionCount,
    reportCount: score.reportCount,
    voteParticipationRate: score.voteParticipationRate,
    committeeCount: score.committeeCount,
    billSponsorshipCount: score.billSponsorshipCount,
    scoreBreakdown: score.scoreBreakdown,
  }
}

/**
 * Ranks rows by `value`, highest first, and numbers them.
 *
 * **Ties share a rank.** Two MPs on 40 speeches are both rank 3 and the next is
 * rank 5 — standard competition ranking. The alternative, numbering by position,
 * would break the tie by whatever order the index happened to return, which is
 * ingestion order: two MPs with identical records would be told one of them is
 * ahead, and which one would change between deployments. Ranking is the claim
 * this page makes, so it should not assert a difference the data does not have.
 *
 * The secondary sort is by name, which does not affect the rank numbers — it
 * only makes the *display* order of a tied block stable and inspectable rather
 * than arbitrary.
 */
function ranked<T>(rows: T[], value: (row: T) => number, name: (row: T) => string) {
  const sorted = [...rows].sort(
    (a, b) => value(b) - value(a) || name(a).localeCompare(name(b), "de"),
  )
  const out: Array<T & { rank: number }> = []
  let previousValue: number | null = null
  let previousRank = 0
  for (const [index, row] of sorted.entries()) {
    const current = value(row)
    const rank = previousValue !== null && current === previousValue ? previousRank : index + 1
    out.push({ ...row, rank })
    previousValue = current
    previousRank = rank
  }
  return out
}

// --- the metric boards ----------------------------------------------------

/**
 * Seven of the nine boards: rank a period's scores by one stored column.
 *
 * One query rather than seven near-identical ones, because they differ only in
 * which field is read — and seven copies is how "most motions" and "most
 * questions" end up disagreeing about whether a filter applies before or after
 * the take.
 *
 * `direction` exists for the sortable columns: the table head sorts by any
 * column in either order, and ascending is a real question ("who has spoken
 * least"), not only the reverse of the default.
 *
 * ⚠ Ranking by `speechCount` sorts correctly and misleads — §5.2's finding that
 * question time fragments a minister's turn into dozens of replies. The caveat
 * belongs beside the number, and lib/i18n.ts carries it as
 * `rankings.caveat.speechCount`; `speechWordCount` is what scoring weighs.
 */
export const getMetricRankings = query({
  args: {
    wahlperiode: v.number(),
    month: v.union(v.null(), v.string()),
    metric: rankingMetric,
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    ...rankingFilters,
    ...pageArgs,
  },
  returns: v.object({ rows: v.array(rankingRow), total: v.number() }),
  handler: async (ctx, args) => {
    // Validates `month` before anything is read: an unpadded "2026-6" is stored
    // under a key no reader queries and would otherwise return an empty board
    // that looks like a month nobody worked. See `monthWindow`'s header.
    monthWindow(args.month)

    const joined = await scoredRoster(ctx, args.wahlperiode, args.month, args)
    const rows = joined.map(({ score, mp }) => toRow(score, mp))

    const metric = args.metric
    const ordered = ranked(
      rows,
      (row) => (args.direction === "asc" ? -row[metric] : row[metric]),
      (row) => row.name,
    )
    return paged(ordered, Math.max(0, Math.floor(args.offset ?? 0)), pageLimit(args.limit, 50))
  },
})

// --- rising this month ----------------------------------------------------

/**
 * Biggest score increase against the previous calendar month.
 *
 * Two indexed slices — this month's scores and last month's — differenced by
 * MP. Not derivable from one read, which is why it is its own query rather than
 * another metric on the board above.
 *
 * An MP with no row last month is treated as having scored **zero**, so a
 * newly-sworn-in member appears with their whole month as the increase. That is
 * the true statement about their measured activity; the alternative (excluding
 * them) would silently drop exactly the people whose activity changed most.
 *
 * ⚠ The comparison is between two calendar months, which is not the same as
 * between two comparable periods of parliamentary work: the Bundestag sits in
 * sitting weeks, so a month containing one reads low against a month containing
 * three without anyone having done less. `rankings.caveat.rising` says so on
 * the page.
 */
export const getRisingRankings = query({
  args: {
    wahlperiode: v.number(),
    /** The later month, `YYYY-MM`. Not nullable: "the whole period" has no
     * previous month to rise against, and a null here would silently compare
     * the period total to nothing and rank every MP by their total instead. */
    month: v.string(),
    previousMonth: v.string(),
    ...rankingFilters,
    ...pageArgs,
  },
  returns: v.object({
    rows: v.array(
      v.object({
        ...rankingRow.fields,
        /** Points gained since `previousMonth`. Negative for a month that fell
         * off; the board ranks descending, so those sort to the bottom rather
         * than being hidden. */
        change: v.number(),
        previousScore: v.number(),
      }),
    ),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    monthWindow(args.month)
    monthWindow(args.previousMonth)

    const [current, previous] = await Promise.all([
      scoredRoster(ctx, args.wahlperiode, args.month, args),
      ctx.db
        .query("activityScores")
        .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
          q.eq("wahlperiode", args.wahlperiode).eq("month", args.previousMonth),
        )
        .collect(),
    ])

    const before = new Map(previous.map((row) => [row.mpInternalId, row.totalScore]))
    const rows = current.map(({ score, mp }) => {
      const previousScore = before.get(score.mpInternalId) ?? 0
      return {
        ...toRow(score, mp),
        // Re-rounded to two places: subtracting two values each rounded to two
        // places can still land on 3.9999999999999996, and this number is
        // rendered directly.
        change: Math.round((score.totalScore - previousScore) * 100) / 100,
        previousScore,
      }
    })

    const ordered = ranked(
      rows,
      (row) => row.change,
      (row) => row.name,
    )
    return paged(ordered, Math.max(0, Math.floor(args.offset ?? 0)), pageLimit(args.limit, 50))
  },
})

// --- cross-party voting ---------------------------------------------------

/**
 * How often each MP voted against the majority of their own group.
 *
 * The one board here not derived from `activityScores`, because dissent is a
 * property of a *ballot*, not of a member: it exists only relative to how
 * everyone else in the group voted in that same division.
 *
 * ## What "against the group" means
 *
 * For each ballot, each group's line is the modal vote among its members who
 * **cast** one — `yes`, `no`, `abstain`, `invalid`. Absences are excluded from
 * both the line and the count: `nichtabgegeben` is "did not vote" (§4.1), and
 * counting it as dissent would rank the members who turned up least as the most
 * independent, which is the opposite of what this board is for.
 *
 * The group is `partyAtVote` where the ballot recorded one, falling back to the
 * MP's current Fraktion. §6.4 records six WP21 members changing group
 * mid-period; measuring their old votes against their new group would
 * manufacture dissent out of a transfer.
 *
 * A group with no modal winner — an exact split — sets no line, and nobody in it
 * dissents on that ballot. Rare, and the alternative is picking one of two tied
 * positions and calling everyone on the other side a rebel.
 *
 * ## The read this makes
 *
 * ⚠ The only query in this file whose cost is not bounded by the roster. It
 * reads the period's ballots and every vote record on them: ~630 records per
 * ballot, so ~25 ballots reach 16 000 documents and Convex's read limit. So
 * `maxBallots` bounds it explicitly, defaulting to the most recent 20, and the
 * response says which window it used — a leaderboard computed over an unstated
 * subset of ballots is a number with no meaning, and the UI states the window
 * beside it rather than presenting a partial count as a career total.
 *
 * A period-wide dissent count needs the tally maintained at ingest, on
 * `voteRecords` or a counter table. That is a schema change and belongs with the
 * pipeline; this query is correct for the window it names.
 */
export const getCrossPartyRankings = query({
  args: {
    wahlperiode: v.number(),
    /** Most recent ballots to examine. See the read-cost note above. */
    maxBallots: v.optional(v.number()),
    ...rankingFilters,
    ...pageArgs,
  },
  returns: v.object({
    rows: v.array(
      v.object({
        rank: v.number(),
        mpInternalId: v.string(),
        name: v.string(),
        fraktion: v.string(),
        photoUrl: v.union(v.null(), v.string()),
        state: v.union(v.null(), v.string()),
        birthDate: v.union(v.null(), v.string()),
        /** Ballots voted against the own group's line. */
        dissents: v.number(),
        /** Ballots in the window where this MP cast a vote — the denominator,
         * without which a dissent count cannot be read. */
        ballotsCast: v.number(),
        dissentRate: v.number(),
        totalScore: v.number(),
      }),
    ),
    total: v.number(),
    /** The window actually examined, so the page can state it. */
    ballotsExamined: v.number(),
  }),
  handler: async (ctx, args) => {
    // 20 ballots × ~630 records ≈ 12 600 documents, inside the ~16 000 limit
    // with room for the roster and the sheets themselves.
    const maxBallots = Math.max(1, Math.min(40, Math.floor(args.maxBallots ?? 20)))

    const sheets = await ctx.db
      .query("voteSheets")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .take(maxBallots)

    const mps = await roster(ctx, args.wahlperiode)
    const nowMs = Date.now()

    const dissents = new Map<string, number>()
    const cast = new Map<string, number>()

    for (const sheet of sheets) {
      const records = await ctx.db
        .query("voteRecords")
        .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
        .collect()

      // Tally each group's cast votes, then take the modal one as its line.
      const tallies = new Map<string, Map<string, number>>()
      for (const record of records) {
        if (record.vote === "absent") continue
        const group = record.partyAtVote ?? mps.get(record.mpInternalId)?.fraktion
        if (group === undefined) continue
        const byVote = tallies.get(group) ?? new Map<string, number>()
        byVote.set(record.vote, (byVote.get(record.vote) ?? 0) + 1)
        tallies.set(group, byVote)
      }

      const lines = new Map<string, string>()
      for (const [group, byVote] of tallies) {
        let best: string | null = null
        let bestCount = 0
        let tied = false
        for (const [vote, count] of byVote) {
          if (count > bestCount) {
            best = vote
            bestCount = count
            tied = false
          } else if (count === bestCount) {
            tied = true
          }
        }
        // An exactly split group has no line — see the header.
        if (best !== null && !tied) lines.set(group, best)
      }

      for (const record of records) {
        if (record.vote === "absent") continue
        const group = record.partyAtVote ?? mps.get(record.mpInternalId)?.fraktion
        if (group === undefined) continue
        cast.set(record.mpInternalId, (cast.get(record.mpInternalId) ?? 0) + 1)
        const line = lines.get(group)
        if (line !== undefined && record.vote !== line) {
          dissents.set(record.mpInternalId, (dissents.get(record.mpInternalId) ?? 0) + 1)
        }
      }
    }

    // Scores ride along so the board can show the activity score in its last
    // column like every other board. Keyed on the period total (`month: null`).
    const scores = await ctx.db
      .query("activityScores")
      .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
        q.eq("wahlperiode", args.wahlperiode).eq("month", null),
      )
      .collect()
    const totals = new Map(scores.map((row) => [row.mpInternalId, row.totalScore]))

    const rows = []
    for (const [mpInternalId, ballotsCast] of cast) {
      const mp = mps.get(mpInternalId)
      if (!mp || !passes(mp, args, nowMs)) continue
      const count = dissents.get(mpInternalId) ?? 0
      rows.push({
        mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        photoUrl: mp.photoUrl,
        state: stateOf(mp.constituency),
        birthDate: mp.birthDate,
        dissents: count,
        ballotsCast,
        dissentRate: ballotsCast === 0 ? 0 : count / ballotsCast,
        totalScore: totals.get(mpInternalId) ?? 0,
      })
    }

    const ordered = ranked(
      rows,
      (row) => row.dissents,
      (row) => row.name,
    )
    return {
      ...paged(ordered, Math.max(0, Math.floor(args.offset ?? 0)), pageLimit(args.limit, 50)),
      ballotsExamined: sheets.length,
    }
  },
})

// --- filter options -------------------------------------------------------

/**
 * The values the filters can actually select, for one period.
 *
 * Built from the roster rather than from constants, so the dropdowns never
 * offer a filter that matches nothing: Fraktion names differ by period, and
 * `state` is recoverable for only some MPs (see `stateOf`), so a hardcoded list
 * of sixteen Länder would offer fifteen empty options and read as missing data.
 *
 * `months` comes from the score rows, not from a date range, because a month
 * with no scores is a month the ranking has nothing to say about.
 */
export const getRankingFilterOptions = query({
  args: { wahlperiode: v.number() },
  returns: v.object({
    fraktionen: v.array(v.object({ value: v.string(), count: v.number() })),
    states: v.array(v.object({ value: v.string(), count: v.number() })),
    ageGroups: v.array(v.object({ value: ageGroup, count: v.number() })),
    months: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const [mps, scores] = await Promise.all([
      ctx.db
        .query("mps")
        .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
        .collect(),
      ctx.db
        .query("activityScores")
        .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
          q.eq("wahlperiode", args.wahlperiode),
        )
        .collect(),
    ])

    const nowMs = Date.now()
    const fraktionen = new Map<string, number>()
    const states = new Map<string, number>()
    const ageGroups = new Map<AgeGroup, number>()

    for (const mp of mps) {
      fraktionen.set(mp.fraktion, (fraktionen.get(mp.fraktion) ?? 0) + 1)
      const state = stateOf(mp.constituency)
      if (state !== null) states.set(state, (states.get(state) ?? 0) + 1)
      for (const group of AGE_GROUP_KEYS) {
        if (inAgeGroup(mp.birthDate, group, nowMs)) {
          ageGroups.set(group, (ageGroups.get(group) ?? 0) + 1)
        }
      }
    }

    const months = new Set<string>()
    for (const score of scores) {
      if (score.month !== null) months.add(score.month)
    }

    const byCount = (a: { count: number }, b: { count: number }) => b.count - a.count
    return {
      fraktionen: [...fraktionen]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => byCount(a, b) || a.value.localeCompare(b.value, "de")),
      states: [...states]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, "de")),
      // In bracket order, not by count: an age axis reads as an axis.
      ageGroups: AGE_GROUP_KEYS.filter((group) => ageGroups.has(group)).map((group) => ({
        value: group,
        count: ageGroups.get(group) ?? 0,
      })),
      // Newest first — the month picker's most likely answer is the last one.
      months: [...months].sort((a, b) => b.localeCompare(a)),
    }
  },
})

/**
 * The newest period on the roster.
 *
 * The same derivation as `scoreSweep.currentPeriod` and for the same reason
 * given there — a hardcoded 21 keeps scoring the previous Bundestag for months
 * after WP22 begins. That one is an `internalQuery` for the cron; this is the
 * public form, because every page here needs a period before it can ask for
 * anything and the URL should not have to carry one.
 */
export const getCurrentWahlperiode = query({
  args: {},
  returns: v.union(v.null(), v.number()),
  handler: async (ctx) => {
    const newest = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion")
      .order("desc")
      .first()
    return newest?.wahlperiode ?? null
  },
})
