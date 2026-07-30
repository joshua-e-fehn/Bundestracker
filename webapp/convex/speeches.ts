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
 *
 * ## The period is in the index, not in a filter
 *
 * `by_mpInternalId_and_wahlperiode_and_protocolDate`, so the read is bounded by
 * exactly the Bundestag and window asked for. It used to be the MP-and-date
 * index with `row.wahlperiode !== wahlperiode` applied afterwards, which is a
 * genuine bound for a *month* and none at all for a period total: that window is
 * `1949-01-01…2999-12-31` (see `monthWindow(null)`), so the range degenerated to
 * "this member's entire speaking career" and the period filter threw most of it
 * away. The sweep measured 2 111 speech documents for 25 members, ~42 per
 * gather, and this is the scoring input that grows fastest — WP18 alone adds 245
 * protocols against WP21's 90.
 *
 * `wahlperiode` is a required column here, unlike `voteRecords.wahlperiode`, so
 * this index needs no migration: Convex builds it over the existing rows on
 * deploy and every read is correct from the first request.
 */
export async function speechVolume(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<{ speechCount: number; wordCount: number }> {
  const rows = await speechDates(ctx, mpInternalId, wahlperiode, from, to)
  let speechCount = 0
  let wordCount = 0
  for (const row of rows) {
    speechCount++
    wordCount += row.wordCount
  }
  return { speechCount, wordCount }
}

/**
 * One MP's speech segments in a window, as (date, words) pairs.
 *
 * The read `speechVolume` does, without the aggregation — so a caller covering
 * several sub-windows of one period reads the period once and counts each window
 * in memory. See `gatherPeriod` in convex/activityScores.ts.
 *
 * The null-to-zero rule stays here rather than at the caller, for the reason
 * `speechVolume` gives: a segment whose text could not be measured is still a
 * speech that happened, and it must not silently reduce a total. Returning
 * `number | null` would push that judgement outward and let one caller subtract
 * where another does not.
 */
export async function speechDates(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<Array<{ protocolDate: string; wordCount: number }>> {
  const rows = await ctx.db
    .query("speeches")
    .withIndex("by_mpInternalId_and_wahlperiode_and_protocolDate", (q) =>
      q
        .eq("mpInternalId", mpInternalId)
        .eq("wahlperiode", wahlperiode)
        .gte("protocolDate", from)
        .lte("protocolDate", to),
    )
    .collect()
  return rows.map((row) => ({ protocolDate: row.protocolDate, wordCount: row.wordCount ?? 0 }))
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

/**
 * A hard ceiling on how many speech segments one sitting may contain.
 *
 * ## Where the number comes from, and why it fails loud
 *
 * Measured in `docs/api-research.md §5.2` against real protocols:
 * - WP21 21/90 → 197 raw segments, 108 unique speakers, 125 `(rede, redner)` units
 * - WP20 20/177 → 247 raw segments, 96 unique speakers
 *
 * Peak in evidence is 247; a generous 2× safety margin sits at ~500 and a 4×
 * margin at 1000. `getSpeechesBySitting` previously did `.collect()` with no
 * ceiling, which passes today (`247 * 1 mpLabel-lookup ≈ 250 documents`, well
 * under Convex's 16k transaction cap) but has no *guarantee* under a
 * pathologically long sitting.
 *
 * This constant is the guarantee. `.take(MAX + 1)` is an explicit ceiling; a
 * result of exactly `MAX + 1` rows means "there are at least MAX+1 speeches
 * in this sitting", and we throw rather than silently truncate — because a
 * page rendered from a truncated set of speeches would break the "in
 * document order" contract without any signal that it had (the page has no
 * count column to compare against). A soft cap that silently drops the tail
 * would corrupt the promise of `speechIndex`-ordered reading.
 *
 * The 4× margin over evidence is what makes this an accident of a
 * pathological sitting rather than a design constraint on normal ones —
 * every WP19–21 sitting the corpus has ever held is comfortably under it.
 * If the ceiling is ever hit, the error message names the (wp, sitzungnr)
 * so the reader knows which sitting outgrew the cap.
 */
export const MAX_SPEECHES_PER_SITTING = 1000

/**
 * The `getSpeechesBySitting` handler body, extracted so read-cost tests can
 * call it with a fake `ctx` without going through the query wrapper — same
 * pattern as `voteSheetsMissingVorgangHandler` in convex/votes.ts.
 */
export async function getSpeechesBySittingHandler(
  ctx: QueryCtx,
  args: { wahlperiode: number; sitzungnr: number },
): Promise<Array<{ speech: Doc<"speeches">; name: string; fraktion: string }>> {
  // `.take(MAX + 1)` is the explicit ceiling — see `MAX_SPEECHES_PER_SITTING`.
  // Taking one more than the cap is what lets us tell "exactly at the cap"
  // from "over the cap"; the `.length > MAX` check below is the fail-loud.
  const rows = await ctx.db
    .query("speeches")
    .withIndex("by_wahlperiode_and_sitzungnr_and_mpInternalId_and_speechIndex", (q) =>
      q.eq("wahlperiode", args.wahlperiode).eq("sitzungnr", args.sitzungnr),
    )
    .take(MAX_SPEECHES_PER_SITTING + 1)

  if (rows.length > MAX_SPEECHES_PER_SITTING) {
    // Silent truncation would break the document-order contract without any
    // signal that it had. Throwing surfaces the outgrown sitting in the
    // error boundary rather than in a subtly-wrong page — see the header of
    // `MAX_SPEECHES_PER_SITTING` for why the ceiling is set where it is.
    throw new Error(
      `Sitting WP${args.wahlperiode}/${args.sitzungnr} exceeded the ${MAX_SPEECHES_PER_SITTING}-segment cap ` +
        `(measured peak: 247, WP20 20/177). Raise the cap after re-measuring, or paginate the sitting read.`,
    )
  }

  // Batch the `mpLabel` join by unique MP id: a sitting where one speaker
  // gives 5 segments collapses from 5 lookups to 1. Measured against
  // 21/90 in `docs/api-research.md §5.2`: 197 rows across 108 unique
  // speakers — a ~45% reduction in indexed reads on the sitting page's
  // hottest join. Same pattern as `feed.ts` but keyed by dedup rather
  // than by a full roster read: the sitting is at most a few hundred
  // segments, and the roster is ~630 — walking the smaller set is the
  // cheaper choice when we know its size.
  const uniqueIds = new Set(rows.map((row) => row.mpInternalId))
  const labels = new Map<string, Awaited<ReturnType<typeof mpLabel>>>()
  for (const id of uniqueIds) {
    labels.set(id, await mpLabel(ctx, id, args.wahlperiode))
  }

  const joined = rows.map((row) => {
    // The label is guaranteed to exist for every id we just resolved —
    // `labels.get(row.mpInternalId)` cannot be `undefined` here because we
    // just walked `uniqueIds` which was built from these very rows. The
    // `??` fallback is a belt-and-braces guard against a future change to
    // this handler that broke the invariant, keeping the type honest.
    const mp = labels.get(row.mpInternalId)
    return {
      speech: row,
      name: mp?.name ?? row.mpInternalId,
      fraktion: mp?.fraktion ?? "",
    }
  })
  // Document order, which is what `speechIndex` is for — the index sorts by
  // MP first, so the rows arrive grouped by speaker rather than as the
  // sitting unfolded.
  return joined.sort((a, b) => (a.speech.speechIndex ?? 0) - (b.speech.speechIndex ?? 0))
}

/** Every speech in one sitting, in document order — the sitting view. */
export const getSpeechesBySitting = query({
  args: { wahlperiode: v.number(), sitzungnr: v.number() },
  returns: v.array(v.object({ speech: speechDoc, name: v.string(), fraktion: v.string() })),
  handler: async (ctx, args) => {
    // The handler runs the bounded read; here we adapt each row through
    // `toSpeechDoc` for the on-the-wire shape (system fields stripped).
    const joined = await getSpeechesBySittingHandler(ctx, args)
    return joined.map((entry) => ({
      speech: toSpeechDoc(entry.speech),
      name: entry.name,
      fraktion: entry.fraktion,
    }))
  },
})
