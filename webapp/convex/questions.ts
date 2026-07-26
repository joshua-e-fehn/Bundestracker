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
import { requireMandate } from "./mps"
import { questionInput, questionType } from "./schema"

/**
 * Parliamentary questions — Große and Kleine Anfragen.
 *
 * `type` is a closed union, unlike `activities.aktivitaetsart`, because the
 * distinction is constitutional rather than editorial: a Große Anfrage is
 * debated, a Kleine Anfrage answered in writing, and there is no third kind.
 *
 * **The natural key is behavioural.** No external id identifies a question as
 * such — it arrives as a Drucksache and as an `/aktivitaet` record, neither of
 * which is "the question's id" from the other side. So the key is
 * `(mpInternalId, wahlperiode, date)` narrowed by `subject`. Its failure mode
 * is worth naming: two questions from one MP on one day with the same subject
 * collapse into one row. Still the right trade — no key at all means every sync
 * re-inserts every question the MP has ever asked.
 */

// --- read models ----------------------------------------------------------

const questionDoc = v.object({ id: v.id("questions"), ...questionInput, createdAt: v.number() })

const toQuestionDoc = withId<"questions">

// --- ingestion ------------------------------------------------------------

async function upsertOne(ctx: MutationCtx, input: ObjectType<typeof questionInput>, now: number) {
  await requireMandate(ctx, input.mpInternalId, input.wahlperiode)
  const sameDay = await ctx.db
    .query("questions")
    .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
      q
        .eq("mpInternalId", input.mpInternalId)
        .eq("wahlperiode", input.wahlperiode)
        .eq("date", input.date),
    )
    .collect()
  // Bounded by one MP's questions on one day — single digits — so scanning for
  // the subject in memory is cheaper than an index over a long free-text field.
  const existing = sameDay.find((row) => row.subject === input.subject) ?? null
  return await upsertRow(ctx, "questions", existing, input, now)
}

export const upsertQuestion = internalMutation({
  args: questionInput,
  returns: v.object({ id: v.id("questions"), created: v.boolean() }),
  handler: async (ctx, args) => await upsertOne(ctx, args, Date.now()),
})

export const upsertQuestions = internalMutation({
  args: { questions: v.array(v.object(questionInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.questions.length, "questions")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const question of args.questions) {
      const { created } = await upsertOne(ctx, question, now)
      recordBatch(result, created)
    }
    return result
  },
})

// --- public queries -------------------------------------------------------

/** One MP's questions, newest first. */
export const getQuestionsByMP = query({
  args: {
    mpInternalId: v.string(),
    wahlperiode: v.number(),
    type: v.optional(questionType),
    limit: v.optional(v.number()),
  },
  returns: v.array(questionDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("questions")
      .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
        q.eq("mpInternalId", args.mpInternalId).eq("wahlperiode", args.wahlperiode),
      )
      .order("desc")
      .take(pageLimit(args.limit, 50))
    // `type` narrows a page of one MP's own questions, so unlike a filter over
    // a whole table this cannot hide rows behind a cutoff that matter: the
    // split between major and minor is lopsided (Kleine Anfragen dominate) but
    // both kinds are interleaved by date, not segregated by it.
    return rows
      .filter((row) => args.type === undefined || row.type === args.type)
      .map(toQuestionDoc)
  },
})

/** Questions across the chamber in a period, newest first. */
export const getQuestions = query({
  args: { wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(questionDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("questions")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .take(pageLimit(args.limit, 50))
    return rows.map(toQuestionDoc)
  },
})
