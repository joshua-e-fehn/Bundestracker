import { type ObjectType, v } from "convex/values"
import { indexableText } from "../lib/search"
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
import { activityEventInput, eventType, searchText } from "./schema"

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
 *
 * ## `searchText` is computed here, not posted
 *
 * The keyword search's index lives on this table (convex/schema.ts), over a
 * folded copy of `title` and `description`. That copy is derived on every write
 * by `withSearchText` below rather than accepted from the caller, for the
 * reason the schema states: a payload carrying its own search text could store
 * text that finds records not matching what they say. It also means the Python
 * pipeline needed no change to populate it — the field appears the moment a row
 * is next written, and `convex/search.ts` backfills the rows that never are.
 */

// --- read models ----------------------------------------------------------

/**
 * One stored event, as a reader receives it.
 *
 * ⚠ `searchText` is declared even though nothing renders it. `withId` returns
 * the whole stored document minus Convex's system fields, and a `returns`
 * validator that omits a field the handler actually returns does not drop that
 * field — it **fails the query**, with a client error naming neither the field
 * nor the function:
 *
 * ```
 * [CONVEX Q(activityEvents:getChamberFeed)] [Request ID: …] Server Error
 * ```
 *
 * Which is exactly what happened. `activityEventInput` deliberately excludes
 * `searchText` because the field is derived on write and never posted (see the
 * header, and the note in convex/schema.ts). Building the read shape by
 * spreading the *ingestion* shape therefore described a row that stopped
 * existing the moment `withSearchText` began stamping the field — and
 * `getActivityFeed`, `getChamberFeed` and `feed.getFeed` all 500ed in
 * production, for every Wahlperiode, from the day search shipped.
 *
 * The ingestion shape and the read shape are **not** the same object, and this
 * field is the whole of the difference. `v.optional` matches the schema, where
 * it is optional because rows written before search have never been rewritten
 * (convex/search.ts backfills them in slices).
 *
 * convex/activityEvents.test.ts asserts this against the schema rather than a
 * field list, so the next column added to the table fails a test instead of
 * failing production — neither `tsc` nor `convex deploy` catches this.
 */
export const activityEventDoc = v.object({
  id: v.id("activityEvents"),
  ...activityEventInput,
  // The schema's own validator, imported rather than respelled: this field and
  // the column it describes have to agree about optionality, and two `v.optional
  // (v.string())`s in two files are two things that can drift.
  searchText,
  createdAt: v.number(),
})

const toEventDoc = withId<"activityEvents">

// --- ingestion ------------------------------------------------------------

/**
 * The stored row for an ingestion payload: the payload, plus its folded search
 * text.
 *
 * One function so insert and upsert cannot disagree about how the field is
 * derived — the way they would if each spelled out the `indexableText` call.
 * `title` and `description` are the two fields a reader's keyword could
 * plausibly be in; `date`, ids and the event type are not text anyone searches
 * in words, and `eventType` is a filter on the index rather than a term in it.
 */
export function withSearchText(input: ObjectType<typeof activityEventInput>) {
  return { ...input, searchText: indexableText(input.title, input.description) }
}

async function addOne(
  ctx: MutationCtx,
  input: ObjectType<typeof activityEventInput>,
  now: number,
): Promise<{ created: boolean; skipped: boolean }> {
  // Skip records for MPs not on the roster rather than aborting the batch
  const mp = await findMandate(ctx, input.mpInternalId, input.wahlperiode)
  if (!mp) return { created: false, skipped: true }

  const fields = withSearchText(input)

  // Null `referenceId` means no natural key, so no de-duplication is possible
  // and a re-run appends. Callers deriving events from a source row should
  // always set it; the null arm exists for events that genuinely have no source.
  if (input.referenceId === null) {
    await ctx.db.insert("activityEvents", { ...fields, createdAt: now })
    return { created: true, skipped: false }
  }

  // Direct O(1) lookup via triple-key index — avoids scanning all events
  // for a referenceId (which can be 600+ for a single vote).
  const existing = await ctx.db
    .query("activityEvents")
    .withIndex("by_eventType_and_referenceId_and_mpInternalId", (q) =>
      q
        .eq("eventType", input.eventType)
        .eq("referenceId", input.referenceId)
        .eq("mpInternalId", input.mpInternalId),
    )
    .unique()
  const row = await upsertRow(ctx, "activityEvents", existing, fields, now)
  return { created: row.created, skipped: false }
}

export const addActivityEvent = internalMutation({
  args: activityEventInput,
  returns: v.object({
    id: v.optional(v.id("activityEvents")),
    created: v.boolean(),
    skipped: v.boolean(),
  }),
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
