import { type Validator, v } from "convex/values"
// Relative, not "@/lib/...": convex/tsconfig.json defines no path aliases.
import { occupationOf, stateOf } from "../lib/bundestag"
import { competitionRanks } from "../lib/ranking"
import {
  AGE_GROUP_KEYS,
  type AgeGroup,
  inAgeGroup,
  RANKING_METRICS,
  type RankingMetric,
} from "../lib/taxonomy"
// The tenure denominator, imported rather than restated — see
// `getNormalisedRankings`, which is the only board whose figure is not a stored
// column and therefore the only one that could grow a second copy of a formula.
import { normalisedScore, tenureDays } from "../lib/tenure"
// The candidate-month enumerator, imported rather than restated — see
// `getRankingFilterOptions`, the only caller that needs a date range turned
// into a list of `YYYY-MM` strings.
import { monthRange } from "../lib/trends"
import type { Doc } from "./_generated/dataModel"
import { type QueryCtx, query } from "./_generated/server"
import { monthWindow } from "./activityScores"
import { pageLimit } from "./lib/ingest"
import { literalUnion } from "./lib/validators"
import { photoFields } from "./mps"
import { scoreBreakdown } from "./schema"
// The group-line rule, imported rather than restated — see `windowDissent`.
import { dissentFlagsFor, tallyByGroup } from "./votes"

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
 * Every query here is now bounded by the roster, including the cross-party
 * board: its period scope reads a maintained `dissentTallies` row per member
 * rather than re-tallying ballots. Its `window` scope is the exception and says
 * so at length.
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
  ...photoFields,
  /** What the MP does now (abgeordnetenwatch, 88.1 % of WP21), falling back to
   * what they did before (Stammdaten `BERUF`, 94.3 %). Resolved server-side so
   * the member table's occupation column is one field rather than two the
   * client has to choose between. */
  occupation: v.union(v.null(), v.string()),
  /** Federal state (Stammdaten `WKR_LAND`), as published. Null for a mandate
   * whose record carries none — 21 of WP21's 635, all list members with no
   * constituency block. Period-scoped codes; see `stateOf`. */
  state: v.union(v.null(), v.string()),
  /** `Direktwahl` or `Landesliste` (Stammdaten `MANDATSART`), stored raw and
   * carried here so a leaderboard can badge the mandate type without a second
   * query per row — the same reason `dissent` rides along below rather than
   * being fetched per card. Null where the record has none: unknown is not a
   * list mandate, and `mandateType` (lib/taxonomy.ts) keeps the two apart. */
  electionMethod: v.union(v.null(), v.string()),
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
 * `federalState`, `birthDate`) are what the filters need and `mpLabel` does not
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
 *
 * Exported for convex/rankings.test.ts, following `peakConcurrentMandates` in
 * convex/stats.ts: it is a pure predicate rather than a Convex function, so it
 * costs nothing at the API surface, and every one of its failure modes is a
 * board that quietly holds the wrong members rather than an error. The federal
 * state is the case in point — the filter it replaced matched nobody at all,
 * and looked exactly like a state nobody was from.
 *
 * `Pick` rather than the whole document, for the same reason that function
 * takes one: the parameter then *names* the three columns a filter reads, so a
 * test constructs exactly those and a fourth filter has to widen this signature
 * rather than quietly reaching into a row. Both call sites hand it a full
 * `Doc<"mps">`, which satisfies this.
 */
export function passes(
  mp: Pick<Doc<"mps">, "fraktion" | "federalState" | "birthDate">,
  filters: Filters,
  nowMs: number,
): boolean {
  if (filters.fraktion !== undefined && mp.fraktion !== filters.fraktion) return false
  if (filters.state !== undefined && stateOf(mp.federalState) !== filters.state) return false
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
    // `?? null` because the column is optional on the way in: the pipeline
    // omits a portrait it did not resolve rather than nulling one it did
    // (convex/schema.ts:202), so an un-enriched row has no key at all. The
    // wire shape stays `string | null` — an `undefined` here would fail this
    // query's own returns validator rather than render initials.
    photoUrl: mp.photoUrl ?? null,
    // Paired with the URL, always: the credit is the licence condition on
    // these portraits (convex/schema.ts:207).
    photoCredit: mp.photoCredit ?? null,
    occupation: occupationOf(mp),
    state: stateOf(mp.federalState),
    electionMethod: mp.electionMethod,
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
  // The numbering itself is `competitionRanks` in lib/ranking.ts — three copies
  // of the tie rule existed before it, and the part that drifts is the skip
  // after a tied block. The sort stays here because the tie-break is this
  // module's (by name, in German collation) and the numbering is not.
  const ranks = competitionRanks(sorted.map(value))
  return sorted.map((row, index) => ({ ...row, rank: ranks[index] }))
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

// --- activity per month in office -----------------------------------------

/**
 * The tenth board: activity score divided by time in office.
 *
 * ## Why this is not `getMetricRankings` with another metric
 *
 * Every metric there is a stored column on `activityScores`, which is what makes
 * that query one indexed slice re-sorted. This figure is not stored and cannot
 * be: it depends on `mps.datesInOffice`, a *roster* field, so it exists only
 * after the join those boards do for filtering. Adding it to `RANKING_METRICS`
 * would put a name in the metric union that no score row answers to, and the
 * type would say otherwise.
 *
 * It is also the one board where a member can be **absent for a reason that is
 * not a filter**. See below; no other board has that, and it is why the return
 * shape carries `unrankable`.
 *
 * ## What the denominator is, and what it is not
 *
 * `normalisedScore` in lib/tenure.ts — days between `datesInOffice.start` and
 * either its `end` or today, expressed in 30-day months. The rule lives there
 * rather than here because the browser renders the same figure on the home
 * page's board, and two copies would be two answers.
 *
 * ⚠ Elapsed time is not parliamentary exposure. The Bundestag sits in sitting
 * weeks and no dataset publishes that calendar (§9), so this divides by days on
 * the clock. `rankings.caveat.normalised` states it on the page.
 *
 * ## Members without a rate are dropped and counted, not zeroed
 *
 * A mandate with no `datesInOffice`, or one shorter than `MIN_TENURE_DAYS`,
 * yields null — "cannot be ranked", not "scored nothing". Ranking them at zero
 * would seat exactly the short-serving members at the bottom of the board built
 * to stop that happening.
 *
 * So they are excluded, and `unrankable` reports how many, because a board that
 * silently holds 610 of 630 members reads as the whole chamber. The page says
 * what is missing — the same rule `ballotsExamined` follows for the cross-party
 * scopes.
 */
export const getNormalisedRankings = query({
  args: {
    wahlperiode: v.number(),
    month: v.union(v.null(), v.string()),
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    ...rankingFilters,
    ...pageArgs,
  },
  returns: v.object({
    rows: v.array(
      v.object({
        ...rankingRow.fields,
        /** Activity score per 30 days in office. Never null in a returned row —
         * a member without one is not on this board at all. */
        scorePerMonth: v.number(),
        /** Days in office, so the page can show the denominator beside the
         * rate. A rate whose divisor is invisible is a number a reader cannot
         * check, and this whole board is an argument about divisors. */
        tenureDays: v.number(),
      }),
    ),
    total: v.number(),
    /** Members the filters admitted but this board cannot rank — no recorded
     * mandate span, or one below the floor. Stated rather than swallowed; see
     * the header. */
    unrankable: v.number(),
  }),
  handler: async (ctx, args) => {
    monthWindow(args.month)

    const joined = await scoredRoster(ctx, args.wahlperiode, args.month, args)

    // One `asOf` for every row in the query, the same rule `passes` follows for
    // age brackets: two members' denominators must not be measured against
    // clocks a few milliseconds apart. Sliced to a UTC calendar day because
    // that is what every date in the schema is.
    const asOf = new Date().toISOString().slice(0, 10)

    const rows = []
    let unrankable = 0
    for (const { score, mp } of joined) {
      const perMonth = normalisedScore(score.totalScore, mp.datesInOffice, asOf)
      const days = tenureDays(mp.datesInOffice, asOf)
      if (perMonth === null || days === null) {
        unrankable++
        continue
      }
      rows.push({ ...toRow(score, mp), scorePerMonth: perMonth, tenureDays: days })
    }

    const ordered = ranked(
      rows,
      (row) => (args.direction === "asc" ? -row.scorePerMonth : row.scorePerMonth),
      (row) => row.name,
    )
    return {
      ...paged(ordered, Math.max(0, Math.floor(args.offset ?? 0)), pageLimit(args.limit, 50)),
      unrankable,
    }
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
 * ## Two scopes, and why both stay
 *
 * `scope: "period"` — the default — reads `dissentTallies`, the roll-up
 * convex/votes.ts maintains as each ballot lands. That makes the board a 630-row
 * indexed scan over the whole electoral period rather than a re-tally of its
 * ballots, and it is the reason the number on this page is now a period figure
 * instead of a window.
 *
 * `scope: "window"` computes the old way: read the most recent `maxBallots`
 * ballots and tally them here. ⚠ Its cost is not bounded by the roster — ~630
 * records per ballot, so ~25 ballots reach 16 000 documents and Convex's read
 * limit — which is why `maxBallots` bounds it explicitly at 20 and why it cannot
 * be the default. It stays for two things the maintained tally cannot do: it is
 * correct on a deployment where `backfillDissent` has not yet run, and it is the
 * independent second opinion that makes a drifted tally visible rather than
 * merely plausible.
 *
 * `ballotsExamined` reports which window was used and is **0 for the period
 * scope** — not because nothing was examined, but because "the last N ballots"
 * is not the shape of that answer. The UI reads `scope` to decide what to say;
 * printing "0 ballots" beside a period-wide count would be the same
 * unstated-subset problem in a new place.
 */
export const getCrossPartyRankings = query({
  args: {
    wahlperiode: v.number(),
    /**
     * Which figure to return. Defaults to the maintained period tally.
     *
     * An argument rather than a second query, for the reason `getRankings`'
     * `direction` gives: the two differ in where the counts come from and in
     * nothing else — same filters, same ranking, same row shape — and a
     * `getCrossPartyRankingsForWindow` would be this function copied, with the
     * tie rule and the filter order free to drift between the copies.
     */
    scope: v.optional(v.union(v.literal("period"), v.literal("window"))),
    /** Most recent ballots to examine, for `scope: "window"` only. See the
     * read-cost note above. Ignored by the period scope, which examines all of
     * them by construction. */
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
        ...photoFields,
        state: v.union(v.null(), v.string()),
        birthDate: v.union(v.null(), v.string()),
        /** Ballots voted against the own group's line. */
        dissents: v.number(),
        /** Cast votes in a group that had a line — the denominator, without
         * which a dissent count cannot be read. */
        ballotsCast: v.number(),
        dissentRate: v.number(),
        totalScore: v.number(),
      }),
    ),
    total: v.number(),
    /** Which figure these rows are. Echoed rather than assumed by the caller:
     * the two scopes produce the same shape and very different numbers. */
    scope: v.union(v.literal("period"), v.literal("window")),
    /** The window actually examined, so the page can state it. 0 for the period
     * scope — see the header. */
    ballotsExamined: v.number(),
  }),
  handler: async (ctx, args) => {
    const scope = args.scope ?? "period"
    const mps = await roster(ctx, args.wahlperiode)
    const nowMs = Date.now()

    const { counts, ballotsExamined } =
      scope === "period"
        ? await periodDissent(ctx, args.wahlperiode)
        : await windowDissent(ctx, args.wahlperiode, args.maxBallots, mps)

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
    for (const [mpInternalId, tally] of counts) {
      const mp = mps.get(mpInternalId)
      if (!mp || !passes(mp, args, nowMs)) continue
      rows.push({
        mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        // `?? null` for the same reason as `toRow` above: the stored column is
        // optional, the wire shape is not.
        photoUrl: mp.photoUrl ?? null,
        photoCredit: mp.photoCredit ?? null,
        state: stateOf(mp.federalState),
        birthDate: mp.birthDate,
        dissents: tally.dissents,
        ballotsCast: tally.ballotsCast,
        dissentRate: tally.ballotsCast === 0 ? 0 : tally.dissents / tally.ballotsCast,
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
      scope,
      ballotsExamined,
    }
  },
})

/** What either scope produces: one entry per member who cast a countable vote. */
type DissentCounts = Map<string, { dissents: number; ballotsCast: number }>

/**
 * The maintained period tally, read straight off `dissentTallies`.
 *
 * One indexed scan of ~630 rows, which is the whole point of the table — the
 * expensive per-ballot direction was already paid at ingest by
 * `refreshBallotDissent` in convex/votes.ts.
 *
 * A member with no row is **absent from the result**, not present with zero. On
 * a deployment mid-backfill that is the honest answer: the board lists the
 * members whose ballots have been counted, and a zero row would seat an
 * uncounted member among them claiming perfect loyalty. The same reason
 * `scoredRoster` drops a score whose MP is not on the roster rather than
 * rendering it under its id.
 */
async function periodDissent(
  ctx: QueryCtx,
  wahlperiode: number,
): Promise<{ counts: DissentCounts; ballotsExamined: number }> {
  const tallies = await ctx.db
    .query("dissentTallies")
    .withIndex("by_wahlperiode_and_dissents", (q) => q.eq("wahlperiode", wahlperiode))
    .collect()

  const counts: DissentCounts = new Map()
  for (const row of tallies) {
    // Members who have cast nothing countable are left out for the same reason a
    // missing row is: the board is about how often someone broke with their
    // group, and "never had the chance" is not a low score.
    if (row.ballotsCast === 0 && row.dissents === 0) continue
    counts.set(row.mpInternalId, { dissents: row.dissents, ballotsCast: row.ballotsCast })
  }
  // Not "no ballots" — see the header. The period scope's answer is not a window,
  // so it reports no window rather than a misleading one.
  return { counts, ballotsExamined: 0 }
}

/**
 * The bounded window: tally the most recent `maxBallots` ballots here and now.
 *
 * The pre-tally implementation, unchanged in what it counts and moved into its
 * own function so the two scopes cannot drift in the filtering, ranking and
 * paging they share. It applies the same rule the stored flags do —
 * `tallyByGroup` and `isRebel` from convex/votes.ts, which is what the ballot
 * page renders — rather than the hand-rolled modal-vote loop that used to live
 * here. That loop agreed with them, which is exactly the problem: a fourth copy
 * of "the group's line" is a fourth chance to disagree about who dissented, and
 * this one had already re-implemented the tie rule.
 */
async function windowDissent(
  ctx: QueryCtx,
  wahlperiode: number,
  maxBallots: number | undefined,
  mps: Map<string, Doc<"mps">>,
): Promise<{ counts: DissentCounts; ballotsExamined: number }> {
  // 20 ballots × ~630 records ≈ 12 600 documents, inside the ~16 000 limit
  // with room for the roster and the sheets themselves.
  const limit = Math.max(1, Math.min(40, Math.floor(maxBallots ?? 20)))

  const sheets = await ctx.db
    .query("voteSheets")
    .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", wahlperiode))
    .order("desc")
    .take(limit)

  const fraktionOf = (mpInternalId: string) => mps.get(mpInternalId)?.fraktion ?? ""
  const counts: DissentCounts = new Map()

  for (const sheet of sheets) {
    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
      .collect()

    const groups = tallyByGroup(records, fraktionOf)
    for (const record of records) {
      const group = record.partyAtVote ?? fraktionOf(record.mpInternalId)
      if (group === "") continue
      const majority = groups.get(group)?.majority ?? null
      // The same rule the stored flags apply, through the same function — so
      // the window figure and the period figure count the same events and a
      // disagreement between them means the tally has drifted, rather than
      // meaning the two scopes were never comparable.
      const { dissent, counted } = dissentFlagsFor(record.vote, majority)
      if (!counted) continue
      const tally = counts.get(record.mpInternalId) ?? { dissents: 0, ballotsCast: 0 }
      tally.ballotsCast++
      if (dissent) tally.dissents++
      counts.set(record.mpInternalId, tally)
    }
  }

  return { counts, ballotsExamined: sheets.length }
}

// --- filter options -------------------------------------------------------

/**
 * The values the filters can actually select, for one period.
 *
 * Built from the roster rather than from constants, so the dropdowns never
 * offer a filter that matches nothing. That is not only tidiness: Fraktion
 * names differ by period, and the `WKR_LAND` codes do too — WP1–17 spell
 * Lower Saxony `NDS` where WP18–21 say `NI` (§6.2) — so a hardcoded list of
 * sixteen Länder would offer sixteen empty options on a historical period and
 * read as missing data. Reading the period's own rows is what makes one
 * component correct for every period.
 *
 * `months` comes from the score rows, not straight from a date range, because
 * a month with no scores is a month the ranking has nothing to say about. But
 * "which months" no longer reads every score row to find out: a closed
 * period has tens of thousands of them (one per MP per month), and a
 * `.collect()` over all of them here overran Convex's per-query document-read
 * ceiling and 500'd this query for every historical Wahlperiode — the roster
 * dropdown a visitor hits first on any WP14–20 page. Candidate months come
 * instead from the roster's own mandate spans (`datesInOffice`, already read
 * below for the other filters, so this adds no fetch), and each candidate is
 * checked with one indexed `.first()` — the same "existence, not a count"
 * pattern `listPeriods` in convex/mps.ts uses for the period-total row.
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
    const mps = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    const nowMs = Date.now()
    const today = new Date(nowMs).toISOString().slice(0, 10)
    const fraktionen = new Map<string, number>()
    const states = new Map<string, number>()
    const ageGroups = new Map<AgeGroup, number>()
    let periodStart: string | null = null
    let periodEnd: string | null = null

    for (const mp of mps) {
      fraktionen.set(mp.fraktion, (fraktionen.get(mp.fraktion) ?? 0) + 1)
      const state = stateOf(mp.federalState)
      if (state !== null) states.set(state, (states.get(state) ?? 0) + 1)
      for (const group of AGE_GROUP_KEYS) {
        if (inAgeGroup(mp.birthDate, group, nowMs)) {
          ageGroups.set(group, (ageGroups.get(group) ?? 0) + 1)
        }
      }
      if (mp.datesInOffice !== null) {
        const { start, end } = mp.datesInOffice
        // Open `end` means still serving (schema.ts's note on the field) —
        // treated as running through today rather than left out of the range.
        const resolvedEnd = end ?? today
        if (periodStart === null || start < periodStart) periodStart = start
        if (periodEnd === null || resolvedEnd > periodEnd) periodEnd = resolvedEnd
      }
    }

    const candidateMonths =
      periodStart !== null && periodEnd !== null
        ? monthRange(periodStart.slice(0, 7), periodEnd.slice(0, 7))
        : []
    const monthRows = await Promise.all(
      candidateMonths.map((month) =>
        ctx.db
          .query("activityScores")
          .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
            q.eq("wahlperiode", args.wahlperiode).eq("month", month),
          )
          .first(),
      ),
    )
    const months = candidateMonths.filter((_, index) => monthRows[index] !== null)

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

// A `getCurrentWahlperiode` used to live here, duplicating
// `api.mps.getCurrentWahlperiode` byte for byte. Every reader in the app (the
// homepage, the dashboard, the settings page) consumes the `mps.*` copy, so
// this one had no callers and violated the "one source of truth for the
// current period" invariant `convex/mps.ts` states explicitly. Removed.
