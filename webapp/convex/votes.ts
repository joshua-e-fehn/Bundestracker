import { type ObjectType, v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { internalMutation, type QueryCtx, query } from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  pageLimit,
  recordBatch,
  upsertRow,
  withId,
} from "./lib/ingest"
import { mpLabel, requireMandate } from "./mps"
import { vote, type voteRecordInput, voteSheetInput } from "./schema"

/**
 * Named votes (namentliche Abstimmungen) — ballots and per-MP records.
 *
 * **Only ballots recorded by name**: roughly 1 015 in the Bundestag's entire
 * history (§4.4 of docs/api-research.md). Every other vote is a show of hands
 * with no per-MP record in existence, so `voteParticipationRate` is a rate over
 * named ballots and the UI has to say so — an MP who voted in every named
 * ballot has not "attended every vote", and no source can say whether they did.
 *
 * The published tallies live on the sheet and the rows live in `voteRecords`,
 * deliberately un-derived from each other: `getVoteSheet` returns both, so a
 * half-finished ingest shows up as a disagreement rather than as a different
 * result. Absences are the reason it matters which source a sheet came from —
 * the protocol XML lists only MPs who *cast* a vote (§4.2), so only the XLSX
 * (§4.1) can supply `absentCount`.
 */

// --- read models ----------------------------------------------------------

const voteSheetDoc = v.object({
  id: v.id("voteSheets"),
  ...voteSheetInput,
  createdAt: v.number(),
})

const toVoteSheetDoc = withId<"voteSheets">

/** A vote record joined to the voter. The name is denormalised into the
 * response because the ballot view lists 630 rows and doing this per row in the
 * client would be 630 queries. */
const voteRecordDoc = v.object({
  mpInternalId: v.string(),
  name: v.string(),
  fraktion: v.string(),
  vote,
  partyAtVote: v.union(v.null(), v.string()),
  remark: v.union(v.null(), v.string()),
})

// --- lookup ---------------------------------------------------------------

/** The ballot identified by `(wahlperiode, sitzungnr, abstimmnr)` — what the
 * XLSX sheet name encodes (§4.1), and this table's natural key. */
async function findSheet(
  ctx: QueryCtx,
  wahlperiode: number,
  sitzungnr: number,
  abstimmnr: number,
): Promise<Doc<"voteSheets"> | null> {
  return await ctx.db
    .query("voteSheets")
    .withIndex("by_wahlperiode_and_sitzungnr_and_abstimmnr", (q) =>
      q.eq("wahlperiode", wahlperiode).eq("sitzungnr", sitzungnr).eq("abstimmnr", abstimmnr),
    )
    .unique()
}

// --- ingestion ------------------------------------------------------------

export const upsertVoteSheet = internalMutation({
  args: voteSheetInput,
  returns: v.object({ id: v.id("voteSheets"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await findSheet(ctx, args.wahlperiode, args.sitzungnr, args.abstimmnr)
    return await upsertRow(ctx, "voteSheets", existing, args, Date.now())
  },
})

/**
 * Per-MP records for one ballot.
 *
 * Takes the ballot's natural key rather than a `voteSheetId`, so the pipeline
 * can post a parsed sheet in one request without first round-tripping for a
 * Convex id it has no other use for. The sheet must already exist: a record
 * whose ballot is unknown has nothing to be a record *of*, and inserting a
 * placeholder would mean a ballot with no published tally to check the rows
 * against.
 *
 * Every row is resolved through `requireMandate`, so a name the pipeline could
 * not match to the roster fails loudly here. §7.3 is why that matters: two MPs
 * in a July 2026 vote sheet were missing from the Stammdaten dump entirely, and
 * the research's recommendation is to quarantine and retry such rows rather
 * than drop them. A rejected batch is a retry; a silently skipped row is a vote
 * that never happened.
 */
export const upsertVoteRecords = internalMutation({
  args: {
    wahlperiode: v.number(),
    sitzungnr: v.number(),
    abstimmnr: v.number(),
    records: v.array(
      v.object({
        mpInternalId: v.string(),
        vote,
        partyAtVote: v.union(v.null(), v.string()),
        remark: v.union(v.null(), v.string()),
      }),
    ),
  },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.records.length, "vote records")
    const sheet = await findSheet(ctx, args.wahlperiode, args.sitzungnr, args.abstimmnr)
    if (!sheet) {
      throw new Error(
        `Vote sheet not found: Wahlperiode ${args.wahlperiode}, sitting ${args.sitzungnr}, ` +
          `vote ${args.abstimmnr}. Ingest the sheet before its records.`,
      )
    }
    const now = Date.now()
    const result = emptyBatchResult()
    for (const record of args.records) {
      await requireMandate(ctx, record.mpInternalId, args.wahlperiode)
      const existing = await ctx.db
        .query("voteRecords")
        .withIndex("by_voteSheetId_and_mpInternalId", (q) =>
          q.eq("voteSheetId", sheet._id).eq("mpInternalId", record.mpInternalId),
        )
        .unique()
      const { created } = await upsertRow(
        ctx,
        "voteRecords",
        existing,
        { ...record, voteSheetId: sheet._id },
        now,
      )
      recordBatch(result, created)
    }
    return result
  },
})

// --- participation --------------------------------------------------------

/**
 * One MP's turnout across named ballots in a date window.
 *
 * Called by the score computation rather than exported as a query: it reads
 * every ballot the MP has a record for, which is a scoring-sized read, not a
 * page-render-sized one.
 *
 * "Participated" means a ballot was cast — `yes`, `no`, `abstain` or `invalid`.
 * An abstention is a vote: the MP was present and chose. Only `absent`
 * (`nichtabgegeben`) counts against the rate. Collapsing the two would flatter
 * everyone who stayed away, which is the specific distinction §4.1 verifies the
 * sheets encode.
 *
 * Returns `null` for `rate` when no ballot falls in the window. Zero would say
 * "never turned up" about a month in which the Bundestag held no named vote —
 * two very different statements about an MP.
 */
export async function voteParticipation(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<{ rate: number | null; cast: number; eligible: number }> {
  const records = await ctx.db
    .query("voteRecords")
    .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", mpInternalId))
    .collect()

  let cast = 0
  let eligible = 0
  for (const record of records) {
    const sheet = await ctx.db.get(record.voteSheetId)
    // Scoped by the *sheet's* period and date, not the record's: a record has
    // neither, and the ballot is what carries when it happened.
    if (!sheet || sheet.wahlperiode !== wahlperiode) continue
    if (sheet.date < from || sheet.date > to) continue
    eligible++
    if (record.vote !== "absent") cast++
  }
  return { rate: eligible === 0 ? null : cast / eligible, cast, eligible }
}

// --- public queries -------------------------------------------------------

/**
 * One ballot, with its records.
 *
 * `tallied` is counted from the rows that actually landed, alongside the
 * published counts on the sheet itself. They should agree; when they do not,
 * the ingest is incomplete, and the UI can say so rather than present a
 * confidently wrong total. See the header note.
 */
export const getVoteSheet = query({
  args: { wahlperiode: v.number(), sitzungnr: v.number(), abstimmnr: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      sheet: voteSheetDoc,
      records: v.array(voteRecordDoc),
      tallied: v.object({
        yes: v.number(),
        no: v.number(),
        abstain: v.number(),
        invalid: v.number(),
        absent: v.number(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const sheet = await findSheet(ctx, args.wahlperiode, args.sitzungnr, args.abstimmnr)
    if (!sheet) return null

    // Bounded by the chamber: 630-odd rows for one ballot, well inside the
    // read limit, and a page of a ballot is not a useful thing to return.
    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
      .collect()

    const tallied = { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }
    const joined = []
    for (const record of records) {
      tallied[record.vote]++
      const mp = await mpLabel(ctx, record.mpInternalId, sheet.wahlperiode)
      joined.push({
        mpInternalId: record.mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        vote: record.vote,
        partyAtVote: record.partyAtVote,
        remark: record.remark,
      })
    }
    joined.sort((a, b) => a.name.localeCompare(b.name, "de"))
    return { sheet: toVoteSheetDoc(sheet), records: joined, tallied }
  },
})

/** Ballots in a period, newest first. */
export const getVoteSheets = query({
  args: { wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(voteSheetDoc),
  handler: async (ctx, args) => {
    // Ordered by date rather than by the natural key: sitting number and date
    // agree on ordering only within one period, and the reader wants "most
    // recent". The period is fixed *in the index* rather than filtered after
    // the fact — taking N by date and dropping the wrong period afterwards
    // returns short pages that look like a period with fewer ballots.
    const rows = await ctx.db
      .query("voteSheets")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .take(pageLimit(args.limit, 50))
    return rows.map(toVoteSheetDoc)
  },
})

/** One MP's votes, newest ballot first — the profile page's voting tab. */
export const getVotesByMP = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      vote,
      remark: v.union(v.null(), v.string()),
      sheet: voteSheetDoc,
    }),
  ),
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", args.mpInternalId))
      .collect()

    const joined = []
    for (const record of records) {
      const sheet = await ctx.db.get(record.voteSheetId)
      if (!sheet || sheet.wahlperiode !== args.wahlperiode) continue
      joined.push({ vote: record.vote, remark: record.remark, sheet: toVoteSheetDoc(sheet) })
    }
    joined.sort((a, b) => b.sheet.date.localeCompare(a.sheet.date))
    return joined.slice(0, pageLimit(args.limit, 50))
  },
})

/** Type aliases the HTTP layer asserts request bodies into. */
export type VoteSheetArgs = ObjectType<typeof voteSheetInput>
export type VoteRecordFields = Omit<ObjectType<typeof voteRecordInput>, "voteSheetId"> & {
  voteSheetId?: Id<"voteSheets">
}
