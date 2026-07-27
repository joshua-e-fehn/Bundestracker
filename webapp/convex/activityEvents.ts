import { type ObjectType, v } from "convex/values"
import { internalMutation, type MutationCtx, query } from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  pageLimit,
  recordBatch,
  upsertRow,
  withId,
} from "./lib/ingest"
import { findMandate, mpLabel, requireMandate } from "./mps"
import { activityEventInput, eventType } from "./schema"

/**
 * The unified feed: every kind of parliamentary record, on one timeline.
 *
 * Denormalised deliberately. An MP's profile interleaves motions, speeches,
 * votes, questions and committee work by date; from the source tables that is
 * seven indexed scans merged in memory, and it cannot paginate correctly
 * because the merge happens after each scan's cutoff. As one table it is a
 * single indexed range scan that pages properly.
 *
 * The cost is derived data that can drift. `referenceType`/`referenceId` keeps
 * it honest by pointing back at the row an event came from, so re-deriving is
 * an upsert rather than a second copy. An event with a null `referenceId` has
 * nothing to match on and is always inserted — a real hazard for a repeated
 * sync, which `addOne` flags at the point it happens.
 */

// --- read models ----------------------------------------------------------

const activityEventDoc = v.object({
  id: v.id("activityEvents"),
  ...activityEventInput,
  createdAt: v.number(),
})

const toEventDoc = withId<"activityEvents">

// --- ingestion ------------------------------------------------------------

async function addOne(ctx: MutationCtx, input: ObjectType<typeof activityEventInput>, now: number): Promise<{ created: boolean; skipped: boolean }> {
  // Skip records for MPs not on the roster rather than aborting the batch
  const mp = await findMandate(ctx, input.mpInternalId, input.wahlperiode)
  if (!mp) return { created: false, skipped: true }

  // Null `referenceId` means no natural key, so no de-duplication is possible
  // and a re-run appends. Callers deriving events from a source row should
  // always set it; the null arm exists for events that genuinely have no source.
  if (input.referenceId === null) {
    await ctx.db.insert("activityEvents", { ...input, createdAt: now })
    return { created: true, skipped: false }
  }

  // Matched on (eventType, referenceId) then narrowed to this MP. One source
  // row can produce an event per MP — a motion with forty sponsors is forty
  // events sharing a `referenceId` — so the index scopes to that motion's
  // events and the find picks out this MP's.
  const candidates = await ctx.db
    .query("activityEvents")
    .withIndex("by_eventType_and_referenceId", (q) =>
      q.eq("eventType", input.eventType).eq("referenceId", input.referenceId),
    )
    .collect()
  const existing = candidates.find((row) => row.mpInternalId === input.mpInternalId) ?? null
  const row = await upsertRow(ctx, "activityEvents", existing, input, now)
  return { created: row.created, skipped: false }
}

export const addActivityEvent = internalMutation({
  args: activityEventInput,
  returns: v.object({ id: v.optional(v.id("activityEvents")), created: v.boolean(), skipped: v.boolean() }),
  handler: async (ctx, args) => {
    const r = await addOne(ctx, args, Date.now())
    return { id: undefined, created: r.created, skipped: r.skipped }
  },
})

export const addActivityEvents = internalMutation({
  args: { events: v.array(v.object(activityEventInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.events.length, "events")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const event of args.events) {
      const r = await addOne(ctx, event, now)
      if (r.skipped) continue
      recordBatch(result, r.created)
    }
    return result
  },
})

// --- public queries -------------------------------------------------------

/**
 * One MP's feed, newest first, optionally one kind.
 *
 * Two indexes rather than one filtered in memory, because the two questions
 * page differently. Filtering a mixed page by kind would return a short page
 * of speeches for an MP whose recent record is mostly votes, and shortness is
 * indistinguishable from "there are no more" — the tab would look empty rather
 * than paginate.
 */
export const getActivityFeed = query({
  args: {
    mpInternalId: v.string(),
    eventType: v.optional(eventType),
    limit: v.optional(v.number()),
  },
  returns: v.array(activityEventDoc),
  handler: async (ctx, args) => {
    const limit = pageLimit(args.limit, 50)
    // Bound to a local before the branch, so the narrowing survives into the
    // index callback — inside it, `args.eventType` is optional again and would
    // need a non-null assertion to satisfy `eq`.
    const kind = args.eventType
    const rows =
      kind === undefined
        ? await ctx.db
            .query("activityEvents")
            .withIndex("by_mpInternalId_and_date", (q) => q.eq("mpInternalId", args.mpInternalId))
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("activityEvents")
            .withIndex("by_mpInternalId_and_eventType_and_date", (q) =>
              q.eq("mpInternalId", args.mpInternalId).eq("eventType", kind),
            )
            .order("desc")
            .take(limit)
    return rows.map(toEventDoc)
  },
})

/** The chamber-wide feed for a period — the home page's "what just happened". */
export const getChamberFeed = query({
  args: { wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ event: activityEventDoc, name: v.string(), fraktion: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("activityEvents")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .take(pageLimit(args.limit, 50))

    const joined = []
    for (const row of rows) {
      const mp = await mpLabel(ctx, row.mpInternalId, args.wahlperiode)
      joined.push({
        event: toEventDoc(row),
        name: mp.name,
        fraktion: mp.fraktion,
      })
    }
    return joined
  },
})

/**
 * Daily event counts for one MP — the contribution graph.
 *
 * The premise of the whole product ("a GitHub contributions graph for MPs", see
 * AGENTS.md), so it reads the feed rather than the monthly scores: a cell is a
 * day, and `activityScores` has no finer grain than a month.
 *
 * Bounded by an explicit date window rather than by a row count. A year of one
 * MP's events is a few hundred rows; leaving the range open on either side is
 * what would make this the query that eventually reads a whole table.
 */
export const getActivityCalendar = query({
  args: { mpInternalId: v.string(), from: v.string(), to: v.string() },
  returns: v.array(v.object({ date: v.string(), count: v.number() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("activityEvents")
      .withIndex("by_mpInternalId_and_date", (q) =>
        q.eq("mpInternalId", args.mpInternalId).gte("date", args.from).lte("date", args.to),
      )
      .collect()
    const counts = new Map<string, number>()
    for (const row of rows) {
      counts.set(row.date, (counts.get(row.date) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
  },
})
