import { type ObjectType, v } from "convex/values"
import { summarizeCommittees } from "../lib/committees"
import { internalMutation, type MutationCtx, type QueryCtx, query } from "./_generated/server"
import { assertBatchSize, emptyBatchResult, recordBatch, upsertRow, withId } from "./lib/ingest"
import { mpLabel, requireMandate } from "./mps"
import { committeeMembershipInput } from "./schema"

/**
 * Committee seats.
 *
 * ## ⚠ Current period only, and permanently so
 *
 * MdB-Stammdaten is the **only** machine-readable committee source that exists
 * — DIP `/person` has no committee field and `person_roles` none either
 * (§6.3) — and it covers the current Wahlperiode only: all 1 744 `Ausschuss`
 * entries belong to WP21 (§6.4).
 *
 * So for earlier periods `committeeCount` is 0 because nothing was published,
 * not because nobody sat on a committee. That must reach the reader, or a
 * component that silently zeroes makes every past MP look idle. §6.4's only
 * fix is archiving the ZIP each sync, so history accumulates going forward.
 *
 * One row per (MP, period, committee), because Stammdaten lists a chair
 * **twice** — as `Vorsitzender` and as `Ordentliches Mitglied` (§6.3, verified
 * on Armin Laschet). Any finer key double-counts every chair's seat; this one
 * makes that structurally impossible rather than something to remember.
 */

// --- read models ----------------------------------------------------------

const committeeMembershipDoc = v.object({
  id: v.id("committeeMemberships"),
  ...committeeMembershipInput,
  createdAt: v.number(),
})

const toMembershipDoc = withId<"committeeMemberships">

// --- ingestion ------------------------------------------------------------

async function upsertOne(
  ctx: MutationCtx,
  input: ObjectType<typeof committeeMembershipInput>,
  now: number,
) {
  await requireMandate(ctx, input.mpInternalId, input.wahlperiode)
  const existing = await ctx.db
    .query("committeeMemberships")
    .withIndex("by_mpInternalId_and_wahlperiode_and_committeeName", (q) =>
      q
        .eq("mpInternalId", input.mpInternalId)
        .eq("wahlperiode", input.wahlperiode)
        .eq("committeeName", input.committeeName),
    )
    .unique()
  return await upsertRow(ctx, "committeeMemberships", existing, input, now)
}

export const upsertCommitteeMembership = internalMutation({
  args: committeeMembershipInput,
  returns: v.object({ id: v.id("committeeMemberships"), created: v.boolean() }),
  handler: async (ctx, args) => await upsertOne(ctx, args, Date.now()),
})

export const upsertCommitteeMemberships = internalMutation({
  args: { memberships: v.array(v.object(committeeMembershipInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.memberships.length, "memberships")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const membership of args.memberships) {
      const { created } = await upsertOne(ctx, membership, now)
      recordBatch(result, created)
    }
    return result
  },
})

// --- scoring --------------------------------------------------------------

/**
 * How many committees one MP sits on in a period.
 *
 * Counts seats, not roles — see the header note on chairs appearing twice. The
 * scoring weight applies uniformly: distinguishing a full member from a
 * `Stellvertretendes Mitglied` would be defensible (the source separates them
 * cleanly, §6.3) but it is a judgement about what parliamentary work is worth,
 * and this file is not where that gets decided. The role is stored, so the
 * decision stays available.
 */
export async function committeeCount(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
): Promise<number> {
  const rows = await ctx.db
    .query("committeeMemberships")
    .withIndex("by_mpInternalId_and_wahlperiode_and_committeeName", (q) =>
      q.eq("mpInternalId", mpInternalId).eq("wahlperiode", wahlperiode),
    )
    .collect()
  return rows.length
}

// --- public queries -------------------------------------------------------

/** One MP's committee seats. Bounded — the busiest WP21 MP sits on seven
 * (§6.3) — so this collects rather than pages. */
export const getCommitteesByMP = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number() },
  returns: v.array(committeeMembershipDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("committeeMemberships")
      .withIndex("by_mpInternalId_and_wahlperiode_and_committeeName", (q) =>
        q.eq("mpInternalId", args.mpInternalId).eq("wahlperiode", args.wahlperiode),
      )
      .collect()
    return rows.map(toMembershipDoc)
  },
})

/** One committee's membership. ~100 rows at the largest (Auswärtiger
 * Ausschuss, 98 entries in WP21). */
export const getCommitteeMembers = query({
  args: { wahlperiode: v.number(), committeeName: v.string() },
  returns: v.array(
    v.object({
      mpInternalId: v.string(),
      name: v.string(),
      fraktion: v.string(),
      role: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("committeeMemberships")
      .withIndex("by_wahlperiode_and_committeeName", (q) =>
        q.eq("wahlperiode", args.wahlperiode).eq("committeeName", args.committeeName),
      )
      .collect()

    const joined = []
    for (const row of rows) {
      const mp = await mpLabel(ctx, row.mpInternalId, args.wahlperiode)
      joined.push({
        mpInternalId: row.mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        role: row.role,
      })
    }
    return joined.sort((a, b) => a.name.localeCompare(b.name, "de"))
  },
})

/**
 * The committees that exist in a period, with their sizes.
 *
 * `.collect()` over one period is ~1 744 rows for WP21 (§6.3), an order of
 * magnitude inside the read limit. For a historical period it returns an empty
 * list, which is the "nothing was published" case from the header note rather
 * than a chamber without committees — `getCommittees` cannot tell the caller
 * which, so the UI must not present emptiness as a finding.
 */
export const getCommittees = query({
  args: { wahlperiode: v.number() },
  returns: v.array(v.object({ committeeName: v.string(), memberCount: v.number() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("committeeMemberships")
      .withIndex("by_wahlperiode_and_committeeName", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()
    // The reduction lives in lib/committees.ts so it can be unit-tested
    // without a Convex handler — the read from the index stays here.
    return summarizeCommittees(rows)
  },
})
