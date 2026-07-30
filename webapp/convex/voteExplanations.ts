import { type ObjectType, v } from "convex/values"
import { internalMutation, internalQuery, type MutationCtx, query } from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  recordBatch,
  upsertRow,
  withoutSystemFields,
} from "./lib/ingest"
import { mpLabel, requireMandate } from "./mps"
import { voteExplanationInput } from "./schema"

/**
 * Vote explanations — `Erklärung nach § 31 GO-BT`.
 *
 * ## What a row asserts, and what it does not
 *
 * Under §31 of the Geschäftsordnung a member may put on the record why they
 * voted as they did. DIP publishes each such declaration as an `/aktivitaet`
 * with `aktivitaetsart = "Schriftliche Erklärung gem. § 31 Geschäftsordnung BT"`,
 * carrying the member's `person_id` and a `vorgangsbezug` naming the procedure.
 *
 * A row here therefore asserts exactly three things, all of them published:
 * **that** a named member filed a declaration, **which procedure** it concerns,
 * and **where** it is printed. It does not carry the member's reasoning, because
 * DIP does not publish the prose as a field — `sourceUrl` is the page-anchored
 * link to the protocol PDF where the words actually are.
 *
 * **Nothing in this file may generate, summarise or paraphrase a reason.** A
 * declaration is a named person's own statement about their own vote; inventing
 * one, or compressing one into a label, would put words in their mouth. If the
 * text is ever wanted on the page it must come from the protocol XML — where the
 * `anlagen-typ` `Erklärung nach § 31 GO` marks it (§5.2) — and not from here.
 *
 * ## The subject is not the reason
 *
 * `subject` holds the referenced procedure's title, which is *what was voted
 * on*. The ballot already has that. It is stored so a declaration can be
 * rendered without a second lookup, and it is named `subject` rather than
 * `title` so that no caller can mistake it for the explanation.
 *
 * ## Sparse by nature
 *
 * Measured 2026-07-29: protocol 21/90 carried 20 declarations across 3 of its 8
 * named ballots; 21/88 carried none at all. So most ballots have no declaration,
 * and an empty result means **none was filed** — not "not yet ingested".
 * `getExplanationCoverage` is what distinguishes those, and the UI must consult
 * it before rendering emptiness as a finding.
 */

// --- read models ----------------------------------------------------------

const voteExplanationDoc = v.object({
  ...voteExplanationInput,
  createdAt: v.number(),
})

// --- ingestion ------------------------------------------------------------

async function upsertOne(
  ctx: MutationCtx,
  input: ObjectType<typeof voteExplanationInput>,
  now: number,
) {
  // The declaration is attributed to a named member, so the roster precondition
  // applies exactly as it does to a speech or a vote record — unlike
  // `committeeReferrals`, which references no person at all.
  await requireMandate(ctx, input.mpInternalId, input.wahlperiode)
  const existing = await ctx.db
    .query("voteExplanations")
    .withIndex("by_dipAktivitaetId", (q) => q.eq("dipAktivitaetId", input.dipAktivitaetId))
    .unique()
  return await upsertRow(ctx, "voteExplanations", existing, input, now)
}

export const upsertVoteExplanations = internalMutation({
  args: { explanations: v.array(v.object(voteExplanationInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.explanations.length, "explanations")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const explanation of args.explanations) {
      const { created } = await upsertOne(ctx, explanation, now)
      recordBatch(result, created)
    }
    return result
  },
})

// --- public queries -------------------------------------------------------

/**
 * The declarations filed on one procedure — the ballot page's read.
 *
 * ## Why this takes a Vorgang id rather than a ballot
 *
 * A `voteSheets` row is keyed `(wahlperiode, sitzungnr, abstimmnr)` and carries
 * no DIP procedure id: the XLSX sheet has no id column at all (§4.1, §7). The
 * declaration, by contrast, names the procedure directly. So the join runs
 * through the Vorgang, and the caller supplies it — which keeps this query
 * honest about what it can answer. A ballot whose procedure Bundestrack has not
 * resolved gets no declarations, and that is a *linkage* gap rather than a
 * claim that none were filed.
 *
 * Bounded by the chamber: one declaration per member at most, and the largest
 * sample seen was 78 in a whole sitting.
 */
export const getExplanationsByMotion = query({
  args: { wahlperiode: v.number(), dipVorgangId: v.string() },
  returns: v.array(
    v.object({
      ...voteExplanationInput,
      createdAt: v.number(),
      name: v.string(),
      fraktion: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("voteExplanations")
      .withIndex("by_wahlperiode_and_dipVorgangId", (q) =>
        q.eq("wahlperiode", args.wahlperiode).eq("dipVorgangId", args.dipVorgangId),
      )
      .collect()

    const joined = []
    for (const row of rows) {
      const mp = await mpLabel(ctx, row.mpInternalId, row.wahlperiode)
      joined.push({
        ...withoutSystemFields<"voteExplanations">(row),
        name: mp.name,
        fraktion: mp.fraktion,
      })
    }
    return joined.sort((a, b) => a.name.localeCompare(b.name, "de"))
  },
})

/**
 * One member's declarations in a period — the profile side.
 *
 * Newest first, and capped: a member files a handful per period, but the cap is
 * unconditional rather than "a handful is small enough", for the same reason
 * every other paged read here carries one.
 */
export const getExplanationsByMP = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(voteExplanationDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("voteExplanations")
      .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
        q.eq("mpInternalId", args.mpInternalId).eq("wahlperiode", args.wahlperiode),
      )
      .order("desc")
      .take(Math.max(1, Math.min(100, Math.floor(args.limit ?? 25))))
    return rows.map(withoutSystemFields<"voteExplanations">)
  },
})

/**
 * Whether this deployment holds any §31 declaration for a period at all —
 * the one-row form of `getExplanationCoverage` above.
 *
 * The UI needs a boolean, not a count: `hasAnyForPeriod` on the disclosure
 * decides between the "none filed" and "not backfilled" empty messages, and
 * nothing on the page renders a total. So this reads at most one row —
 * `.take(1)` bounded by the period index — where the coverage query has to
 * collect the whole period to build its count. Cheaper per page load, and
 * safe against a future period that grew past the ~5 000-row soft cap that
 * `getExplanationCoverage`'s `.collect()` sits on today.
 *
 * `getExplanationCoverage` stays for operators — the count and the
 * `motionsWithExplanations` set are useful for a dashboard-side "how much
 * did this period ingest" answer that the boolean cannot give.
 *
 * The read: a single indexed range on `by_wahlperiode_and_dipVorgangId`
 * scoped to the period, `.first()` returning the first row it finds and
 * no more. Convex charges by documents read, so this costs one document
 * in a populated period and zero in an empty one.
 */
export const hasAnyExplanationsForPeriod = query({
  args: { wahlperiode: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("voteExplanations")
      .withIndex("by_wahlperiode_and_dipVorgangId", (q) => q.eq("wahlperiode", args.wahlperiode))
      .first()
    return first !== null
  },
})

/**
 * How many declarations a deployment holds for a period, and against how
 * many distinct procedures.
 *
 * **Operator surface**, reached over `POST /api/pipeline/coverage/explanations`
 * with the bearer key — see convex/http.ts and `scripts/verify-coverage.py`
 * for how it is called. The UI never calls this: every disclosure's page-level
 * read goes through `hasAnyExplanationsForPeriod` above so the read cost of
 * a browser page does not grow with the size of a period. Kept separate from
 * that boolean because a dashboard-side "how much did this period ingest"
 * answer is a different question — and one an operator running a coverage
 * check actually asks.
 *
 * Now an `internalQuery`, not a public one: the pattern the audit named
 * (`webapp/convex/voteExplanations.ts:211`) had a public surface with no UI
 * caller and no automated operator caller, which is worse than either — the
 * `.collect()` and the whole read cost were reachable by anyone who knew the
 * path. Internalising it moves the surface behind the same bearer gate the
 * ingest routes carry, so the dashboard question stays answerable and the
 * public API shrinks.
 *
 * Bounded read: `.collect()` over the period's declarations — the largest
 * measured is a low-thousands figure (WP19's busiest sitting alone carried 78,
 * across ~239 sittings). A period cap of ~5 000 rows sits two orders of
 * magnitude inside Convex's read cap, and the same range is used to build the
 * distinct-Vorgang count so both facts come out of one query rather than two.
 */
export const getExplanationCoverage = internalQuery({
  args: { wahlperiode: v.number() },
  returns: v.object({ explanations: v.number(), motionsWithExplanations: v.number() }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("voteExplanations")
      .withIndex("by_wahlperiode_and_dipVorgangId", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()
    const motions = new Set(rows.map((row) => row.dipVorgangId).filter((id) => id !== null))
    return { explanations: rows.length, motionsWithExplanations: motions.size }
  },
})
