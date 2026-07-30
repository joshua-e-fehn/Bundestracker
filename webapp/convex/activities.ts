import { type ObjectType, v } from "convex/values"
import { bucketFor } from "../lib/scoring"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { assertBatchSize, emptyBatchResult, pageLimit, recordBatch, upsertRow } from "./lib/ingest"
import { requireMandate } from "./mps"
import { activityInput } from "./schema"

/**
 * The per-MP activity backbone, from DIP `/aktivitaet`.
 *
 * The easiest table here to keep correct and the most important to get
 * complete. One record per MP per action carrying `person_id` directly, so
 * unlike votes and speeches it needs no name matching (§3.5), and unlike
 * Drucksache authorship it is not capped at four (§3.4). WP21 holds 80 537.
 *
 * ## ⚠ `aktivitaetsart` is an open string
 *
 * The finding that shapes this module. The spec types it as a bare `string` —
 * no enum, no value list, no catalogue endpoint — and the values named in the
 * research are a few hundred sampled records out of those 80 537 (§3.5).
 *
 * A closed union would reject unknown kinds at the door; a closed mapping in
 * scoring would be worse, accepting them and scoring them at zero. §3.5 puts it
 * directly: *"a silently-dropped value means an entire class of parliamentary
 * activity vanishes from every MP's score with no error"*.
 *
 * So the field is `v.string()`, `bucketFor` routes anything unrecognised to a
 * counted `other`, and `listUnrecognisedActivityKinds` below runs §11.4's
 * census against live data. An unknown kind becomes a question, not a silence.
 */

// --- ingestion ------------------------------------------------------------

async function upsertOne(ctx: MutationCtx, input: ObjectType<typeof activityInput>, now: number) {
  await requireMandate(ctx, input.mpInternalId, input.wahlperiode)
  const existing = await ctx.db
    .query("activities")
    .withIndex("by_dipAktivitaetId", (q) => q.eq("dipAktivitaetId", input.dipAktivitaetId))
    .unique()
  return await upsertRow(ctx, "activities", existing, input, now)
}

export const upsertActivity = internalMutation({
  args: activityInput,
  returns: v.object({ id: v.id("activities"), created: v.boolean() }),
  handler: async (ctx, args) => await upsertOne(ctx, args, Date.now()),
})

/**
 * The batch form, and the busiest write path in the deployment.
 *
 * A WP21 backfill is 80 537 records — 806 pages from the API at 100 per page
 * (§11.1), and 162 requests here at `MAX_BATCH`. The daily sync is a handful.
 */
export const upsertActivities = internalMutation({
  args: { activities: v.array(v.object(activityInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.activities.length, "activities")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const activity of args.activities) {
      const { created } = await upsertOne(ctx, activity, now)
      recordBatch(result, created)
    }
    return result
  },
})

// --- scoring --------------------------------------------------------------

/**
 * One MP's activities in a window, as (date, score bucket) pairs.
 *
 * The read `activityTallies` does, without the aggregation — so a caller
 * covering several sub-windows of one period can read the period once and count
 * each window in memory, rather than issuing one indexed range per window over
 * rows that overlap almost entirely. `gatherPeriod` in convex/activityScores.ts
 * is that caller, and the reason the scorer no longer reads every source twice
 * per member.
 *
 * The bucketing stays here rather than moving to the caller: `bucketFor` routes
 * an unrecognised `aktivitaetsart` to a counted `other` (see the header note),
 * and a second place deciding which kind of parliamentary work an activity is
 * would be a second place to get that wrong.
 */
export async function activityDates(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<Array<{ date: string; bucket: string }>> {
  const rows = await ctx.db
    .query("activities")
    .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
      q
        .eq("mpInternalId", mpInternalId)
        .eq("wahlperiode", wahlperiode)
        .gte("date", from)
        .lte("date", to),
    )
    .collect()
  return rows.map((row) => ({ date: row.date, bucket: bucketFor(row.aktivitaetsart) }))
}

/** One MP's activities in a window, tallied by score bucket. The `other`
 * bucket is counted rather than discarded — see the header note. */
export async function activityTallies(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const rows = await activityDates(ctx, mpInternalId, wahlperiode, from, to)
  const tallies: Record<string, number> = {}
  for (const row of rows) {
    tallies[row.bucket] = (tallies[row.bucket] ?? 0) + 1
  }
  return tallies
}

// --- census ---------------------------------------------------------------

/**
 * Activity kinds seen in a period, with counts, marking which ones scoring does
 * not recognise.
 *
 * This is §11.4's open question #1 — *"run a full census before finalising the
 * scoring weights, and re-check it each period"* — answerable against ingested
 * data instead of against the API, which is behind a WAF that IP-blocks on
 * concurrency (§2.6).
 *
 * `internalQuery`, not public: it scans a period's activities, which is a
 * maintenance-sized read, and the answer is an input to a decision about
 * scoring rather than something a page renders. `limit` bounds that scan
 * explicitly so this cannot become the one query that trips the read limit as
 * the table grows.
 */
export const listUnrecognisedActivityKinds = internalQuery({
  args: { wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      aktivitaetsart: v.string(),
      count: v.number(),
      bucket: v.string(),
      recognised: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("activities")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .take(pageLimit(args.limit, 200) * 50)

    const counts = new Map<string, number>()
    for (const row of rows) {
      counts.set(row.aktivitaetsart, (counts.get(row.aktivitaetsart) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([aktivitaetsart, count]) => {
        const bucket = bucketFor(aktivitaetsart)
        return { aktivitaetsart, count, bucket, recognised: bucket !== "other" }
      })
      .sort((a, b) => b.count - a.count)
  },
})

// No public queries live in this module. The per-MP feed is served by
// `activityEvents.getActivityCalendar` and the chamber-wide roll-up by
// `activityScores.getRankings`; a per-MP list of raw `activities` rows was
// never wired to a UI and was removed to keep the public surface honest.
