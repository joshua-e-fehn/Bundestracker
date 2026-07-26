import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { type MutationCtx, mutation, query } from "./_generated/server"
import { getUserId, requireUserId } from "./lib/auth"
import { preferredLocale, scoreWeights } from "./schema"

/**
 * A signed-in user's saved weightings, followed MPs and language.
 *
 * The only table in this deployment a browser writes to, and the only one
 * holding personal data. Everything else is public parliamentary record served
 * by public queries — see the note in convex/lib/auth.ts.
 *
 * **`userId` is never an argument.** Every function here takes it from the
 * session via `requireUserId`; a `userId` parameter would let any signed-in
 * user read or rewrite anyone else's preferences by supplying their id, and no
 * check inside a handler fixes an API whose shape invites it. Hence no
 * `getPreferencesFor(userId)` — not even internally, since an internal function
 * is one `internal` → `api` typo from being reachable.
 *
 * Signing in is optional (AGENTS.md), so `getPreferences` returns defaults to an
 * anonymous visitor rather than throwing. The mutations do throw: there is
 * nowhere to save to without an account, and silently discarding a user's
 * choices would be worse than telling them.
 */

const preferencesDoc = v.object({
  customWeights: v.union(v.null(), scoreWeights),
  followedMpIds: v.array(v.string()),
  preferredLocale,
})

/** What an anonymous visitor gets, and what a signed-in user starts with.
 * `customWeights: null` means "use the defaults" — distinct from a saved set
 * that happens to equal them, which must survive a change to those defaults. */
const DEFAULTS = {
  customWeights: null,
  followedMpIds: [] as string[],
  preferredLocale: null,
}

function toPreferencesDoc(row: Doc<"userPreferences"> | null) {
  if (!row) return DEFAULTS
  return {
    customWeights: row.customWeights,
    followedMpIds: row.followedMpIds,
    preferredLocale: row.preferredLocale,
  }
}

/** The caller's own row, or null. Takes the id rather than reading it, so the
 * mutations below cannot accidentally resolve a different user's row. */
async function ownRow(ctx: MutationCtx, userId: string): Promise<Doc<"userPreferences"> | null> {
  return await ctx.db
    .query("userPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique()
}

/**
 * Loads the caller's row, creating it if this is their first saved choice.
 *
 * Returns the row id so each mutation patches rather than re-reading. A user
 * gets exactly one row, enforced by every writer going through here.
 */
async function ensureRow(ctx: MutationCtx, userId: string): Promise<Doc<"userPreferences">> {
  const existing = await ownRow(ctx, userId)
  if (existing) return existing
  const now = Date.now()
  const id = await ctx.db.insert("userPreferences", {
    userId,
    ...DEFAULTS,
    createdAt: now,
    updatedAt: now,
  })
  // Non-null: just inserted. Re-read rather than synthesised so the caller
  // holds the real document, timestamps included.
  return (await ctx.db.get(id))!
}

// --- queries --------------------------------------------------------------

/**
 * The caller's preferences, or the defaults when signed out.
 *
 * Null is not an answer here: a signed-out visitor has defaults, not an error,
 * because every page renders for them. The `userId` is never returned — the
 * caller already knows who they are, and echoing it invites a client to start
 * passing it back.
 */
export const getPreferences = query({
  args: {},
  returns: preferencesDoc,
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return DEFAULTS
    const row = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique()
    return toPreferencesDoc(row)
  },
})

/** Whether the caller follows one MP — the follow button's state. Cheaper than
 * shipping the whole follow list to answer one boolean. */
export const isFollowing = query({
  args: { mpInternalId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx)
    if (!userId) return false
    const row = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique()
    return row?.followedMpIds.includes(args.mpInternalId) ?? false
  },
})

// --- mutations ------------------------------------------------------------

/**
 * Updates preferences. Omitted fields are left alone; an explicit `null`
 * clears.
 *
 * The distinction matters for `customWeights`: absent means "don't touch my
 * weights", null means "go back to the defaults". A single nullable field could
 * not say both.
 */
export const updatePreferences = mutation({
  args: {
    customWeights: v.optional(v.union(v.null(), scoreWeights)),
    preferredLocale: v.optional(preferredLocale),
  },
  returns: preferencesDoc,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const row = await ensureRow(ctx, userId)

    // Every weight is validated as finite. A NaN or Infinity reaching a stored
    // weight makes every total it produces NaN, which then sorts unpredictably
    // in the rankings and cannot be repaired by any later write — so it is
    // rejected at the boundary rather than normalised into a number that
    // silently is not the one the user chose.
    if (args.customWeights != null) {
      for (const [component, weight] of Object.entries(args.customWeights)) {
        if (!Number.isFinite(weight)) {
          throw new Error(`Weight for "${component}" must be a finite number, got ${weight}`)
        }
      }
    }

    await ctx.db.patch(row._id, {
      ...(args.customWeights !== undefined ? { customWeights: args.customWeights } : {}),
      ...(args.preferredLocale !== undefined ? { preferredLocale: args.preferredLocale } : {}),
      updatedAt: Date.now(),
    })
    return toPreferencesDoc(await ctx.db.get(row._id))
  },
})

/**
 * Follows an MP.
 *
 * Set semantics, not a toggle. Following someone already followed is a no-op
 * that returns the same list — so a double-tap, or an HTTP retry after a
 * dropped response, cannot silently unfollow. `unfollowMP` is the separate,
 * equally idempotent inverse. A single `toggleFollow` would be the shorter API
 * and the wrong one.
 */
export const followMP = mutation({
  args: { mpInternalId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const row = await ensureRow(ctx, userId)
    if (row.followedMpIds.includes(args.mpInternalId)) return row.followedMpIds
    const followedMpIds = [...row.followedMpIds, args.mpInternalId]
    await ctx.db.patch(row._id, { followedMpIds, updatedAt: Date.now() })
    return followedMpIds
  },
})

/** Unfollows an MP. Idempotent, for the same reason as `followMP`. */
export const unfollowMP = mutation({
  args: { mpInternalId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const row = await ownRow(ctx, userId)
    // No row means nothing followed; creating one to record that would be a
    // write on behalf of a user who has chosen nothing.
    if (!row || !row.followedMpIds.includes(args.mpInternalId)) return row?.followedMpIds ?? []
    const followedMpIds = row.followedMpIds.filter((id) => id !== args.mpInternalId)
    await ctx.db.patch(row._id, { followedMpIds, updatedAt: Date.now() })
    return followedMpIds
  },
})

/**
 * The MPs the caller follows, as roster rows for one period.
 *
 * Resolved here rather than in the client because a follow list is
 * `internalId`s and the UI needs names, groups and photos. Bounded by how many
 * MPs one person follows; an MP followed but not sitting in the requested
 * period is skipped rather than rendered as a gap.
 */
export const getFollowedMPs = query({
  args: { wahlperiode: v.number() },
  returns: v.array(
    v.object({
      internalId: v.string(),
      name: v.string(),
      fraktion: v.string(),
      photoUrl: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const row = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique()
    if (!row) return []

    const followed = []
    for (const internalId of row.followedMpIds) {
      const mp = await ctx.db
        .query("mps")
        .withIndex("by_internalId_and_wahlperiode", (q) =>
          q.eq("internalId", internalId).eq("wahlperiode", args.wahlperiode),
        )
        .unique()
      if (!mp) continue
      followed.push({
        internalId: mp.internalId,
        name: mp.name,
        fraktion: mp.fraktion,
        photoUrl: mp.photoUrl,
      })
    }
    return followed.sort((a, b) => a.name.localeCompare(b.name, "de"))
  },
})
