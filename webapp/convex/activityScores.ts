import { v } from "convex/values"
// Aliased so the exported mutation below can be `computeScore` — the name the
// pipeline and the cron call it by — without shadowing the pure function it
// delegates to.
import {
  computeScore as applyWeights,
  DEFAULT_WEIGHTS,
  type ScoreInputs,
  type ScoreWeights,
} from "../lib/scoring"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, type MutationCtx, type QueryCtx, query } from "./_generated/server"
import { activityDates } from "./activities"
import { committeeCount } from "./committees"
import { pageLimit, upsertRow, withId } from "./lib/ingest"
import { mpLabel, photoFields, requireMandate } from "./mps"
import { activityScoreInput, scoreBreakdown, scoreWeights } from "./schema"
import { speechDates } from "./speeches"
import { ballotDates, voteTallyByMonth } from "./votes"

/**
 * Computed activity scores and the rankings over them.
 *
 * The maths is not here — it is in lib/scoring.ts, outside `convex/`, because
 * both sides need it: this module computes and stores a score under the default
 * weights, while a signed-in user re-weights their own view live in the browser
 * (`userPreferences.customWeights`). One formula, two callers.
 *
 * One row per (MP, Wahlperiode, month), `month` being `YYYY-MM` or **null for
 * the whole period** — the monthly rows feed the contribution graph, the null
 * row is the total the rankings sort on. Both come from the same computation,
 * so they cannot disagree the way a cached total and its parts can.
 *
 * Three limits on what a score claims are structural and no weighting removes
 * them (named ballots only; committee work for the current period only; words,
 * not speech count). lib/scoring.ts sets them out; they belong in the UI.
 */

// --- read models ----------------------------------------------------------

const activityScoreDoc = v.object({
  id: v.id("activityScores"),
  ...activityScoreInput,
  createdAt: v.number(),
  updatedAt: v.number(),
})

const toScoreDoc = withId<"activityScores">

// --- the window -----------------------------------------------------------

/**
 * The ISO date range a `month` argument covers.
 *
 * Null means the whole Wahlperiode, expressed as a range wide enough to contain
 * any of them rather than as an absent bound. Every read downstream is an index
 * range with both ends closed — an open-ended range is the shape that eventually
 * scans a table, so there is no code path here that produces one.
 *
 * The end date is computed rather than "the 31st": comparing ISO strings makes
 * `2026-02-31` sort correctly even though it is not a date, but it would also
 * silently include a `2026-02-30` typo from the source. Asking `Date` for the
 * real last day costs nothing and keeps the bound meaningful.
 *
 * The shape is checked before the numbers, and zero-padding is part of the
 * shape. `"2026-6"` parses to a perfectly valid year and month, so a numeric
 * check alone passes it — and then every bound built from it (`"2026-6-01"` …
 * `"2026-6-30"`) sorts *above* every real date in that year, because `"6" >
 * "1"` lexicographically. The window matches nothing, the MP scores zero for a
 * month they worked, and nothing anywhere errors. `month` is also the stored
 * key, so the zero row is written under a spelling no reader will ever query.
 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** Exported for convex/activityScores.test.ts. Not a Convex function, so it
 * costs nothing at the API surface — and the padding rule above is the kind of
 * bug that produces a plausible zero rather than an error, which is exactly
 * what a test is for. */
export function monthWindow(month: string | null): { from: string; to: string } {
  if (month === null) return { from: "1949-01-01", to: "2999-12-31" }
  if (!MONTH_PATTERN.test(month)) {
    throw new Error(`Invalid month "${month}": expected zero-padded YYYY-MM, e.g. 2026-06`)
  }
  const [year, monthIndex] = month.split("-").map(Number)
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  }
}

// --- computation ----------------------------------------------------------

/**
 * The measured activity behind one score row, before weights are applied.
 *
 * Named because two things now produce one: a window read from the database, and
 * the same window narrowed in memory from a wider one already read. Keeping them
 * one type is what makes `gatherWindow` and `narrow` interchangeable at the call
 * site, and therefore what makes the month row and the period row provably the
 * same computation over different date bounds.
 */
type Gathered = {
  inputs: ScoreInputs
  speechCount: number
  participation: { cast: number; eligible: number }
}

/**
 * One MP's raw rows for a whole period — read **once**, then narrowed per window.
 *
 * ## Why the period rather than the window
 *
 * `recomputeScores` writes two rows per member when a month is given: the month,
 * and the period total. Those were two independent gathers over windows where
 * one strictly contains the other, so every source table was read twice and the
 * month's rows were read a second time as part of the period's. The period read
 * is the larger of the two and contains the smaller, so reading it once and
 * slicing costs exactly what the total alone used to.
 *
 * That is the structural half of the fix. The other half is that each of these
 * reads is now genuinely period-scoped — see `voteRecordScopeFields` in
 * convex/schema.ts and `speechVolume` — so "the period" is a bounded quantity
 * rather than a euphemism for the member's whole career.
 *
 * ## What is not read here
 *
 * `committeeCount` is per period and carries no date at all (§6.4: committee
 * membership is published for the current period only), so it is fetched once
 * and used by both rows unchanged — as it always was, since `gatherInputs` never
 * passed it a window either.
 *
 * The counts come from the source tables, not from `activityEvents`: the feed is
 * derived and may lag, and a score built on derived data would compound any gap
 * in it.
 */
async function gatherPeriod(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
): Promise<{
  activities: Array<{ date: string; bucket: string }>
  speeches: Array<{ protocolDate: string; wordCount: number }>
  ballots: Array<{ date: string; cast: boolean }>
  committees: number
}> {
  const { from, to } = monthWindow(null)
  const [activities, speeches, ballots, committees] = await Promise.all([
    activityDates(ctx, mpInternalId, wahlperiode, from, to),
    speechDates(ctx, mpInternalId, wahlperiode, from, to),
    ballotDates(ctx, mpInternalId, wahlperiode, from, to),
    committeeCount(ctx, mpInternalId, wahlperiode),
  ])
  return { activities, speeches, ballots, committees }
}

/**
 * The gathered inputs for one window, sliced out of a period already read.
 *
 * ⚠ The arithmetic here must match what the per-source helpers do, because it
 * *is* what they do — `activityTallies` buckets and counts, `speechVolume` sums
 * `wordCount ?? 0`, `voteParticipation` counts everything but `absent` as cast.
 * The rules stay in those modules and this only re-applies them over rows they
 * returned, which is why each helper now has a `*Dates` sibling returning the
 * rows rather than the tally: one definition of "how many speeches", read from
 * one place, aggregated in two.
 *
 * Bounds are inclusive on both ends, matching `monthWindow` and the `.gte`/`.lte`
 * ranges the helpers use — a month's last day is *in* the month.
 */
function narrow(
  period: Awaited<ReturnType<typeof gatherPeriod>>,
  from: string,
  to: string,
): Gathered {
  const tallies: Record<string, number> = {}
  for (const row of period.activities) {
    if (row.date < from || row.date > to) continue
    tallies[row.bucket] = (tallies[row.bucket] ?? 0) + 1
  }

  let speechCount = 0
  let wordCount = 0
  for (const row of period.speeches) {
    if (row.protocolDate < from || row.protocolDate > to) continue
    speechCount++
    wordCount += row.wordCount
  }

  let cast = 0
  let eligible = 0
  for (const row of period.ballots) {
    if (row.date < from || row.date > to) continue
    eligible++
    if (row.cast) cast++
  }

  return {
    inputs: {
      motions: tallies.motions ?? 0,
      // Words, not segments — see the header note.
      speeches: wordCount,
      questions: tallies.questions ?? 0,
      reports: tallies.reports ?? 0,
      // No ballot in the window scores as 0 rather than as a penalty for a month
      // the Bundestag held no named vote. The distinction survives in
      // `voteParticipationRate`, which the UI reads to decide between "0 %" and
      // "no votes" — and which is computed from `eligible` below, not from this.
      voteParticipation: eligible === 0 ? 0 : cast / eligible,
      committees: period.committees,
      billSponsorships: tallies.billSponsorships ?? 0,
    },
    speechCount,
    participation: { cast, eligible },
  }
}

/** Writes one (MP, period, month) score from inputs already gathered. */
async function storeScore(
  ctx: MutationCtx,
  mpInternalId: string,
  wahlperiode: number,
  month: string | null,
  gathered: Gathered,
  weights: ScoreWeights,
  now: number,
): Promise<{ totalScore: number; created: boolean }> {
  const { inputs, speechCount, participation } = gathered
  const { totalScore, breakdown } = applyWeights(inputs, weights)

  const existing = await ctx.db
    .query("activityScores")
    .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
      q.eq("mpInternalId", mpInternalId).eq("wahlperiode", wahlperiode).eq("month", month),
    )
    .unique()

  const { created } = await upsertRow(
    ctx,
    "activityScores",
    existing,
    {
      mpInternalId,
      wahlperiode,
      month,
      motionCount: inputs.motions,
      speechCount,
      speechWordCount: inputs.speeches,
      questionCount: inputs.questions,
      reportCount: inputs.reports,
      voteParticipationRate:
        participation.eligible === 0 ? 0 : participation.cast / participation.eligible,
      committeeCount: inputs.committees,
      billSponsorshipCount: inputs.billSponsorships,
      totalScore,
      scoreBreakdown: breakdown,
    },
    now,
    { touchUpdatedAt: true },
  )
  return { totalScore, created }
}

/**
 * Computes and writes one member's score rows: the period total, and optionally
 * one month — from a single read of their period.
 *
 * Both rows come from the same `gatherPeriod`, so they cannot disagree the way
 * two independent gathers could if a row landed between them. That was already
 * the intent (convex/schema.ts: "recomputed together, so neither is ever a stale
 * sum of the other"); it is now true of the *read* and not only of the write.
 */
async function computeAndStore(
  ctx: MutationCtx,
  mpInternalId: string,
  wahlperiode: number,
  month: string | null,
  weights: ScoreWeights,
  now: number,
): Promise<{ totalScore: number; created: boolean }> {
  const period = await gatherPeriod(ctx, mpInternalId, wahlperiode)

  if (month !== null) {
    const window = monthWindow(month)
    await storeScore(
      ctx,
      mpInternalId,
      wahlperiode,
      month,
      narrow(period, window.from, window.to),
      weights,
      now,
    )
  }

  const whole = monthWindow(null)
  return await storeScore(
    ctx,
    mpInternalId,
    wahlperiode,
    null,
    narrow(period, whole.from, whole.to),
    weights,
    now,
  )
}

/**
 * Recomputes one MP's scores: the period total, and one month.
 *
 * Idempotent, which is what makes it safe as a cron target — a run that dies
 * partway leaves correct rows for the MPs it reached and stale ones for the
 * rest, and the next run fixes those without double-counting anything.
 */
export const computeScore = internalMutation({
  args: {
    mpInternalId: v.string(),
    wahlperiode: v.number(),
    month: v.union(v.null(), v.string()),
  },
  returns: v.object({ totalScore: v.number(), created: v.boolean() }),
  handler: async (ctx, args) =>
    await computeAndStore(
      ctx,
      args.mpInternalId,
      args.wahlperiode,
      args.month,
      DEFAULT_WEIGHTS,
      Date.now(),
    ),
})

/**
 * Ceiling on how many MPs one `recomputeScores` call may score.
 *
 * ## The number this was derived from
 *
 * A slice's cost is the sum of four per-MP reads in four other modules. The
 * nightly sweep of 2026-07-27 crossed the limit and the deployment recorded what
 * it had touched: 32 002 documents for **25** MPs.
 *
 * | table       | documents | after this branch |
 * |-------------|-----------|-------------------|
 * | voteRecords |    10 270 | ~1 700 |
 * | voteSheets  |    10 245 | **0** |
 * | activities  |     8 604 | ~4 300 |
 * | speeches    |     2 111 | ~800 |
 * | mps         |       772 | ~25 |
 *
 * ~1 280 documents per MP, and three separate causes, all of them now fixed:
 *
 *  - **`voteParticipation` read the member's whole career and fetched a sheet
 *    per record** to find out which period each vote belonged to. That is the
 *    10 270 + 10 245 pair — a 1:1 ratio, which is the N+1 made visible — and
 *    64 % of the transaction. `voteRecords` now carries its ballot's period and
 *    date, so the read is one index range and no sheet is touched.
 *  - **Every input was gathered twice**, once for the month and once for the
 *    period total, over windows where the first is a subset of the second.
 *    `gatherPeriod` now reads the period once and derives both.
 *  - **The roster read was quadratic.** `.take(cursor + batchSize + 1)` re-reads
 *    every member the sweep has already scored, so a 635-member sweep at 8 per
 *    slice read ~25 000 `mps` rows in total. The cursor is now an `internalId`,
 *    so a slice reads its own members and no others.
 *
 * ## Why the ceiling stays at 8 anyway
 *
 * It is no longer load-bearing, and that is the point of leaving it alone: the
 * per-MP cost is now ~230 documents rather than ~1 280, so 8 members is ~1 800
 * against Convex's 32 000 — a 17× margin where it used to be 2×. Raising it
 * would spend that margin on wall-clock the sweep does not need (it runs
 * unattended at 03:15) and would re-couple the batch size to a corpus that keeps
 * growing. `scripts/score-period.py` parallelises across cursors instead, which
 * is where throughput actually comes from.
 *
 * ## Why a dedicated ceiling rather than `pageLimit`
 *
 * `pageLimit` clamps to `MAX_PAGE`, which convex/lib/ingest.ts deliberately
 * raised to **700** so the roster could be listed in one page. Applied to *this*
 * argument it authorises 700 MPs — the whole chamber — in one transaction,
 * which is the exact shape this function's own header says it exists to avoid.
 * The two numbers answer different questions: how many rows may cross the wire,
 * and how many transactions' worth of reads may be attempted at once. Sharing
 * one constant between them is how the second silently inherited the first.
 *
 * Clamps rather than rejects, unlike `assertBatchSize`. An oversized *write*
 * batch must fail so the pipeline can chunk and retry, but an oversized score
 * slice has a correct smaller answer: take fewer MPs and report a `nextCursor`.
 * Every caller already loops on that cursor, so a clamped slice completes the
 * same roster in more passes rather than dropping anyone.
 *
 * Exported for convex/activityScores.test.ts.
 */
export const MAX_SCORE_BATCH = 8

export function scoreBatchSize(requested: number | undefined): number {
  // `Number.isFinite` first, for `pageLimit`'s reason: NaN survives `Math.min`
  // and would reach `.slice(cursor, NaN)` as an empty slice — a sweep that
  // reports `scored: 0` and terminates, which reads as a fully-scored roster.
  if (requested === undefined || !Number.isFinite(requested)) return MAX_SCORE_BATCH
  return Math.max(1, Math.min(MAX_SCORE_BATCH, Math.floor(requested)))
}

/**
 * Recomputes a slice of the roster — the cron's unit of work.
 *
 * Batched by MP rather than run for the whole chamber in one transaction:
 * scoring one MP reads their activities, speeches, votes and committees, so 630
 * of them in one function would blow through Convex's per-transaction read
 * limit. `crons.ts` walks the roster in slices of this size, and `cursor`/
 * `hasMore` is how it knows where it got to.
 *
 * `month` null recomputes only the period total; passing a month recomputes
 * both it and the total, because a month's data changing changes the total too.
 * It no longer costs twice what its MP count suggests: both rows come from one
 * `gatherPeriod` per member — see `computeAndStore`.
 *
 * ## ⚠ The cursor is a member id, not an offset
 *
 * It used to be an integer offset, which meant seeking to it:
 * `.take(cursor + batchSize + 1)` re-read every member already scored, so the
 * paging cost grew with the square of the roster — measured at 509 documents to
 * fetch 8 members at offset 500, against 9 at offset 0. A whole 635-member sweep
 * spent ~25 000 `mps` reads paging through 635 rows.
 *
 * Now it is the `internalId` the previous slice ended on, and the read is
 * `.gt("internalId", cursor)` off `by_wahlperiode_and_internalId` — `batchSize + 1`
 * documents wherever the slice starts. Deliberately a member id rather than a
 * `.paginate()` token, which is also O(page) but opaque:
 * `scripts/score-period.py` shards a period across workers and can only do that
 * if slice boundaries are derivable from the roster it already reads. An id it
 * can compute; a token it cannot.
 *
 * Callers pass the `nextCursor` they were given and nothing else, which is what
 * they already did. `null`/absent means "start at the beginning".
 */
export const recomputeScores = internalMutation({
  args: {
    wahlperiode: v.number(),
    month: v.union(v.null(), v.string()),
    /** The `internalId` the previous slice ended on; absent or null starts at
     * the beginning of the period's roster. */
    cursor: v.optional(v.union(v.null(), v.string())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    scored: v.number(),
    nextCursor: v.union(v.null(), v.string()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = scoreBatchSize(args.batchSize)
    const after = args.cursor ?? null

    // One past the end of the slice: the extra row is what answers `hasMore`
    // without reading the members this call will not score. The seek is part of
    // the range rather than a slice of a larger read, which is what makes the
    // cost independent of how far into the roster this slice sits.
    const window = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_internalId", (q) =>
        after === null
          ? q.eq("wahlperiode", args.wahlperiode)
          : q.eq("wahlperiode", args.wahlperiode).gt("internalId", after),
      )
      .take(batchSize + 1)

    const slice = window.slice(0, batchSize)
    const now = Date.now()
    for (const mp of slice) {
      // One call, both rows: `computeAndStore` writes the month (when asked) and
      // the period total from a single read of the member's period.
      await computeAndStore(ctx, mp.internalId, args.wahlperiode, args.month, DEFAULT_WEIGHTS, now)
    }

    // Strictly more than the slice means a member the `take` saw and this call
    // did not score. An exhausted roster returns a null cursor, which is what
    // stops the sweep rescheduling itself.
    const hasMore = window.length > batchSize
    return {
      scored: slice.length,
      nextCursor: hasMore ? (slice.at(-1)?.internalId ?? null) : null,
      hasMore,
    }
  },
})

/**
 * Writes a precomputed score.
 *
 * For the pipeline, which can compute a score offline over data it already
 * holds. `computeScore` is the in-Convex path and the one the cron uses; this
 * exists so a backfill does not have to round-trip every MP through the
 * database to score a period it just ingested.
 *
 * `requireMandate` for the same reason every other ingestion mutation calls it
 * (§7.3): a score naming an MP who is not on the roster has nobody to be a
 * score *of*. It is worse here than elsewhere, though, because this row is not
 * inert — `getRankings` reads the score index directly, so an orphan lands on
 * the public leaderboard, and `mpLabel`'s missing-mandate fallback renders it
 * under its own `internalId` as if that were a name.
 */
export const upsertScore = internalMutation({
  args: activityScoreInput,
  returns: v.object({ id: v.id("activityScores"), created: v.boolean() }),
  handler: async (ctx, args) => {
    await requireMandate(ctx, args.mpInternalId, args.wahlperiode)
    const existing = await ctx.db
      .query("activityScores")
      .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
        q
          .eq("mpInternalId", args.mpInternalId)
          .eq("wahlperiode", args.wahlperiode)
          .eq("month", args.month),
      )
      .unique()
    return await upsertRow(ctx, "activityScores", existing, args, Date.now(), {
      touchUpdatedAt: true,
    })
  },
})

// --- public queries -------------------------------------------------------

/** One MP's scores: the period total, and every month with one. */
export const getScores = query({
  args: {
    mpInternalId: v.string(),
    wahlperiode: v.number(),
    month: v.optional(v.union(v.null(), v.string())),
  },
  returns: v.array(activityScoreDoc),
  handler: async (ctx, args) => {
    const rows =
      args.month === undefined
        ? await ctx.db
            .query("activityScores")
            .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
              q.eq("mpInternalId", args.mpInternalId).eq("wahlperiode", args.wahlperiode),
            )
            .collect()
        : await ctx.db
            .query("activityScores")
            .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
              q
                .eq("mpInternalId", args.mpInternalId)
                .eq("wahlperiode", args.wahlperiode)
                .eq("month", args.month ?? null),
            )
            .collect()
    return rows.map(toScoreDoc)
  },
})

/**
 * The leaderboard: highest scores first.
 *
 * Read straight off `by_wahlperiode_and_month_and_totalScore` in descending
 * order. Sorting in memory would mean collecting all 630 MPs to return ten, and
 * would break the moment the roster outgrew one transaction's read limit.
 *
 * The scores are the stored ones, under default weights. A signed-in user's
 * custom weights re-rank in the browser from each row's `scoreBreakdown`, which
 * carries the raw counts — see `rescore` in lib/scoring.ts. Storing a ranking
 * per user would mean recomputing 630 rows per weight change.
 */
export const getRankings = query({
  args: {
    wahlperiode: v.number(),
    month: v.union(v.null(), v.string()),
    limit: v.optional(v.number()),
    /**
     * Which end of the board to read. `"desc"` (the default) is the top;
     * `"asc"` is the bottom, which the home page shows beside it.
     *
     * An argument rather than a second query, because it is one word of
     * difference against the same index — `by_wahlperiode_and_month_and_totalScore`
     * is ordered, so both ends are a `.take()` off it and neither reads the
     * 630 rows in between. A `getBottomRankings` would be this function
     * copied, and the copy is how the two ends come to disagree about whether
     * an unscored MP is included.
     *
     * ⚠ The two ends are **not** symmetric in what they claim. The top of a
     * leaderboard needs no caveat; the bottom is read as an accusation, and
     * the score measures *recorded* activity only — committee deliberation and
     * constituency work leave almost no machine-readable trace, and a member
     * holding government office is doing different work rather than less. The
     * UI must carry that caveat beside the section; `home.bottomMPsCaveat` is
     * it. This query returns the number, not the reading of it.
     */
    direction: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: v.array(
    v.object({
      rank: v.number(),
      mpInternalId: v.string(),
      name: v.string(),
      fraktion: v.string(),
      /** `Direktwahl` or `Landesliste`, joined from the roster by `mpLabel` so
       * `MPCard` can badge the mandate type without a query per card — the same
       * economy `dissent` below is joined for. Null where the mandate could not
       * be resolved, which is not the same as a list seat; see `mandateType`. */
      electionMethod: v.union(v.null(), v.string()),
      ...photoFields,
      totalScore: v.number(),
      scoreBreakdown,
      /**
       * This MP's period-wide dissent, or null where none has been computed.
       *
       * Joined here so `MPCard` can carry its badge without a query per card —
       * the cost that keeps the heatmap opt-in. One indexed lookup per row,
       * beside the `mpLabel` this loop already does, and the slice is a
       * `.take()` rather than the roster.
       *
       * Null is not zero: a member the backfill has not reached has no tally,
       * and the badge renders nothing for both — see `isNotableDissenter` in
       * lib/dissent.ts, which is where that collapse is decided rather than
       * here.
       */
      dissent: v.union(v.null(), v.object({ dissents: v.number(), ballotsCast: v.number() })),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("activityScores")
      .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
        q.eq("wahlperiode", args.wahlperiode).eq("month", args.month),
      )
      .order(args.direction === "asc" ? "asc" : "desc")
      .take(pageLimit(args.limit, 50))

    const ranked = []
    for (const [index, row] of rows.entries()) {
      const mp = await mpLabel(ctx, row.mpInternalId, args.wahlperiode)
      const tally = await ctx.db
        .query("dissentTallies")
        .withIndex("by_mpInternalId_and_wahlperiode", (q) =>
          q.eq("mpInternalId", row.mpInternalId).eq("wahlperiode", args.wahlperiode),
        )
        .unique()
      ranked.push({
        // Position within what was asked for, in both directions: read
        // ascending, rank 1 is the lowest score. Numbering the bottom five
        // 626…630 would be a claim about the size of the board that this
        // query — which takes a slice and never counts the rest — cannot
        // make, and it would be wrong for every MP the sweep has not scored.
        rank: index + 1,
        mpInternalId: row.mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        electionMethod: mp.electionMethod,
        photoUrl: mp.photoUrl,
        photoCredit: mp.photoCredit,
        totalScore: row.totalScore,
        scoreBreakdown: row.scoreBreakdown,
        dissent:
          tally === null ? null : { dissents: tally.dissents, ballotsCast: tally.ballotsCast },
      })
    }
    return ranked
  },
})

/**
 * One MP's activity month by month — what the trend charts draw.
 *
 * ## Why this is not `getScores` filtered in the browser
 *
 * `getScores` returns the stored rows as they are, period total included, and
 * that is right for the score panel, which wants exactly one of them. A chart
 * wants three things that query cannot give it:
 *
 *  - **The period row excluded.** It is a total, not a month, and plotting it
 *    alongside the monthly rows would draw one bar taller than the rest of the
 *    chart put together — the sum of the series, rendered as a member of it.
 *  - **Ballot positions per month.** `activityScores` stores
 *    `voteParticipationRate`, a 0…1 share, which cannot be taken apart into the
 *    yes/no/abstain/absent bars the vote chart stacks. Those come from
 *    `voteTallyByMonth`, which reads the ballots themselves.
 *  - **Months with ballots but no score row.** See below — the two sources
 *    disagree about which months exist, and the union is the honest answer.
 *
 * ## The two sources, and why months are unioned rather than joined
 *
 * `startNightlySweep` recomputes the *current* calendar month and the period
 * total, nothing else (convex/scoreSweep.ts explains why: an older month's
 * inputs change only on a retroactive amendment). So a deployment whose backfill
 * never called `POST /api/pipeline/scores/recompute` per month has score rows
 * for one month and ballots for four years.
 *
 * Joining on the score rows would silently drop every ballot in those months and
 * draw a voting record that starts the month the sweep first ran. So the months
 * are unioned: a month with ballots and no score contributes its bars with zero
 * counts elsewhere, which is what the sources actually say. `scored` marks which
 * is which, so the UI can state it rather than presenting a gap in the score line
 * as a quiet month.
 *
 * ## Read cost
 *
 * One indexed range over this MP's score rows — ~48 for a whole Wahlperiode —
 * plus `voteTallyByMonth`'s scan of their vote records. Both are bounded by the
 * corpus rather than by a limit, and §4.4 is why that is safe: named ballots
 * number ~1 015 in the Bundestag's entire history. Deliberately per-MP; the
 * chamber-wide form of this question would not be.
 */
export const getMonthlyScoresByMP = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number() },
  returns: v.array(
    v.object({
      /** Zero-padded `YYYY-MM`. Never null: the period total is excluded, and
       * a chart's x-axis has no place to put it. */
      month: v.string(),
      motionCount: v.number(),
      speechCount: v.number(),
      speechWordCount: v.number(),
      questionCount: v.number(),
      reportCount: v.number(),
      committeeCount: v.number(),
      billSponsorshipCount: v.number(),
      voteParticipationRate: v.number(),
      totalScore: v.number(),
      /** Named ballots this month, by position — the stacked bar's segments.
       * `absent` is carried rather than dropped for the reason §4.1 separates
       * it from `abstain`: a month an MP missed and a month with no ballot are
       * opposite claims. */
      voteYes: v.number(),
      voteNo: v.number(),
      voteAbstain: v.number(),
      voteInvalid: v.number(),
      voteAbsent: v.number(),
      /** Whether a score row exists for this month. False means the sweep has
       * not run for it — see the header. A zero score on an unscored month is
       * an absence of computation, not a measurement of idleness, and the UI
       * has to be able to tell the reader which. */
      scored: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const [rows, ballots] = await Promise.all([
      ctx.db
        .query("activityScores")
        .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
          q.eq("mpInternalId", args.mpInternalId).eq("wahlperiode", args.wahlperiode),
        )
        .collect(),
      voteTallyByMonth(ctx, args.mpInternalId, args.wahlperiode),
    ])

    // The period total is the `month: null` row (see this file's header), and it
    // is a sum of the rest — not a point on the axis.
    //
    // Built with an explicit key/value type and a loop rather than
    // `new Map(rows.filter(…).map(…))`: inferring a `Map` from an array of
    // two-element arrays needs the callback to return a *tuple*, and TypeScript
    // widens it to `(string | Doc)[]` unless the target type says otherwise —
    // so the map infers as `Map<{}, {}>` and every field read below becomes an
    // error on `{}`. Stating the type is what makes `scored.get(month)` come
    // back as the row it is.
    const scored = new Map<string, Doc<"activityScores">>()
    for (const row of rows) {
      if (row.month !== null) scored.set(row.month, row)
    }

    const months = [...new Set([...scored.keys(), ...ballots.keys()])].sort()
    return months.map((month) => {
      const row = scored.get(month)
      const votes = ballots.get(month) ?? { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }
      return {
        month,
        motionCount: row?.motionCount ?? 0,
        speechCount: row?.speechCount ?? 0,
        speechWordCount: row?.speechWordCount ?? 0,
        questionCount: row?.questionCount ?? 0,
        reportCount: row?.reportCount ?? 0,
        committeeCount: row?.committeeCount ?? 0,
        billSponsorshipCount: row?.billSponsorshipCount ?? 0,
        voteParticipationRate: row?.voteParticipationRate ?? 0,
        totalScore: row?.totalScore ?? 0,
        voteYes: votes.yes,
        voteNo: votes.no,
        voteAbstain: votes.abstain,
        voteInvalid: votes.invalid,
        voteAbsent: votes.absent,
        scored: row !== undefined,
      }
    })
  },
})

// The default weights used to be served from here; they are imported directly
// from `lib/scoring.ts` by every consumer (the settings sliders, the
// per-profile score panel, the /about page), so no server round-trip is
// warranted for a compile-time constant. Removed to keep one source of truth.
