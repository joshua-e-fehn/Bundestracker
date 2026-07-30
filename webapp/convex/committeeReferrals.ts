import { type ObjectType, v } from "convex/values"
import { internalMutation, internalQuery, type MutationCtx, query } from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  recordBatch,
  upsertRow,
  withoutSystemFields,
} from "./lib/ingest"
import { committeeReferralInput } from "./schema"

/**
 * Committee referrals — DIP `Ueberweisung` (§3.3).
 *
 * ## The boundary this file exists to hold
 *
 * A referral is a fact about a **bill**: which committees the chamber sent it
 * to, and which of them leads. It names no person. `convex/committees.ts` holds
 * the other thing — which members sit on which committee — and §6.4 records
 * that its source publishes the current Wahlperiode alone.
 *
 * Those two must not be presented as one. The temptation is specific and worth
 * naming: WP14–20 have no committee membership, referrals *are* available for
 * WP18–21, and it is tempting to read a period's referral rows as partial
 * committee data recovered. They are not. Nothing here can tell you what any
 * member did, and no query in this file returns an MP.
 *
 * So there is deliberately **no `referralCount(mp)`**, no scoring input, and no
 * per-MP index — not as an omission to fill in later, but because the source
 * cannot support one and a function with that signature would be a standing
 * invitation to write one that guesses.
 *
 * ## Coverage
 *
 * Measured 2026-07-29 over date-windowed samples: WP21 4.8 % of positions,
 * WP20 6.5 %, WP19 8.5 %, WP18 9.7 %, at three to four committees per referring
 * step. `getReferralCoverage` reports what a deployment actually holds, so a
 * caller can tell an unbackfilled period from a period whose bills went
 * uncommitted.
 */

// --- read models ----------------------------------------------------------

const committeeReferralDoc = v.object({
  ...committeeReferralInput,
  createdAt: v.number(),
})

// --- ingestion ------------------------------------------------------------

async function upsertOne(
  ctx: MutationCtx,
  input: ObjectType<typeof committeeReferralInput>,
  now: number,
) {
  // No `requireMandate` counterpart, unlike every other ingestion mutation in
  // this repo: a referral references no MP, so there is no roster precondition
  // to assert. That absence is the schema note's boundary, enforced.
  const existing = await ctx.db
    .query("committeeReferrals")
    .withIndex("by_dipVorgangspositionId_and_committeeName", (q) =>
      q
        .eq("dipVorgangspositionId", input.dipVorgangspositionId)
        .eq("committeeName", input.committeeName),
    )
    .unique()
  return await upsertRow(ctx, "committeeReferrals", existing, input, now)
}

export const upsertCommitteeReferrals = internalMutation({
  args: { referrals: v.array(v.object(committeeReferralInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.referrals.length, "referrals")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const referral of args.referrals) {
      const { created } = await upsertOne(ctx, referral, now)
      recordBatch(result, created)
    }
    return result
  },
})

// --- public queries -------------------------------------------------------

/**
 * The committees one bill was referred to.
 *
 * Bounded by the procedure: three or four rows in every sample, and a step
 * cannot refer a bill to more committees than exist. Ordered lead-first,
 * because that is the distinction the source draws and the only ranking it
 * supports.
 */
export const getReferralsByMotion = query({
  args: { dipVorgangId: v.string() },
  returns: v.array(committeeReferralDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("committeeReferrals")
      .withIndex("by_dipVorgangId", (q) => q.eq("dipVorgangId", args.dipVorgangId))
      .collect()
    return rows.map(withoutSystemFields<"committeeReferrals">).sort((a, b) => {
      // `leadCommittee` is nullable and the three states are ordered
      // lead → co-advising → unstated. A boolean sort would fold null in with
      // false and claim the source had said something it did not.
      const rank = (lead: boolean | null) => (lead === true ? 0 : lead === false ? 1 : 2)
      return (
        rank(a.leadCommittee) - rank(b.leadCommittee) ||
        a.committeeName.localeCompare(b.committeeName, "de")
      )
    })
  },
})

/**
 * Whether this deployment holds any committee referral for a period at all —
 * the one-row form of `getReferralCoverage` below.
 *
 * The `/motions` disclosure needs a boolean, not a count: `hasAnyForPeriod`
 * on each row decides between the "no referral for this motion" and the
 * "not backfilled" empty messages, and nothing on the page renders a total.
 * So this reads at most one row — `.first()` bounded by the period index —
 * where the coverage query has to collect the whole period to build its
 * per-committee counts. Cheaper per page load, and safe against a future
 * period that grew past the ~few-hundred rows `getReferralCoverage`'s
 * `.collect()` sits on today.
 *
 * `getReferralCoverage` stays for **operators** — the per-committee
 * breakdown is a useful dashboard-side answer that the boolean cannot
 * give. The UI does NOT call it any more.
 *
 * The read: a single indexed range on
 * `by_wahlperiode_and_committeeName_and_date` scoped to the period,
 * `.first()` returning the first row it finds and no more. Convex charges
 * by documents read, so this costs one document in a populated period and
 * zero in an empty one.
 */
export const hasAnyReferralsForPeriod = query({
  args: { wahlperiode: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("committeeReferrals")
      .withIndex("by_wahlperiode_and_committeeName_and_date", (q) =>
        q.eq("wahlperiode", args.wahlperiode),
      )
      .first()
    return first !== null
  },
})

/**
 * What referral data a deployment holds for a period, per committee.
 *
 * **Operator surface**, reached over `POST /api/pipeline/coverage/referrals`
 * with the bearer key — see convex/http.ts and `scripts/verify-coverage.py`
 * for how it is called. The UI never calls this: every disclosure's
 * page-level read goes through `hasAnyReferralsForPeriod` above so the read
 * cost of a `/motions` load does not grow with the size of a period. Kept
 * separate from that boolean because a dashboard-side "how many referrals in
 * this period, how many lead, which committees" answer is a different
 * question — and one an operator running a coverage check actually asks.
 *
 * Now an `internalQuery`, not a public one: the pattern the audit named
 * (`webapp/convex/committeeReferrals.ts:171`) had a public surface with no UI
 * caller and no automated operator caller, which is worse than either — the
 * `.collect()` and the whole read cost were reachable by anyone who knew the
 * path. Internalising it moves the surface behind the same bearer gate the
 * ingest routes carry (http.ts:pipelineQueryRoute → pipelineRoute), so the
 * dashboard question stays answerable and the public API shrinks.
 *
 * An empty answer here means *this period has not been backfilled*, which
 * is a different statement from `getCommittees` returning empty — that one
 * means *nothing was ever published* (§6.4). Keeping them as separate
 * queries on separate tables is what lets the operator say which.
 *
 * `.collect()` over one period: WP21 holds a few hundred referrals against a
 * ~23 800-position corpus of which under 5 % refer anything, an order of
 * magnitude inside the read limit.
 */
export const getReferralCoverage = internalQuery({
  args: { wahlperiode: v.number() },
  returns: v.object({
    referrals: v.number(),
    leadReferrals: v.number(),
    committees: v.array(v.object({ committeeName: v.string(), referralCount: v.number() })),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("committeeReferrals")
      .withIndex("by_wahlperiode_and_committeeName_and_date", (q) =>
        q.eq("wahlperiode", args.wahlperiode),
      )
      .collect()

    const counts = new Map<string, number>()
    let leadReferrals = 0
    for (const row of rows) {
      counts.set(row.committeeName, (counts.get(row.committeeName) ?? 0) + 1)
      if (row.leadCommittee === true) leadReferrals++
    }
    return {
      referrals: rows.length,
      leadReferrals,
      committees: [...counts.entries()]
        .map(([committeeName, referralCount]) => ({ committeeName, referralCount }))
        .sort(
          (a, b) =>
            b.referralCount - a.referralCount ||
            a.committeeName.localeCompare(b.committeeName, "de"),
        ),
    }
  },
})
