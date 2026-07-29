import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { EVENT_TYPES } from "../lib/taxonomy"
import type { Doc } from "./_generated/dataModel"
import { type QueryCtx, query } from "./_generated/server"
import { activityEventDoc } from "./activityEvents"
import { withId } from "./lib/ingest"
import { photoFields } from "./mps"
import { eventType } from "./schema"

/**
 * The chamber-wide activity feed.
 *
 * `activityEvents.getChamberFeed` already returns the most recent N events for
 * a period, and stays the right shape for the home page's ten-item preview.
 * The feed *page* needs two things it does not have:
 *
 *  - **Real pagination.** `getChamberFeed` takes a limit and stops; there is no
 *    cursor, so "load more" would have to re-read from the top with a bigger
 *    limit — quadratic, and it re-renders every row already on screen. This
 *    uses Convex's `.paginate()`, which `usePaginatedQuery` drives directly and
 *    which keeps pages stable as new events arrive at the head.
 *  - **Filtering by type and by group.** Neither is expressible as a slice of
 *    `by_wahlperiode_and_date`, and the two filters differ in kind — which is
 *    the whole subtlety of this file, below.
 *
 * ## Two filters, two mechanisms, and why they are not the same
 *
 * **Event type has its own index.** `by_wahlperiode_and_eventType_and_date`
 * exists so a type-filtered feed is an indexed range scan. It is added by this
 * branch for exactly the reason the equivalent per-MP index already carries in
 * convex/schema.ts: taking a page of a mixed feed and then dropping the
 * non-matching rows returns a short page, and a short page is
 * indistinguishable from "there are no more". A reader filtering to
 * "Ausschuss" — a rare kind against a flood of Anfragen — would get an empty
 * first page and conclude there is no committee work.
 *
 * **Fraktion cannot have one.** An event carries no group: the group belongs to
 * the MP, in `mps`, and changes between periods (§6.4 records six WP21 members
 * changing mid-period). Denormalising it onto every event would mean rewriting
 * an MP's entire history when they cross the floor. So the group filter is
 * applied *after* the page is read — and that reintroduces the short-page
 * problem the index just solved.
 *
 * `isDone` is therefore passed through from the *underlying* pagination,
 * untouched. That is the field the group filter must not be allowed to lie
 * about: it says whether more events exist in the source, not whether more
 * matched. A page of 25 that yields 2 after filtering still reports
 * `isDone: false`, so "load more" stays offered and reaches them.
 *
 * ⚠ The cost lands on the reader as short pages: filtering to a group of 13 in
 * a 630-seat chamber keeps roughly one row in fifty, so a 25-row fetch yields
 * about one. `usePaginatedQuery` does *not* keep fetching to fill a page — it
 * fetches once per `loadMore` — so the caller compensates by requesting a
 * larger page when a group filter is set. components/activity-feed.tsx does
 * that and says so.
 *
 * The alternative that would fix it properly is denormalising `fraktion` onto
 * every event and indexing `(wahlperiode, fraktion, date)`. That is a pipeline
 * change — every event of an MP who changes group would need rewriting — and it
 * belongs with whoever owns ingestion, not here.
 */

// --- read models ----------------------------------------------------------

/**
 * A feed row: the event, plus who it is about.
 *
 * The MP's name, group and photo are denormalised into the response because the
 * alternative is one client query per row — a 50-row page would be 50
 * subscriptions. Same reason `voteRecordDoc` and `getChamberFeed` do it.
 */
export const feedItem = v.object({
  // The event itself, spread from the *read* model rather than re-derived from
  // `activityEventInput`: `join` below returns `toEventDoc(row)`, which is the
  // same stored document `getChamberFeed` returns, so the two must describe it
  // identically. Restating the shape here is what let them drift apart — this
  // row and `activityEventDoc` omitted `searchText` and 500ed in production
  // together. Now there is one description of a stored event and this is a
  // superset of it. Same composition as `voteRecordRow` in convex/votes.ts:72.
  ...activityEventDoc.fields,
  name: v.string(),
  fraktion: v.string(),
  ...photoFields,
})

const toEventDoc = withId<"activityEvents">

/**
 * Attaches the roster fields to a page of events.
 *
 * Takes the roster as a map read once for the page rather than calling
 * `mpLabel` per row: a 50-row page would otherwise be 50 indexed lookups of a
 * table that fits in one scan.
 *
 * An event whose MP is missing from the roster keeps its place, labelled with
 * its own `internalId` — `mpLabel`'s fallback, and the right one *here* (unlike
 * on a leaderboard, where convex/rankings.ts drops such rows): a feed is a
 * record of things that happened, and dropping an event because its actor is
 * unresolved would silently shorten the timeline. §7.3's Stammdaten lag makes
 * this reachable in practice.
 */
function join(rows: Doc<"activityEvents">[], mps: Map<string, Doc<"mps">>) {
  return rows.map((row) => {
    const mp = mps.get(row.mpInternalId)
    return {
      ...toEventDoc(row),
      name: mp?.name ?? row.mpInternalId,
      fraktion: mp?.fraktion ?? "",
      photoUrl: mp?.photoUrl ?? null,
      // Never without its credit — see `mpLabel` in convex/mps.ts.
      photoCredit: mp?.photoCredit ?? null,
    }
  })
}

async function roster(ctx: QueryCtx, wahlperiode: number): Promise<Map<string, Doc<"mps">>> {
  const rows = await ctx.db
    .query("mps")
    .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", wahlperiode))
    .collect()
  return new Map(rows.map((mp) => [mp.internalId, mp]))
}

// --- the feed -------------------------------------------------------------

/**
 * The chamber's feed, newest first, paginated.
 *
 * `eventType` narrows through an index; `fraktion` narrows the page in memory.
 * See the header for why those are different and what the difference costs.
 */
export const getFeed = query({
  args: {
    wahlperiode: v.number(),
    eventType: v.optional(eventType),
    fraktion: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(feedItem),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    // Bound to a local before the branch so the narrowing survives into the
    // index callback, where `args.eventType` is optional again — the same shape
    // `activityEvents.getActivityFeed` uses, and for the same reason.
    const kind = args.eventType
    const result =
      kind === undefined
        ? await ctx.db
            .query("activityEvents")
            .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("activityEvents")
            .withIndex("by_wahlperiode_and_eventType_and_date", (q) =>
              q.eq("wahlperiode", args.wahlperiode).eq("eventType", kind),
            )
            .order("desc")
            .paginate(args.paginationOpts)

    const mps = await roster(ctx, args.wahlperiode)
    const joined = join(result.page, mps)

    const fraktion = args.fraktion
    const page =
      fraktion === undefined ? joined : joined.filter((item) => item.fraktion === fraktion)

    return {
      page,
      // Passed through untouched. `isDone` describes the *source* query, so it
      // stays true to whether more events exist — which is exactly what a group
      // filter must not be allowed to lie about. See the header.
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    }
  },
})

/**
 * The filter options the feed can actually offer, for one period.
 *
 * Event-type counts come from the type index, one cheap counted range per kind
 * rather than a scan of the whole feed. They are what lets a chip read
 * "Ausschuss (12)" and, more importantly, lets a chip for a kind with no events
 * be shown as empty rather than as a filter that silently returns nothing.
 *
 * ⚠ Each count is capped at `COUNT_CEILING`; a kind at the cap is reported with
 * `atLeast: true`. Counting a period's Anfragen exactly would mean reading tens
 * of thousands of rows on every page load, and the number on a filter chip does
 * not need to be exact — but it does need to not be silently wrong, which is
 * what the flag is for.
 */
const COUNT_CEILING = 500

export const getFeedFilterOptions = query({
  args: { wahlperiode: v.number() },
  returns: v.object({
    eventTypes: v.array(v.object({ value: eventType, count: v.number(), atLeast: v.boolean() })),
    fraktionen: v.array(v.object({ value: v.string(), count: v.number() })),
  }),
  handler: async (ctx, args) => {
    const eventTypes = []
    // `EVENT_TYPES`, not a list restated here: the schema's validator is built
    // from the same tuple, so a kind the database accepts is a chip the filter
    // offers. A local copy is how you get a kind that exists in the data and
    // has no way to be selected.
    for (const kind of EVENT_TYPES) {
      const rows = await ctx.db
        .query("activityEvents")
        .withIndex("by_wahlperiode_and_eventType_and_date", (q) =>
          q.eq("wahlperiode", args.wahlperiode).eq("eventType", kind),
        )
        .take(COUNT_CEILING)
      eventTypes.push({
        value: kind,
        count: rows.length,
        atLeast: rows.length === COUNT_CEILING,
      })
    }

    const mps = await roster(ctx, args.wahlperiode)
    const fraktionen = new Map<string, number>()
    for (const mp of mps.values()) {
      fraktionen.set(mp.fraktion, (fraktionen.get(mp.fraktion) ?? 0) + 1)
    }

    return {
      eventTypes,
      // Group counts are *seats*, not events — the number of MPs in the group,
      // which is what makes the dropdown legible. An event count per group
      // would need the same post-filter scan the feed itself avoids.
      fraktionen: [...fraktionen]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de")),
    }
  },
})
