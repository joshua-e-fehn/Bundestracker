import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation, internalQuery } from "./_generated/server"
import { MAX_SCORE_BATCH } from "./activityScores"
import { newestWahlperiode } from "./mps"

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

/**
 * Rows per slice.
 *
 * This was 25, chosen as a value "deliberately below `recomputeScores`' own
 * default" of 50 — but both were guesses, and on 2026-07-27 the nightly sweep
 * read 32 002 documents scoring 25 MPs and died on Convex's ~16 000 limit. The
 * reasoning was sound and the number was not: nothing measured the per-MP cost,
 * so "below the default" was below another guess rather than below the limit.
 *
 * It is now `MAX_SCORE_BATCH`, which convex/activityScores.ts derives from that
 * failure's own telemetry and enforces as a clamp. Naming the constant rather
 * than restating a number keeps the sweep from drifting above the ceiling again
 * — the clamp would catch it, but silently, by scoring fewer MPs per slice than
 * this file claimed to ask for.
 *
 * The original rationale still holds and still argues for this value: the sweep
 * runs unattended against the busiest members' record sets, so the ceiling that
 * matters is the heaviest MP's cost, not the average one's.
 */
const SWEEP_BATCH = MAX_SCORE_BATCH

/**
 * The electoral period to score, and the month to score alongside the total.
 *
 * Derived from the data rather than configured: the current period is the
 * highest `wahlperiode` on the roster, which is true by construction and needs
 * no update when a new Bundestag is elected. A hardcoded `21` would silently
 * keep scoring the previous period for months after WP22 began — the kind of
 * staleness that produces a plausible, wrong number rather than an error.
 *
 * The derivation itself lives in `newestWahlperiode` (convex/mps.ts), because
 * the frontend needs the same answer — `mps.getCurrentWahlperiode` is its public
 * face. This wrapper stays because the sweep wants it as a query it can call
 * through the scheduler, not because it is a second implementation.
 *
 * Returns null when the roster is empty, which is the state before the first
 * ingest. The sweep then does nothing rather than scoring a period that does
 * not exist.
 */
export const currentPeriod = internalQuery({
  args: {},
  returns: v.union(v.null(), v.object({ wahlperiode: v.number() })),
  handler: async (ctx) => {
    const wahlperiode = await newestWahlperiode(ctx)
    return wahlperiode === null ? null : { wahlperiode }
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
      // Null, not 0: the cursor is the `internalId` the previous slice ended on,
      // and there is no previous slice. See `recomputeScores`.
      cursor: null,
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
    /** The `internalId` the previous slice ended on; null starts the sweep. A
     * member id rather than an offset because seeking to an offset re-reads
     * every member already scored — see `recomputeScores`. */
    cursor: v.union(v.null(), v.string()),
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
