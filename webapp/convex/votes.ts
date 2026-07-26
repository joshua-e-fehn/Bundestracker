import { type Infer, v } from "convex/values"
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
import { vote, voteSheetInput } from "./schema"

/**
 * Named votes (namentliche Abstimmungen) — ballots and per-MP records.
 *
 * **Only ballots recorded by name**: roughly 1 015 in the Bundestag's entire
 * history (§4.4 of docs/api-research.md). Every other vote is a show of hands
 * with no per-MP record in existence, so `voteParticipationRate` is a rate over
 * named ballots and the UI has to say so — an MP who voted in every named
 * ballot has not "attended every vote", and no source can say whether they did.
 *
 * The published tallies live on the sheet and the rows in `voteRecords`,
 * deliberately un-derived from each other: `getVoteSheet` returns both, so a
 * half-finished ingest reads as a disagreement rather than a different result.
 * Which source a sheet came from matters for absences — the protocol XML lists
 * only MPs who *cast* a vote (§4.2), so only the XLSX supplies `absentCount`.
 */

// --- read models ----------------------------------------------------------

/** One of the five ballot positions. Inferred from the schema's validator so
 * `groupMajority` cannot name a sixth. */
type Vote = Infer<typeof vote>

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

// --- group majority -------------------------------------------------------

/**
 * How a parliamentary group voted, as a whole, on one ballot.
 *
 * The comparison the profile page shows beside an MP's own vote: did they go
 * with their group or against it? Answering that is the point of a *named*
 * ballot, and it is the one question the raw record cannot answer alone.
 *
 * Read off `by_voteSheetId_and_partyAtVote`, keyed on the group **printed on
 * the ballot** rather than the roster's current `fraktion`. §6.4 records six
 * WP21 MPs who changed group mid-period, and a vote from March should be
 * compared against the group the MP sat with in March.
 *
 * `absent` is excluded from the tally rather than treated as a position: a
 * group whose members mostly stayed away has no majority view, and reporting
 * "the group did not vote" as the line an MP defied would be a claim the sheet
 * does not make. When the remaining votes tie, or nobody voted, the answer is
 * null — genuinely undetermined, which the UI renders as such rather than as
 * agreement.
 */
export async function groupMajority(
  ctx: QueryCtx,
  voteSheetId: Id<"voteSheets">,
  partyAtVote: string | null,
): Promise<{ vote: Vote; share: number } | null> {
  // A record with no group on it — the sheets do carry these — has no group to
  // be compared against. Querying with null would match the other ungrouped
  // records, which are not a caucus.
  if (partyAtVote === null) return null

  const records = await ctx.db
    .query("voteRecords")
    .withIndex("by_voteSheetId_and_partyAtVote", (q) =>
      q.eq("voteSheetId", voteSheetId).eq("partyAtVote", partyAtVote),
    )
    .collect()

  const tally = new Map<Vote, number>()
  let counted = 0
  for (const record of records) {
    if (record.vote === "absent") continue
    tally.set(record.vote, (tally.get(record.vote) ?? 0) + 1)
    counted++
  }
  if (counted === 0) return null

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1])
  // A tie is not a majority. Two groups of equal size mean the group split, and
  // naming either half "the line" would invent a position.
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null
  return { vote: ranked[0][0], share: ranked[0][1] / counted }
}

/**
 * Ceiling on how many ballots one `getVotesByMP` call may compare to a group.
 *
 * Each comparison scans one group's records for one ballot — at most 209 rows
 * (§9) — so an unbounded page of 700 would be 146 000 reads against Convex's
 * ~16 000 limit. The profile page asks for five.
 *
 * Rejects rather than truncates, matching `assertBatchSize` in convex/lib/
 * ingest.ts: a silently shortened list of votes is indistinguishable from an MP
 * who voted less often.
 */
const MAX_GROUP_COMPARISONS = 25

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

/**
 * One MP's votes, newest ballot first — the profile page's voting tab.
 *
 * `groupVote` is what the MP's own group did on that ballot, so the page can
 * say whether they went with it. Computed after the page is cut rather than per
 * record: the comparison costs one group-scoped scan each, and doing it for
 * every ballot an MP has ever voted in would be the read that eventually
 * exceeds a transaction. Null means genuinely undetermined — no group on the
 * record, nobody voted, or the group tied — never "agreed"; see `groupMajority`.
 */
export const getVotesByMP = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      vote,
      remark: v.union(v.null(), v.string()),
      partyAtVote: v.union(v.null(), v.string()),
      /** The group's own majority position, or null when there is none. */
      groupVote: v.union(v.null(), v.object({ vote, share: v.number() })),
      sheet: voteSheetDoc,
    }),
  ),
  handler: async (ctx, args) => {
    const limit = pageLimit(args.limit, 50)
    if (limit > MAX_GROUP_COMPARISONS) {
      throw new Error(
        `limit ${limit} exceeds ${MAX_GROUP_COMPARISONS}: each row compares the MP's vote ` +
          "against their whole group on that ballot, so a larger page would exhaust the " +
          "transaction's read limit. Request a smaller page.",
      )
    }

    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", args.mpInternalId))
      .collect()

    const inPeriod = []
    for (const record of records) {
      const sheet = await ctx.db.get(record.voteSheetId)
      if (!sheet || sheet.wahlperiode !== args.wahlperiode) continue
      inPeriod.push({ record, sheet })
    }
    inPeriod.sort((a, b) => b.sheet.date.localeCompare(a.sheet.date))

    const joined = []
    for (const { record, sheet } of inPeriod.slice(0, limit)) {
      joined.push({
        vote: record.vote,
        remark: record.remark,
        partyAtVote: record.partyAtVote,
        groupVote: await groupMajority(ctx, sheet._id, record.partyAtVote),
        sheet: toVoteSheetDoc(sheet),
      })
    }
    return joined
  },
})
