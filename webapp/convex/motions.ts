import { type ObjectType, v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, type MutationCtx, query } from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  pageLimit,
  recordBatch,
  upsertRow,
  withId,
} from "./lib/ingest"
import { mpLabel, requireMandate } from "./mps"
import { motionInput, type motionSponsorInput } from "./schema"

/**
 * Motions, bills and the MPs who put their names to them.
 *
 * ## Why sponsors are a table and not an array
 *
 * The obvious modelling — `sponsors: v.array(...)` on the motion — cannot be
 * populated correctly from the source. DIP's `autoren_anzeige` is capped at
 * **four** entries with the real total in `autoren_anzahl` (§3.4 of
 * docs/api-research.md), so a motion with forty co-signatories arrives as four
 * names and a number. Per-MP authorship has to come from `/aktivitaet`, one
 * record per MP per document — so one row here per sponsor, arriving over time
 * rather than all at once.
 *
 * §3.4 states the consequence plainly: authorship computed from
 * `autoren_anzeige` systematically under-counts. So `getMotionSponsors` returns
 * the sponsors *known so far*, which is a growing subset of the published
 * `autoren_anzahl` and must not be presented as the signatory count.
 */

// --- read models ----------------------------------------------------------

const motionDoc = v.object({ id: v.id("motions"), ...motionInput, createdAt: v.number() })

const toMotionDoc = withId<"motions">

// --- lookup ---------------------------------------------------------------

/**
 * The row this record is about, by whichever DIP id it carries.
 *
 * A motion reaches Bundestrack as a Vorgang (the procedure) or a Drucksache
 * (the paper), rarely both, so there are two candidate keys and neither is
 * always present. Tried in that order because a Vorgang is the more stable of
 * the two: one procedure spans several papers.
 */
async function findMotion(
  ctx: MutationCtx,
  dipVorgangId: string | null,
  dipDrucksacheId: string | null,
): Promise<Doc<"motions"> | null> {
  if (dipVorgangId !== null) {
    const byVorgang = await ctx.db
      .query("motions")
      .withIndex("by_dipVorgangId", (q) => q.eq("dipVorgangId", dipVorgangId))
      .first()
    if (byVorgang) return byVorgang
  }
  if (dipDrucksacheId !== null) {
    return await ctx.db
      .query("motions")
      .withIndex("by_dipDrucksacheId", (q) => q.eq("dipDrucksacheId", dipDrucksacheId))
      .first()
  }
  return null
}

// --- ingestion ------------------------------------------------------------

async function upsertOne(ctx: MutationCtx, input: ObjectType<typeof motionInput>, now: number) {
  // The schema can express "both may be null" but not "not both", so the check
  // lives here. Without an id the row has no identity, and every sync would
  // insert the motion again — a slow-growing duplicate rather than a loud error.
  if (input.dipVorgangId === null && input.dipDrucksacheId === null) {
    throw new Error(
      `Motion "${input.title}" has neither dipVorgangId nor dipDrucksacheId; ` +
        "one is required as the upsert key.",
    )
  }
  const existing = await findMotion(ctx, input.dipVorgangId, input.dipDrucksacheId)
  return await upsertRow(ctx, "motions", existing, input, now)
}

export const upsertMotion = internalMutation({
  args: motionInput,
  returns: v.object({ id: v.id("motions"), created: v.boolean() }),
  handler: async (ctx, args) => await upsertOne(ctx, args, Date.now()),
})

export const upsertMotions = internalMutation({
  args: { motions: v.array(v.object(motionInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.motions.length, "motions")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const motion of args.motions) {
      const { created } = await upsertOne(ctx, motion, now)
      recordBatch(result, created)
    }
    return result
  },
})

/**
 * Attaches sponsors to a motion, identified by its DIP id rather than its
 * Convex id — same reason as `upsertVoteRecords`: the pipeline holds DIP ids
 * and would otherwise round-trip for a Convex id it never uses again.
 */
export const upsertMotionSponsors = internalMutation({
  args: {
    dipVorgangId: v.union(v.null(), v.string()),
    dipDrucksacheId: v.union(v.null(), v.string()),
    wahlperiode: v.number(),
    sponsors: v.array(v.object({ mpInternalId: v.string(), role: v.union(v.null(), v.string()) })),
  },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.sponsors.length, "sponsors")
    const motion = await findMotion(ctx, args.dipVorgangId, args.dipDrucksacheId)
    if (!motion) {
      throw new Error(
        `Motion not found: Vorgang ${args.dipVorgangId ?? "—"}, ` +
          `Drucksache ${args.dipDrucksacheId ?? "—"}. Ingest the motion before its sponsors.`,
      )
    }
    const now = Date.now()
    const result = emptyBatchResult()
    for (const sponsor of args.sponsors) {
      await requireMandate(ctx, sponsor.mpInternalId, args.wahlperiode)
      const existing = await ctx.db
        .query("motionSponsors")
        .withIndex("by_motionId_and_mpInternalId", (q) =>
          q.eq("motionId", motion._id).eq("mpInternalId", sponsor.mpInternalId),
        )
        .unique()
      const { created } = await upsertRow(
        ctx,
        "motionSponsors",
        existing,
        { motionId: motion._id, mpInternalId: sponsor.mpInternalId, role: sponsor.role },
        now,
      )
      recordBatch(result, created)
    }
    return result
  },
})

// --- public queries -------------------------------------------------------

/** Motions in a period, newest first. */
export const getMotions = query({
  args: { wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(motionDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("motions")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .take(pageLimit(args.limit, 50))
    return rows.map(toMotionDoc)
  },
})

/**
 * The motions one MP put their name to, newest first.
 *
 * Reads sponsorships and resolves each to its motion, rather than the reverse.
 * The sponsorship index is keyed by MP, so this is one indexed scan plus a
 * point lookup per hit; going the other way would mean scanning every motion in
 * the period.
 */
export const getMotionsByMP = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ role: v.union(v.null(), v.string()), motion: motionDoc })),
  handler: async (ctx, args) => {
    const sponsorships = await ctx.db
      .query("motionSponsors")
      .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", args.mpInternalId))
      .collect()

    const joined = []
    for (const sponsorship of sponsorships) {
      const motion = await ctx.db.get(sponsorship.motionId)
      // Period-scoped through the motion: a sponsorship carries no period of
      // its own, and an MP's mandates span several.
      if (!motion || motion.wahlperiode !== args.wahlperiode) continue
      joined.push({ role: sponsorship.role, motion: toMotionDoc(motion) })
    }
    joined.sort((a, b) => b.motion.date.localeCompare(a.motion.date))
    return joined.slice(0, pageLimit(args.limit, 50))
  },
})

/**
 * Everyone known to have sponsored one motion.
 *
 * "Known" is the operative word — see the header note on `autoren_anzeige`'s
 * cap of four. The count returned here grows as `/aktivitaet` records arrive,
 * and is not the published `autoren_anzahl`.
 */
export const getMotionSponsors = query({
  args: { motionId: v.id("motions") },
  returns: v.array(
    v.object({
      mpInternalId: v.string(),
      name: v.string(),
      fraktion: v.string(),
      role: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const motion = await ctx.db.get(args.motionId)
    if (!motion) return []
    const sponsorships = await ctx.db
      .query("motionSponsors")
      .withIndex("by_motionId_and_mpInternalId", (q) => q.eq("motionId", args.motionId))
      .collect()

    const joined = []
    for (const sponsorship of sponsorships) {
      const mp = await mpLabel(ctx, sponsorship.mpInternalId, motion.wahlperiode)
      joined.push({
        mpInternalId: sponsorship.mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        role: sponsorship.role,
      })
    }
    return joined.sort((a, b) => a.name.localeCompare(b.name, "de"))
  },
})

export type MotionArgs = ObjectType<typeof motionInput>
export type MotionSponsorArgs = ObjectType<typeof motionSponsorInput>
