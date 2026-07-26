import { type ObjectType, v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, type MutationCtx, type QueryCtx, query } from "./_generated/server"
import { emptyBatchResult, MAX_BATCH, pageLimit, recordBatch, upsertRow } from "./lib/ingest"
import { requireMandate } from "./mps"
import { speechInput } from "./schema"

/**
 * Plenary speeches, parsed from the protocol XML.
 *
 * ## One row is one speaker's turn, not one `<rede>`
 *
 * §5.2 of docs/api-research.md calls this the biggest trap in the whole
 * corpus, and it is worth restating here because the schema alone does not
 * prevent it: a single `<rede>` element can contain several *distinct*
 * speakers, because a Zwischenfrage is nested inside the speech it interrupts.
 * Protocol 21/90 has 112 `<rede>` elements against 197 speaker paragraphs, and
 * attributing each element to its first speaker credited one minister with
 * 1 599 words plus the 48, 134 and 60 belonging to three interveners.
 *
 * So the pipeline re-attributes on every `klasse="redner"` paragraph, and each
 * segment it emits is one row here. `speechIndex` is that segment's position in
 * the sitting, which is what makes `(wahlperiode, sitzungnr, mpInternalId,
 * speechIndex)` a natural key — an MP who speaks four times in one sitting has
 * four rows, not one that overwrites itself three times.
 *
 * ## Words, not speeches
 *
 * `wordCount` is what scoring uses. Ranking by row count puts Robert Habeck 36
 * speeches ahead of Olaf Scholz for saying 25 % less, because question time
 * fragments a minister's turn into dozens of short replies (§5.2). Both are
 * returned; only one is weighted. See lib/scoring.ts.
 *
 * The count excludes `<kommentar>` — applause and heckling *by other people* —
 * and the speaker header paragraph, per the extraction rule in §5.2. That is
 * the pipeline's job; this module trusts the number and says where it came
 * from.
 */

// --- read models ----------------------------------------------------------

const speechDoc = v.object({ id: v.id("speeches"), ...speechInput, createdAt: v.number() })

function toSpeechDoc(row: Doc<"speeches">) {
  const { _id, _creationTime, ...rest } = row
  return { id: _id, ...rest }
}

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

async function upsertOne(ctx: MutationCtx, input: ObjectType<typeof speechInput>, now: number) {
  await requireMandate(ctx, input.mpInternalId, input.wahlperiode)
  return await upsertRow(ctx, "speeches", await findSegment(ctx, input), input, now)
}

export const upsertSpeech = internalMutation({
  args: speechInput,
  returns: v.object({ id: v.id("speeches"), created: v.boolean() }),
  handler: async (ctx, args) => await upsertOne(ctx, args, Date.now()),
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
    if (args.speeches.length > MAX_BATCH) {
      throw new Error(`Batch too large: ${args.speeches.length} speeches, maximum is ${MAX_BATCH}`)
    }
    const now = Date.now()
    const result = emptyBatchResult()
    for (const speech of args.speeches) {
      const { created } = await upsertOne(ctx, speech, now)
      recordBatch(result, created)
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
      const mp = await ctx.db
        .query("mps")
        .withIndex("by_internalId_and_wahlperiode", (q) =>
          q.eq("internalId", row.mpInternalId).eq("wahlperiode", args.wahlperiode),
        )
        .unique()
      joined.push({
        speech: toSpeechDoc(row),
        name: mp?.name ?? row.mpInternalId,
        fraktion: mp?.fraktion ?? "",
      })
    }
    // Document order, which is what `speechIndex` is for — the index sorts by
    // MP first, so the rows arrive grouped by speaker rather than as the
    // sitting unfolded.
    return joined.sort((a, b) => (a.speech.speechIndex ?? 0) - (b.speech.speechIndex ?? 0))
  },
})

export type SpeechArgs = ObjectType<typeof speechInput>
