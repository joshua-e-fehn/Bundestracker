import { type ObjectType, v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, type MutationCtx, type QueryCtx, query } from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  pageLimit,
  recordBatch,
  upsertRow,
  withId,
} from "./lib/ingest"
import { findMandate, mpLabel, requireMandate } from "./mps"
import { speechInput } from "./schema"

/**
 * Plenary speeches, parsed from the protocol XML.
 *
 * ## One row is one speaker's turn, not one `<rede>`
 *
 * §5.2 calls this the biggest trap in the corpus and the schema alone does not
 * prevent it: one `<rede>` can contain several *distinct* speakers, because a
 * Zwischenfrage nests inside the speech it interrupts. Protocol 21/90 has 112
 * `<rede>` against 197 speaker paragraphs, and attributing each to its first
 * speaker credited a minister with 1 599 words plus three interveners' 48, 134
 * and 60.
 *
 * So the pipeline re-attributes on every `klasse="redner"` paragraph and each
 * segment is one row, positioned by `speechIndex` — which makes `(wahlperiode,
 * sitzungnr, mpInternalId, speechIndex)` a natural key: an MP who speaks four
 * times has four rows, not one overwritten three times.
 *
 * ## Words, not speeches
 *
 * `wordCount` is what scoring uses. Ranking by row count puts Robert Habeck 36
 * speeches above Olaf Scholz for saying 25 % less, because question time
 * fragments a minister's turn into dozens of replies (§5.2). Both are stored,
 * one is weighted. The count excludes `<kommentar>` — applause and heckling by
 * *other* people — and the speaker header, per §5.2's extraction rule; that is
 * the pipeline's job, and this module trusts the number.
 */

// --- read models ----------------------------------------------------------

const speechDoc = v.object({ id: v.id("speeches"), ...speechInput, createdAt: v.number() })

const toSpeechDoc = withId<"speeches">

// --- ingestion ------------------------------------------------------------

async function findSegment(
  ctx: QueryCtx,
  input: ObjectType<typeof speechInput>,
): Promise<Doc<"speeches"> | null> {
  return await ctx.db
    .query("speeches")
    .withIndex("by_wahlperiode_and_sitzungnr_and_mpInternalId_and_speechIndex", (q) =>
      q
        .eq("wahlperiode", input.wahlperiode)
        .eq("sitzungnr", input.sitzungnr)
        .eq("mpInternalId", input.mpInternalId)
        .eq("speechIndex", input.speechIndex),
    )
    .unique()
}

async function upsertOne(
  ctx: MutationCtx,
  input: ObjectType<typeof speechInput>,
  now: number,
): Promise<{ created: boolean; skipped: boolean }> {
  // Skip records for MPs not on the roster rather than aborting the entire
  // batch. A single missing MP (e.g. a late addition to Stammdaten that the
  // roster dump hasn't picked up) should not block 200+ other speeches.
  const mp = await findMandate(ctx, input.mpInternalId, input.wahlperiode)
  if (!mp) return { created: false, skipped: true }
  const row = await upsertRow(ctx, "speeches", await findSegment(ctx, input), input, now)
  return { created: row.created, skipped: false }
}

export const upsertSpeech = internalMutation({
  args: speechInput,
  returns: v.object({
    id: v.optional(v.id("speeches")),
    created: v.boolean(),
    skipped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const r = await upsertOne(ctx, args, Date.now())
    if (r.skipped) return { id: undefined, created: false, skipped: true }
    // Re-query to get the id since upsertRow doesn't return it directly
    const existing = await findSegment(ctx, args)
    return { id: existing?._id, created: r.created, skipped: false }
  },
})

/**
 * A sitting's speeches, in one request.
 *
 * The natural unit of ingestion, because the source is: one protocol XML is one
 * sitting, parsed in a pass. A WP21 sitting yields on the order of 200
 * segments, inside `MAX_BATCH`.
 *
 * A re-parse of the same sitting upserts rather than duplicating, which is what
 * makes `xml_hash`-gated re-fetching (§5.1) safe to get wrong in the cheap
 * direction: re-ingesting an unchanged protocol costs writes, not correctness.
 */
export const upsertSpeeches = internalMutation({
  args: { speeches: v.array(v.object(speechInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.speeches.length, "speeches")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const speech of args.speeches) {
      const r = await upsertOne(ctx, speech, now)
      if ("skipped" in r && r.skipped) continue
      recordBatch(result, r.created)
    }
    return result
  },
})

// --- scoring --------------------------------------------------------------

/**
 * One MP's speech volume in a date window: segments, and the words in them.
 *
 * Both numbers, because they answer different questions and only one of them
 * can be ranked — see the header note. Null word counts are treated as zero: a
 * segment whose text could not be measured should not silently reduce a total,
 * and it is still a speech that happened.
 */
export async function speechVolume(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<{ speechCount: number; wordCount: number }> {
  const rows = await ctx.db
    .query("speeches")
    .withIndex("by_mpInternalId_and_protocolDate", (q) =>
      q.eq("mpInternalId", mpInternalId).gte("protocolDate", from).lte("protocolDate", to),
    )
    .collect()

  let speechCount = 0
  let wordCount = 0
  for (const row of rows) {
    if (row.wahlperiode !== wahlperiode) continue
    speechCount++
    wordCount += row.wordCount ?? 0
  }
  return { speechCount, wordCount }
}

// --- public queries -------------------------------------------------------

/** One MP's speeches, newest first — the profile page's speeches tab. */
export const getSpeechesByMP = query({
  args: {
    mpInternalId: v.string(),
    wahlperiode: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(speechDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("speeches")
      .withIndex("by_mpInternalId_and_protocolDate", (q) => q.eq("mpInternalId", args.mpInternalId))
      .order("desc")
      .take(pageLimit(args.limit, 50))
    // Period filtering after the take is safe *here* and nowhere else in this
    // file: the index is keyed by MP first, so the rows fetched are already one
    // person's, and an MP serves in few enough periods that the newest page is
    // overwhelmingly the requested one. The alternative — a fourth index on
    // (mp, wahlperiode, date) — costs a write on every speech to sharpen a page
    // boundary nobody sees.
    return rows.filter((row) => row.wahlperiode === args.wahlperiode).map(toSpeechDoc)
  },
})

/** Every speech in one sitting, in document order — the sitting view. */
export const getSpeechesBySitting = query({
  args: { wahlperiode: v.number(), sitzungnr: v.number() },
  returns: v.array(v.object({ speech: speechDoc, name: v.string(), fraktion: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("speeches")
      .withIndex("by_wahlperiode_and_sitzungnr_and_mpInternalId_and_speechIndex", (q) =>
        q.eq("wahlperiode", args.wahlperiode).eq("sitzungnr", args.sitzungnr),
      )
      .collect()

    const joined = []
    for (const row of rows) {
      const mp = await mpLabel(ctx, row.mpInternalId, args.wahlperiode)
      joined.push({
        speech: toSpeechDoc(row),
        name: mp.name,
        fraktion: mp.fraktion,
      })
    }
    // Document order, which is what `speechIndex` is for — the index sorts by
    // MP first, so the rows arrive grouped by speaker rather than as the
    // sitting unfolded.
    return joined.sort((a, b) => (a.speech.speechIndex ?? 0) - (b.speech.speechIndex ?? 0))
  },
})
