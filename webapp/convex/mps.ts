import { type ObjectType, v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  pageLimit,
  recordBatch,
  upsertRow,
  withoutSystemFields,
} from "./lib/ingest"
import { mpInput, scoreBreakdown } from "./schema"

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

const toMpDoc = withoutSystemFields<"mps">

// --- lookup ---------------------------------------------------------------

/**
 * The mandate row for one MP in one period, or null.
 *
 * Shared by the queries and the ingestion mutations rather than duplicated:
 * this is the natural-key lookup that makes every upsert here idempotent, so
 * there is one definition of "the row this record belongs to".
 */
export async function findMandate(
  ctx: QueryCtx,
  internalId: string,
  wahlperiode: number,
): Promise<Doc<"mps"> | null> {
  // Try internalId first (the primary lookup path)
  const byInternal = await ctx.db
    .query("mps")
    .withIndex("by_internalId_and_wahlperiode", (q) =>
      q.eq("internalId", internalId).eq("wahlperiode", wahlperiode),
    )
    .unique()
  if (byInternal) return byInternal

  // Fallback: try dipPersonId — speeches and votes reference MPs by their
  // DIP person ID (e.g. "bt-11005032"), which may not match the internalId
  // minted from Stammdaten. This resolves the 3-source ID mismatch (§4.1).
  const byDip = await ctx.db
    .query("mps")
    .withIndex("by_dipPersonId_and_wahlperiode", (q) =>
      q.eq("dipPersonId", internalId).eq("wahlperiode", wahlperiode),
    )
    .unique()
  return byDip
}

/**
 * How a row keyed by `mpInternalId` is labelled for display.
 *
 * Seven modules render a list of someone else's rows — a ballot's votes, a
 * committee's members, the rankings — and each needs the same three roster
 * fields. Resolved server-side because the alternative is a query per row, and
 * a ballot is 630 of them.
 *
 * The fallbacks are why this is one function. A missing mandate is possible
 * (§7.3's Stammdaten lag), and every caller should degrade the same way: show
 * the id, so the gap is visible rather than looking like a nameless MP.
 */
export async function mpLabel(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
): Promise<{
  name: string
  fraktion: string
  electionMethod: string | null
  photoUrl: string | null
  photoCredit: string | null
}> {
  const mp = await findMandate(ctx, mpInternalId, wahlperiode)
  return {
    name: mp?.name ?? mpInternalId,
    fraktion: mp?.fraktion ?? "",
    // How the seat was won (`MANDATSART`), carried alongside the group for the
    // same reason the group is carried: it is a fact about *who this member is*
    // that a list wants to badge, and fetching it per row in each of the seven
    // surfaces built on this would be seven copies of one lookup.
    //
    // Null for a mandate this label could not resolve — §7.3's Stammdaten lag
    // leaves a real id with no row for a period — and null is *not* a list
    // mandate. `mandateType` in lib/taxonomy.ts is what keeps the two apart on
    // the way to a badge.
    electionMethod: mp?.electionMethod ?? null,
    photoUrl: mp?.photoUrl ?? null,
    // Travels with `photoUrl`, never separately. Displaying the credit is the
    // licence condition on these portraits (convex/schema.ts:207), so a label
    // that carried the image without it would let any of the seven surfaces
    // built on this render an uncredited photograph — which is exactly what
    // they all did until components/mp-photo.tsx started requiring it.
    photoCredit: mp?.photoCredit ?? null,
  }
}

/** The pair every portrait is rendered from. Declared once so a query returning
 * a photo cannot omit the credit by leaving a field out of its validator — the
 * type error is the point. */
export const photoFields = {
  photoUrl: v.union(v.null(), v.string()),
  photoCredit: v.union(v.null(), v.string()),
}

/**
 * The newest Wahlperiode on the roster, or null before the first ingest.
 *
 * Derived rather than configured, and this function is the single place that
 * derivation lives — `convex/scoreSweep.ts` calls it for the nightly sweep and
 * `getCurrentWahlperiode` below exposes it to the frontend. Two copies would be
 * two answers to "which Bundestag are we looking at", and they would diverge
 * silently on the day a new one is elected.
 *
 * One row: the index's first column is `wahlperiode`, so descending order puts
 * the current period first and `.first()` stops there.
 */
export async function newestWahlperiode(ctx: QueryCtx): Promise<number | null> {
  const newest = await ctx.db
    .query("mps")
    .withIndex("by_wahlperiode_and_fraktion")
    .order("desc")
    .first()
  return newest?.wahlperiode ?? null
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
    // Also try without the bt- prefix in case the caller passed a raw
    // Stammdaten ID, and with the bt- prefix in case they passed a raw one.
    const withPrefix = mpInternalId.startsWith("bt-") ? mpInternalId : `bt-${mpInternalId}`
    const withoutPrefix = mpInternalId.startsWith("bt-") ? mpInternalId.slice(3) : mpInternalId
    const alt1 = await findMandate(ctx, withPrefix, wahlperiode)
    if (alt1) return alt1
    const alt2 = await findMandate(ctx, withoutPrefix, wahlperiode)
    if (alt2) return alt2

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
    assertBatchSize(args.mps.length, "MPs")
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

/**
 * Which Wahlperiode the site is showing — the frontend's first read.
 *
 * Every public query here takes `wahlperiode` as a required argument, so a page
 * has to learn it before it can ask anything else. It is answered from the data
 * (see `newestWahlperiode`) rather than from a constant in the frontend: a
 * hardcoded `21` would keep serving the previous Bundestag for months after the
 * next one was sworn in, and it would do it without erroring — the pages would
 * simply show a chamber that no longer sits.
 *
 * Null means nothing has been ingested yet. That is the state of a fresh
 * deployment, not a failure, and the UI renders it as "no data" rather than as
 * an error or as period zero.
 */
export const getCurrentWahlperiode = query({
  args: {},
  returns: v.union(v.null(), v.number()),
  handler: async (ctx) => await newestWahlperiode(ctx),
})

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
 *
 * The default takes the whole chamber — 630 seats (§6.2), plus room for the
 * mid-period overhang §6.2 reconciles to 635. That is deliberate rather than
 * generous: this query has no cursor, so an unreturned row is not on a later
 * page, it is gone. At the previous default of 200 the roster stopped at "M"
 * and the largest Fraktion lost nine members, and because the sort runs *after*
 * the take, what went missing was the tail of the alphabet rather than a
 * visibly short list. Paging belongs here eventually; until it does, the
 * ceiling has to sit above the real answer.
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
      .take(pageLimit(args.limit, 700))
    return rows
      .sort(
        (a, b) =>
          a.nachname.localeCompare(b.nachname, "de") || a.vorname.localeCompare(b.vorname, "de"),
      )
      .map(toMpDoc)
  },
})

/**
 * The roster with each MP's period score attached — what the /mps table renders.
 *
 * A join rather than two queries and a merge in the browser, for the reason
 * `mpLabel` exists: the alternative is one score read per row, and the roster is
 * 630 rows. One indexed roster scan plus one point lookup each.
 *
 * The score is the **period total** — the `month: null` row that `getScores`
 * documents as the rankings' sort key — under the *default* weights. A
 * signed-in user's custom weights re-sort in the browser from `scoreBreakdown`,
 * which carries the raw counts; recomputing 630 rows server-side per slider
 * move is what `rescore` in lib/scoring.ts exists to avoid.
 *
 * `score` is null, not 0, when no row exists. The distinction is the whole
 * reason this is nullable: an MP the cron has not scored yet and an MP who did
 * nothing are different claims, and a 0 in a sortable column asserts the second.
 * Sorting is the caller's job for the same reason — the UI decides where
 * "unscored" belongs, and it is not "least active".
 *
 * ## `committees` rides along, for the roster's committee filter
 *
 * The names, not a count. `/mps` filters by *which* committee, so a count could
 * not answer it, and the per-MP list is small — the busiest WP21 member sits on
 * seven (§6.3) — so this is one indexed range scan per row rather than a second
 * page-wide query the client would have to join. `getCommitteesByMP` reads the
 * same index for one MP; this is that read, done once per roster row.
 *
 * ⚠ An empty array is ambiguous and the UI must treat it so: §6.4 records that
 * committee membership is published for the **current period only**, so on a
 * historical Wahlperiode every MP here has none, which is "not published" and
 * not "sat on nothing". convex/committees.ts carries the same warning.
 */
export const getMPsWithScores = query({
  args: {
    wahlperiode: v.number(),
    fraktion: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      mp: mpDoc,
      score: v.union(
        v.null(),
        v.object({
          totalScore: v.number(),
          voteParticipationRate: v.number(),
          scoreBreakdown,
        }),
      ),
      /** Committee names this MP sits on in this period. See the note above on
       * why an empty array is not the same as "no committees". */
      committees: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => {
        const scoped = q.eq("wahlperiode", args.wahlperiode)
        return args.fraktion === undefined ? scoped : scoped.eq("fraktion", args.fraktion)
      })
      .take(pageLimit(args.limit, 700))

    const joined = []
    for (const row of rows) {
      const score = await ctx.db
        .query("activityScores")
        .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
          q
            .eq("mpInternalId", row.internalId)
            .eq("wahlperiode", args.wahlperiode)
            .eq("month", null),
        )
        .unique()
      const memberships = await ctx.db
        .query("committeeMemberships")
        .withIndex("by_mpInternalId_and_wahlperiode_and_committeeName", (q) =>
          q.eq("mpInternalId", row.internalId).eq("wahlperiode", args.wahlperiode),
        )
        .collect()
      joined.push({
        mp: toMpDoc(row),
        score: score
          ? {
              totalScore: score.totalScore,
              voteParticipationRate: score.voteParticipationRate,
              scoreBreakdown: score.scoreBreakdown,
            }
          : null,
        // Deduplicated: §6.3 records a chair listed twice in Stammdaten, which
        // is the same reason the table is keyed per (MP, period, committee).
        committees: [...new Set(memberships.map((row) => row.committeeName))].sort((a, b) =>
          a.localeCompare(b, "de"),
        ),
      })
    }
    // Alphabetical, matching `getMPs` — the same list, so the same default
    // order, and the table's own sort starts from something a reader recognises.
    return joined.sort(
      (a, b) =>
        a.mp.nachname.localeCompare(b.mp.nachname, "de") ||
        a.mp.vorname.localeCompare(b.mp.vorname, "de"),
    )
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
