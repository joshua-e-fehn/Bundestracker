import { v } from "convex/values"
import { type QueryCtx, query } from "./_generated/server"

/**
 * Chamber-wide totals — the home page's summary cards.
 *
 * The one query here answers "how big is this parliament and how much has it
 * done", which no other module could answer without the caller adding up pages
 * of rows in the browser. Everything else in `convex/` reads *a* record or *a*
 * list; this reads counts, and counting is where a dashboard most easily starts
 * lying.
 *
 * ## Why some counts are exact and some are not
 *
 * Two of these totals can be derived exactly and cheaply, one can be derived
 * exactly but only because its table is small, and one cannot be derived exactly
 * at all within a transaction's read budget. Rather than paper over the
 * difference, every figure carries `exact`, and the UI renders an inexact one as
 * `3.000+`. A number the reader cannot tell is a floor is worse than no number:
 * Bundestrack's premise is that every figure is backed by a Bundestag record
 * (AGENTS.md), and "at least 3 000" is a claim the records support where "3 000"
 * would not be.
 *
 * This is the same instinct as `bucketFor`'s `other` bucket (lib/scoring.ts) and
 * `mpLabel`'s id fallback (convex/mps.ts): surface the gap, never fill it in.
 *
 * ## Which per-MP counts may be summed, and which may not
 *
 * `activityScores` holds a row per MP for the whole period (`month === null`),
 * so summing a column looks like a free chamber-wide total. It is free for
 * exactly one of them, and silently wrong for the rest.
 *
 * `speechCount` comes from the `speeches` table via `speechVolume`
 * (convex/speeches.ts) — one row per speaker-segment per MP — so no segment is
 * attributed to two people and the sum is exact. It is also the only way to get
 * this total at all: a direct scan of `speeches` is ~18 000 rows for WP21 (~90
 * protocols × ~200 segments, §5.2), which is already past Convex's ~16 000-read
 * transaction budget. Routing through the stored scores is load-bearing here,
 * not an optimisation.
 *
 * `motionCount`, `questionCount` and `billSponsorshipCount` may **not** be
 * summed. All three come from `activityTallies` (convex/activities.ts), which
 * buckets the `activities` table — and §3.4 is explicit that `/aktivitaet`
 * "emits one record per MP per document". A Kleine Anfrage tabled by a Fraktion
 * with forty signatories is forty activity rows, so summing would report forty
 * questions where the Bundestag printed one. Those totals are read from their
 * own tables instead; see `countMotions` and `countQuestions`.
 *
 * That asymmetry is the whole reason this file needs a comment. It is also
 * exactly the kind of plausible, wrong number the rest of this codebase is
 * written to avoid.
 */

// --- read model -----------------------------------------------------------

/**
 * A count, and whether it is the real total or a floor.
 *
 * `exact: false` means "at least this many" — the count hit its ceiling and
 * stopped. Modelled as a field rather than as a nullable count because the
 * partial answer is still worth showing; what must not happen is showing it as
 * if it were complete.
 */
const countStat = v.object({ count: v.number(), exact: v.boolean() })

const chamberStats = v.object({
  mps: countStat,
  namedVotes: countStat,
  motions: countStat,
  speeches: countStat,
  questions: countStat,
  /** True when no MP has been ingested for this period. The distinction the
   * cards need: every total is legitimately 0 before the pipeline first runs,
   * and "nothing loaded yet" should not read as "this Bundestag did nothing". */
  empty: v.boolean(),
})

/**
 * How many rows any one count will read before giving up and reporting a floor.
 *
 * Sized against the largest thing counted here rather than as a round number.
 * The roster is 630 seats (§6.2 of docs/api-research.md, 635 with mid-period
 * overhang) and `MAX_PAGE` in convex/lib/ingest.ts is 700 for exactly that
 * reason; 5 000 sits an order of magnitude above the roster and above the ~1 015
 * named ballots in the Bundestag's entire history (§4.4), so those two are
 * always exact, while leaving the whole query far inside Convex's ~16 000-read
 * transaction budget even when all four counts run.
 *
 * Motions are the count this bound actually bites on, and are meant to.
 */
const COUNT_CEILING = 5_000

// --- counting -------------------------------------------------------------

/**
 * Counts up to `COUNT_CEILING` rows, reporting whether it saw them all.
 *
 * Takes one more row than the ceiling so "exactly at the ceiling" is
 * distinguishable from "more than the ceiling" — without the `+ 1`, a period
 * with precisely 5 000 motions would be reported as `5.000+`, which is true but
 * needlessly vague, and a period with 5 001 would be reported as `5.000`, which
 * is false.
 */
function tally(rows: unknown[]): { count: number; exact: boolean } {
  const exact = rows.length <= COUNT_CEILING
  return { count: exact ? rows.length : COUNT_CEILING, exact }
}

/**
 * Members currently serving in a period — **not** the number of table rows.
 *
 * The distinction is five people and it is the difference between the figure
 * the Bundestag publishes and one only this codebase would recognise. §6.2
 * reconciles it precisely: WP21 has 635 mandate rows, of which 5 have an end
 * date (departures) and 5 began after the period opened (replacements), so
 * `635 − 5 = 630` currently serve — exactly the statutory seat count. A row
 * here is a *mandate*, and one seat can carry two of them across a period.
 *
 * An open `end` means still serving, which is why `datesInOffice` keeps that
 * distinguishable from a date (convex/schema.ts). A null `datesInOffice` counts
 * as serving: the span is unknown rather than closed, and dropping those would
 * under-report the chamber on a partial ingest.
 *
 * Note `getFractionSizes` (convex/mps.ts) counts mandates rather than members,
 * so the per-Fraktion figures can sum to 635 where this says 630. That is a
 * real divergence and the seating arc it feeds should be reconciled with this;
 * it is out of scope for the home page and is not silently papered over here.
 */
async function countMPs(ctx: QueryCtx, wahlperiode: number) {
  const rows = await ctx.db
    .query("mps")
    .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", wahlperiode))
    .take(COUNT_CEILING + 1)
  const serving = rows.filter((row) => row.datesInOffice?.end == null)
  // Exactness is a property of the scan, not of the filter — if the take hit
  // its ceiling the count is a floor whether or not the filter reduced it.
  return { count: serving.length, exact: rows.length <= COUNT_CEILING }
}

/** Named ballots in a period. Exact in practice: ~1 015 exist across the whole
 * history of the Bundestag (§4.4), so one period's share is far under the
 * ceiling. Every other vote is a show of hands with no per-MP record in
 * existence — this counts what was recorded by name, nothing more. */
async function countNamedVotes(ctx: QueryCtx, wahlperiode: number) {
  const rows = await ctx.db
    .query("voteSheets")
    .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", wahlperiode))
    .take(COUNT_CEILING + 1)
  return tally(rows)
}

/**
 * Motions and bills in a period — counted from the table, not summed per MP.
 *
 * This is the asymmetry the header note promises. `activityScores.motionCount`
 * counts *sponsorships*, and a motion carries many: `motionSponsors` exists as
 * its own table precisely because DIP truncates `autoren_anzeige` at four
 * entries (§3.4) and sponsors arrive one at a time. Summing `motionCount` across
 * 630 MPs would therefore count a motion once per signatory — a Fraktion-wide
 * Antrag with 152 co-signers would land in the total 152 times, and the card
 * would report several times more motions than the Bundestag has ever printed.
 *
 * So this reads `motions` directly and accepts a bounded answer. The ceiling is
 * a real constraint here rather than a formality: WP21 alone has 80 537 DIP
 * activity records (§3.4), and motions are a substantial slice of that.
 */
async function countMotions(ctx: QueryCtx, wahlperiode: number) {
  const rows = await ctx.db
    .query("motions")
    .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", wahlperiode))
    .take(COUNT_CEILING + 1)
  return tally(rows)
}

/**
 * Written questions in a period — from the `questions` table, for the same
 * reason motions are.
 *
 * `activityScores.questionCount` is a sponsorship count, not a question count:
 * it buckets `/aktivitaet`, which emits a record per MP per document (§3.4). One
 * Kleine Anfrage with forty co-signers contributes forty. Counting the rows
 * here instead counts the questions.
 */
async function countQuestions(ctx: QueryCtx, wahlperiode: number) {
  const rows = await ctx.db
    .query("questions")
    .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", wahlperiode))
    .take(COUNT_CEILING + 1)
  return tally(rows)
}

// --- public query ---------------------------------------------------------

/**
 * The four headline totals for one period.
 *
 * Every figure is a *recorded* figure. The three structural limits set out in
 * lib/scoring.ts apply here too and the cards must not imply otherwise: named
 * ballots are a fraction of all votes, committee data exists only for the
 * current period, and a speech total counts segments the protocol attributed to
 * a named speaker.
 *
 * Speech and question totals come from the stored per-MP scores, so they are as
 * fresh as the last nightly sweep (convex/scoreSweep.ts) rather than as fresh as
 * the last ingest. On a deployment whose sweep has not yet run they read 0 while
 * the underlying rows exist — `empty` does not cover that case, because the
 * roster is what it reports on. That is a known lag, not a discrepancy to
 * reconcile: the sweep is idempotent and nightly.
 */
export const getChamberStats = query({
  args: { wahlperiode: v.number() },
  returns: chamberStats,
  handler: async (ctx, args) => {
    const [mps, namedVotes, motions, questions, scores] = await Promise.all([
      countMPs(ctx, args.wahlperiode),
      countNamedVotes(ctx, args.wahlperiode),
      countMotions(ctx, args.wahlperiode),
      countQuestions(ctx, args.wahlperiode),
      // The whole-period rows only — `month === null` is the period total and
      // the monthly rows are its parts, so reading both would double every
      // figure. See the note on `activityScoreInput` in convex/schema.ts.
      ctx.db
        .query("activityScores")
        .withIndex("by_wahlperiode_and_month_and_totalScore", (q) =>
          q.eq("wahlperiode", args.wahlperiode).eq("month", null),
        )
        .take(COUNT_CEILING + 1),
    ])

    // Only `speechCount` is summable — see the header. Summing any of the
    // others here would multiply the total by the mean signatory count.
    let speeches = 0
    for (const row of scores) {
      speeches += row.speechCount
    }
    // Inexact if the roster outran the ceiling, which would mean a chamber
    // eight times its statutory size — and separately, this total is only as
    // fresh as the last nightly sweep. Both are why it carries `exact` rather
    // than being presented as a settled number.
    const scoresComplete = scores.length <= COUNT_CEILING

    return {
      mps,
      namedVotes,
      motions,
      questions,
      speeches: { count: speeches, exact: scoresComplete },
      empty: mps.count === 0,
    }
  },
})
