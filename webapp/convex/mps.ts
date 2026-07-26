import { type ObjectType, v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server"
import { emptyBatchResult, MAX_BATCH, pageLimit, recordBatch, upsertRow } from "./lib/ingest"
import { mpInput } from "./schema"

/**
 * The MP roster — the table every other one joins to.
 *
 * One row per **mandate**, keyed `(internalId, wahlperiode)`. See the note on
 * `mpInput` in convex/schema.ts for why a person spans several rows, and the
 * header there for why `internalId` exists at all: the Bundestag publishes an
 * MP under three incompatible identifiers and the vote sheets under none, so
 * Bundestrack mints its own and resolves the rest onto it during ingest (§7 of
 * docs/api-research.md).
 *
 * The roster comes from MdB-Stammdaten, never from DIP `/person`. §6.1 is
 * blunt about the reason: `/person` returned 803 records for WP21 against 630
 * seats, `funktion == "MdB"` both over- and under-counts (57 sitting MPs are
 * labelled otherwise because they hold a ministry), and `f.wahlperiode` matches
 * anyone who merely *appears* in a period's documents. Stammdaten reconciles to
 * exactly 630. `/person` is used for one thing only: obtaining `dipPersonId`.
 */

// --- read models ----------------------------------------------------------

/** The public shape of an MP. Convex's system fields are dropped: `internalId`
 * is the identifier every other table and every URL uses, so exposing `_id`
 * too would invite a second one into the frontend. */
const mpDoc = v.object({ ...mpInput, createdAt: v.number(), updatedAt: v.number() })

function toMpDoc(row: Doc<"mps">) {
  const { _id, _creationTime, ...rest } = row
  return rest
}

// --- lookup ---------------------------------------------------------------

/**
 * The mandate row for one MP in one period, or null.
 *
 * Shared by the queries and the ingestion mutations rather than duplicated:
 * this is the natural-key lookup that makes every upsert here idempotent, so
 * there is one definition of "the row this record belongs to".
 */
async function findMandate(
  ctx: QueryCtx,
  internalId: string,
  wahlperiode: number,
): Promise<Doc<"mps"> | null> {
  return await ctx.db
    .query("mps")
    .withIndex("by_internalId_and_wahlperiode", (q) =>
      q.eq("internalId", internalId).eq("wahlperiode", wahlperiode),
    )
    .unique()
}

/**
 * Resolves an MP reference used by another ingestion mutation.
 *
 * Every table keyed by `mpInternalId` calls this before writing, so a speech or
 * a vote naming an MP who is not on the roster is rejected at the door with a
 * message the pipeline can act on, rather than stored as an orphan that no
 * query will ever return and no error will ever mention.
 *
 * That check is not hypothetical. §7.3 records that the Stammdaten dump lags
 * reality — two MPs in a July 2026 vote sheet were missing from it entirely —
 * and the research's recommendation is precisely this: fail such rows loudly
 * and retry them on a later sync rather than dropping them.
 */
export async function requireMandate(
  ctx: MutationCtx,
  mpInternalId: string,
  wahlperiode: number,
): Promise<Doc<"mps">> {
  const mp = await findMandate(ctx, mpInternalId, wahlperiode)
  if (!mp) {
    throw new Error(
      `MP not found: ${mpInternalId} in Wahlperiode ${wahlperiode}. ` +
        "Ingest the roster (POST /api/pipeline/mps) before records that reference it.",
    )
  }
  return mp
}

// --- ingestion ------------------------------------------------------------

/** Upserts one mandate on `(internalId, wahlperiode)`. */
async function upsertOne(ctx: MutationCtx, input: ObjectType<typeof mpInput>, now: number) {
  const existing = await findMandate(ctx, input.internalId, input.wahlperiode)
  return await upsertRow(ctx, "mps", existing, input, now, { touchUpdatedAt: true })
}

export const upsertMP = internalMutation({
  args: mpInput,
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const { created } = await upsertOne(ctx, args, Date.now())
    return { created }
  },
})

/**
 * Batch form — the one the pipeline actually uses.
 *
 * A WP21 roster is 630 rows; one request each would be 630 round-trips through
 * the HTTP API. Capped at `MAX_BATCH` so a single transaction stays inside
 * Convex's read and write limits, and the pipeline chunks to match.
 */
export const upsertMPs = internalMutation({
  args: { mps: v.array(v.object(mpInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    if (args.mps.length > MAX_BATCH) {
      throw new Error(`Batch too large: ${args.mps.length} MPs, maximum is ${MAX_BATCH}`)
    }
    const now = Date.now()
    const result = emptyBatchResult()
    for (const mp of args.mps) {
      const { created } = await upsertOne(ctx, mp, now)
      recordBatch(result, created)
    }
    return result
  },
})

/**
 * Attaches a DIP person id to a mandate, after the name match resolves it.
 *
 * Separate from `upsertMP` because it happens at a different stage and from a
 * different source: the roster is built from Stammdaten first, then DIP
 * `/person` is fetched and matched onto it by folded name (§7.2, measured
 * 99.1 %). Folding it into the roster upsert would mean the pipeline could not
 * write the roster until both sources were in hand — and §11.1 orders it the
 * other way, because everything else joins to the roster.
 */
export const linkDipPersonId = internalMutation({
  args: {
    internalId: v.string(),
    wahlperiode: v.number(),
    dipPersonId: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mp = await requireMandate(ctx, args.internalId, args.wahlperiode)
    await ctx.db.patch(mp._id, { dipPersonId: args.dipPersonId, updatedAt: Date.now() })
    return null
  },
})

/**
 * Mandates still missing a DIP person id.
 *
 * §7.3's quarantine, in query form: an unresolved id means that MP's DIP
 * activities are not attached to anyone, so the pipeline retries these on the
 * next sync — when the Stammdaten dump has caught up, or a different spelling
 * matches. Reading them out beats guessing which ones failed.
 */
export const listUnlinkedMPs = internalQuery({
  args: { wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ internalId: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mps")
      .withIndex("by_dipPersonId_and_wahlperiode", (q) =>
        q.eq("dipPersonId", null).eq("wahlperiode", args.wahlperiode),
      )
      .take(pageLimit(args.limit, 100))
    return rows.map((row) => ({ internalId: row.internalId, name: row.name }))
  },
})

// --- public queries -------------------------------------------------------

/** One MP's mandate in one period. The profile page's first read. */
export const getMP = query({
  args: { internalId: v.string(), wahlperiode: v.number() },
  returns: v.union(v.null(), mpDoc),
  handler: async (ctx, args) => {
    const row = await findMandate(ctx, args.internalId, args.wahlperiode)
    return row ? toMpDoc(row) : null
  },
})

/** Every period this person has served in, newest first — the profile page's
 * period switcher. Bounded by the number of Wahlperioden, so `.collect()` is
 * safe here in a way it is not on any other table. */
export const getMPMandates = query({
  args: { internalId: v.string() },
  returns: v.array(mpDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mps")
      .withIndex("by_internalId_and_wahlperiode", (q) => q.eq("internalId", args.internalId))
      .order("desc")
      .collect()
    return rows.map(toMpDoc)
  },
})

/**
 * The roster for one period, optionally one Fraktion, alphabetically.
 *
 * `fraktion` narrows through the index rather than in memory. That is not only
 * a performance point: `.take(n)` then filtering would return an empty page for
 * a small group whose members all sort past the cutoff, which reads as "this
 * group has no MPs" rather than as a paging problem.
 *
 * Sorting happens here because the index orders by `_creationTime` within a
 * group, which is ingestion order — meaningless to a reader. The result set is
 * one Fraktion at most (209 rows at the largest, §9) so the sort is bounded.
 */
export const getMPs = query({
  args: {
    wahlperiode: v.number(),
    fraktion: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(mpDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => {
        const scoped = q.eq("wahlperiode", args.wahlperiode)
        return args.fraktion === undefined ? scoped : scoped.eq("fraktion", args.fraktion)
      })
      .take(pageLimit(args.limit, 200))
    return rows
      .sort(
        (a, b) =>
          a.nachname.localeCompare(b.nachname, "de") || a.vorname.localeCompare(b.vorname, "de"),
      )
      .map(toMpDoc)
  },
})

/**
 * Seat counts per Fraktion for one period.
 *
 * The one number §9 says *is* derivable about seating — "how many seats each
 * group holds" — as opposed to which seat a named MP occupies, which is not
 * published anywhere. convex/seating.ts builds its synthetic arc from this.
 *
 * `.collect()` over one period is 630-odd rows, an order of magnitude inside
 * Convex's read limit, and there is no cheaper way to group without a counter
 * table that every roster write would have to keep honest.
 */
export const getFractionSizes = query({
  args: { wahlperiode: v.number() },
  returns: v.array(v.object({ fraktion: v.string(), count: v.number() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()
    const counts = new Map<string, number>()
    for (const row of rows) {
      counts.set(row.fraktion, (counts.get(row.fraktion) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([fraktion, count]) => ({ fraktion, count }))
      .sort((a, b) => b.count - a.count)
  },
})
