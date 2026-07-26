import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation, internalQuery } from "./_generated/server"

/**
 * The nightly score sweep: rescoring the whole chamber, a slice at a time.
 *
 * Scoring one MP reads their activities, speeches, votes and committees, so the
 * roster — 630-odd for WP21 — does not fit in one transaction's read budget.
 * The sweep therefore scores a slice, then schedules itself to continue, and
 * each slice is its own transaction. `convex/crons.ts` starts it; this module
 * keeps it going.
 *
 * Every slice is idempotent, because a score is recomputed from stored rows
 * rather than incremented. A sweep that dies partway leaves correct scores for
 * the MPs it reached and yesterday's for the rest, and the next night's run
 * repairs them — there is no partial state to clean up and no double-counting
 * to guard against.
 */

/** Rows per slice. Deliberately below `recomputeScores`' own default: this runs
 * unattended against the largest MPs' record sets, where the per-MP read cost
 * is highest, so the ceiling that matters is the busiest backbencher's, not the
 * average one's. */
const SWEEP_BATCH = 25

/**
 * The electoral period to score, and the month to score alongside the total.
 *
 * Derived from the data rather than configured: the current period is the
 * highest `wahlperiode` on the roster, which is true by construction and needs
 * no update when a new Bundestag is elected. A hardcoded `21` would silently
 * keep scoring the previous period for months after WP22 began — the kind of
 * staleness that produces a plausible, wrong number rather than an error.
 *
 * Returns null when the roster is empty, which is the state before the first
 * ingest. The sweep then does nothing rather than scoring a period that does
 * not exist.
 */
export const currentPeriod = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object({ wahlperiode: v.number() })),
  handler: async (ctx) => {
    // Ordered by the index's first column, so the newest period is one row.
    const newest = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion")
      .order("desc")
      .first()
    return newest ? { wahlperiode: newest.wahlperiode } : null
  },
})

/** The month a sweep starting `now` should recompute, as `YYYY-MM`. */
function monthOf(now: number): string {
  const date = new Date(now)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Starts a sweep — the cron's target.
 *
 * Recomputes the current calendar month alongside each MP's period total. Only
 * the current month, not every month since the period began: an older month's
 * inputs change only when the Bundestag amends a record retroactively, and
 * `recomputeScores` is exposed over HTTP (`POST /api/pipeline/scores/recompute`)
 * for the backfill that handles those. Rescoring every month nightly would be
 * dozens of times the work to change nothing.
 */
export const startNightlySweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const period = await ctx.runQuery(internal.scoreSweep.currentPeriod, {})
    // Nothing ingested yet. Not an error: a fresh deployment has no roster, and
    // the sweep should wait for one rather than fail nightly until it arrives.
    if (!period) return null

    await ctx.scheduler.runAfter(0, internal.scoreSweep.sweepSlice, {
      wahlperiode: period.wahlperiode,
      month: monthOf(Date.now()),
      cursor: 0,
    })
    return null
  },
})

/**
 * Scores one slice and schedules the next.
 *
 * Self-rescheduling rather than a loop, because the point is to cross
 * transaction boundaries — a loop would put the whole roster back into one
 * transaction and hit the read limit this exists to avoid. `runAfter(0)` yields
 * between slices, so the sweep competes with live queries rather than starving
 * them.
 */
export const sweepSlice = internalMutation({
  args: {
    wahlperiode: v.number(),
    month: v.union(v.null(), v.string()),
    cursor: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { nextCursor, hasMore } = await ctx.runMutation(internal.activityScores.recomputeScores, {
      wahlperiode: args.wahlperiode,
      month: args.month,
      cursor: args.cursor,
      batchSize: SWEEP_BATCH,
    })
    if (hasMore && nextCursor !== null) {
      await ctx.scheduler.runAfter(0, internal.scoreSweep.sweepSlice, {
        wahlperiode: args.wahlperiode,
        month: args.month,
        cursor: nextCursor,
      })
    }
    return null
  },
})
