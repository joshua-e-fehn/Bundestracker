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

/** The group's own majority position on a ballot, or null where it has none —
 * see `majorityOf` for the three ways that happens. */
const groupVoteDoc = v.union(v.null(), v.object({ vote, share: v.number() }))

/**
 * `voteRecordDoc` plus what the ballot page needs per row: the portrait, the
 * group's line, and whether this vote broke it.
 *
 * `rebel` is computed server-side rather than derived in the table from
 * `vote !== groupVote.vote`, because that comparison has three exceptions
 * (`isRebel`) and a component that re-implemented it would eventually get one
 * of them wrong — most likely by calling an absence a dissent.
 */
const voteRecordRow = v.object({
  ...voteRecordDoc.fields,
  photoUrl: v.union(v.null(), v.string()),
  groupVote: groupVoteDoc,
  rebel: v.boolean(),
})

/** One group's row in the per-Fraktion breakdown. */
const fraktionBreakdownRow = v.object({
  /** The group as printed on the ballot — see `tallyByGroup`. */
  fraktion: v.string(),
  yes: v.number(),
  no: v.number(),
  abstain: v.number(),
  invalid: v.number(),
  absent: v.number(),
  /** Members of this group with a record on this ballot, absences included —
   * the denominator for the bar. */
  total: v.number(),
  /** Votes actually cast, i.e. `total` less absences. What `share` is over. */
  cast: v.number(),
  majority: groupVoteDoc,
  /** Members who voted against `majority`. */
  rebels: v.number(),
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

/**
 * One MP's ballot positions in a period, tallied per calendar month.
 *
 * The same read as `voteParticipation` above — one MP's records, each resolved
 * to the ballot that carries its date — aggregated the other way: that one
 * answers "what share of one window did they vote in", this one answers "how did
 * each month break down". Kept as a second function rather than folded into the
 * first because the scorer calls `voteParticipation` once per window and would
 * gain nothing from a histogram, while a chart asking it 48 times would repeat
 * this whole scan 48 times over.
 *
 * The scoping rule is `voteParticipation`'s, and is why the sheet is fetched at
 * all: a `voteRecords` row carries neither a period nor a date, so the ballot is
 * the only thing that knows when it happened and which Bundestag it belonged to.
 *
 * Absences are tallied, not dropped. §4.1's sheets encode `nichtabgegeben` as
 * its own column and convex/schema.ts keeps it distinct from `Enthaltung`, so a
 * month an MP missed entirely must render as a bar of absences rather than as a
 * month with no ballots — those are opposite claims about the same MP.
 *
 * ⚠ Unbounded by design, and safe for the reason §4.4 gives: named ballots are
 * roughly 1 015 in the Bundestag's *entire history*, so one MP's records plus
 * one sheet lookup each is a few thousand documents at the very worst — an order
 * of magnitude inside Convex's ~16 000 read limit. That bound is a property of
 * the corpus rather than of this query, which is why it is stated here: it does
 * not hold for any other table, and `getCrossPartyRankings` in convex/rankings.ts
 * bounds itself explicitly because it reads *every* MP's records rather than one's.
 */
export async function voteTallyByMonth(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
): Promise<Map<string, Record<Vote, number>>> {
  const records = await ctx.db
    .query("voteRecords")
    .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", mpInternalId))
    .collect()

  const byMonth = new Map<string, Record<Vote, number>>()
  for (const record of records) {
    const sheet = await ctx.db.get(record.voteSheetId)
    if (!sheet || sheet.wahlperiode !== wahlperiode) continue
    // Dates are ISO `YYYY-MM-DD` (schema header), so the month is a slice rather
    // than a parse — and the slice is already the zero-padded `YYYY-MM` that
    // `activityScores.month` is keyed on, so the two line up without conversion.
    const month = sheet.date.slice(0, 7)
    const counts = byMonth.get(month) ?? { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }
    counts[record.vote]++
    byMonth.set(month, counts)
  }
  return byMonth
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

  return majorityOf(records.map((record) => record.vote))
}

/**
 * The modal position among votes actually cast, or null when there is no one
 * position — the rule `groupMajority` applies, as a pure function.
 *
 * Extracted because three readers need the same answer from differently-shaped
 * inputs: `groupMajority` from one group's indexed slice, `getVoteSheetById`
 * and `getFraktionVoteBreakdown` from one already-collected sheet grouped in
 * memory. Re-deriving "the group's line" per caller is how one of them ends up
 * counting `absent`, or calling a tie a majority, and then the profile page and
 * the ballot page disagree about whether the same MP dissented.
 *
 * Both exclusions are the header's, restated once here because this is now
 * where they are enforced: `absent` is not a position, and an exact tie is a
 * split rather than a line.
 */
export function majorityOf(votes: readonly Vote[]): { vote: Vote; share: number } | null {
  const tally = new Map<Vote, number>()
  let counted = 0
  for (const vote of votes) {
    if (vote === "absent") continue
    tally.set(vote, (tally.get(vote) ?? 0) + 1)
    counted++
  }
  if (counted === 0) return null

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1])
  // A tie is not a majority. Two blocs of equal size mean the group split, and
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
 * A page of a period's ballots, with the values its filters can select — the
 * `/votes` list.
 *
 * ## Why this is not `getVoteSheets` with more arguments
 *
 * That one answers "the N most recent", which is what the home page's five-row
 * panel wants, and it does so with a single `.take(N)`. This one has to report
 * `total` so the pager can say "page 3 of 9", and a total is not something a
 * `.take()` can produce. So it reads the period's sheets and slices — the same
 * shape, and for the same reason, as `paged` in convex/rankings.ts.
 *
 * The read is bounded by the corpus rather than by a limit: §4.4 puts named
 * ballots at ~1 015 in the Bundestag's *entire history*, so one period's sheets
 * are a few hundred rows at most. That is the whole reason this can filter and
 * count in memory; it would not be safe over `voteRecords`, which is why
 * `getVoteSheetById` below is per-ballot and this one never touches them.
 *
 * `results` and `years` come back alongside the page because a filter offering
 * a value that selects nothing reads as broken data — the same decision, and
 * the same wording, as `getRankingFilterOptions`. They are computed over the
 * period's sheets *before* filtering, so choosing one filter does not empty the
 * other's dropdown.
 */
export const getVoteSheetsPage = query({
  args: {
    wahlperiode: v.number(),
    /** Substring of the title, folded case-insensitively. */
    search: v.optional(v.string()),
    /** Published outcome, matched exactly against the values in `results`. Free
     * text on the sheet (§3.2), so this is a selection from what is there
     * rather than an enum. */
    result: v.optional(v.string()),
    /** Calendar year as `YYYY`. A year rather than a month: a period spans
     * four of them and a month picker would list forty mostly-empty options. */
    year: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(voteSheetDoc),
    /** Size of the filtered set, not of the page — what the pager counts. */
    total: v.number(),
    results: v.array(v.object({ value: v.string(), count: v.number() })),
    years: v.array(v.object({ value: v.string(), count: v.number() })),
  }),
  handler: async (ctx, args) => {
    const sheets = await ctx.db
      .query("voteSheets")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .collect()

    const results = new Map<string, number>()
    const years = new Map<string, number>()
    for (const sheet of sheets) {
      results.set(sheet.result, (results.get(sheet.result) ?? 0) + 1)
      // Dates are ISO `YYYY-MM-DD` (schema header), so the year is a slice
      // rather than a parse.
      const year = sheet.date.slice(0, 4)
      years.set(year, (years.get(year) ?? 0) + 1)
    }

    // Lowercased rather than folded through lib/search.ts' `foldName`: that
    // module is the browser's, and convex/ may not import from a React-adjacent
    // path. Titles are document titles, not names — the diacritic folding
    // `foldName` exists for is about matching people.
    const needle = args.search?.trim().toLowerCase() ?? ""
    const filtered = sheets.filter((sheet) => {
      if (needle !== "" && !sheet.title.toLowerCase().includes(needle)) return false
      if (args.result !== undefined && sheet.result !== args.result) return false
      if (args.year !== undefined && sheet.date.slice(0, 4) !== args.year) return false
      return true
    })

    const limit = pageLimit(args.limit, 25)
    const offset = Math.max(0, Math.floor(args.offset ?? 0))

    const byCount = (a: { count: number }, b: { count: number }) => b.count - a.count
    return {
      rows: filtered.slice(offset, offset + limit).map(toVoteSheetDoc),
      total: filtered.length,
      results: [...results]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => byCount(a, b) || a.value.localeCompare(b.value, "de")),
      // Newest first, like the rows themselves.
      years: [...years]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.value.localeCompare(a.value)),
    }
  },
})

/**
 * Every group's position on one ballot, tallied from the records.
 *
 * The shared core of `getVoteSheetById` and `getFraktionVoteBreakdown`: both
 * need the same table, and computing it twice from one sheet's records would be
 * two chances to disagree about who dissented.
 *
 * Grouped by `partyAtVote` — the group **printed on the ballot** — falling back
 * to the roster's current `fraktion` only where the sheet carries none. §6.4's
 * six mid-period defectors are the reason that order matters: a March vote
 * belongs to the group the MP sat with in March, and reading it against their
 * July group would manufacture a dissent that never happened.
 *
 * A record with no group anywhere is counted in the totals and excluded from
 * the breakdown: it is a real vote, but not one any caucus cast.
 */
export function tallyByGroup(
  records: ReadonlyArray<{ mpInternalId: string; vote: Vote; partyAtVote: string | null }>,
  fraktionOf: (mpInternalId: string) => string,
): Map<string, { counts: Record<Vote, number>; majority: { vote: Vote; share: number } | null }> {
  const votesByGroup = new Map<string, Vote[]>()
  const countsByGroup = new Map<string, Record<Vote, number>>()

  for (const record of records) {
    const group = record.partyAtVote ?? fraktionOf(record.mpInternalId)
    if (group === "") continue
    const counts = countsByGroup.get(group) ?? { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }
    counts[record.vote]++
    countsByGroup.set(group, counts)
    const votes = votesByGroup.get(group) ?? []
    votes.push(record.vote)
    votesByGroup.set(group, votes)
  }

  const out = new Map<
    string,
    { counts: Record<Vote, number>; majority: { vote: Vote; share: number } | null }
  >()
  for (const [group, counts] of countsByGroup) {
    out.set(group, { counts, majority: majorityOf(votesByGroup.get(group) ?? []) })
  }
  return out
}

/** The group a record belongs to, by the rule `tallyByGroup` documents. */
function groupOf(
  record: { mpInternalId: string; partyAtVote: string | null },
  fraktionOf: (mpInternalId: string) => string,
): string {
  return record.partyAtVote ?? fraktionOf(record.mpInternalId)
}

/**
 * The group tally as sorted rows, matching `fraktionBreakdownRow`.
 *
 * Ordered by size, largest first, so the breakdown reads like the chamber: §9
 * puts CDU/CSU at 209 seats and fraktionslos at 3, and listing them
 * alphabetically would open the table on the three. Ties break by name so the
 * order is stable between renders.
 */
export function breakdownRows(
  groups: Map<
    string,
    { counts: Record<Vote, number>; majority: { vote: Vote; share: number } | null }
  >,
) {
  const rows = []
  for (const [fraktion, { counts, majority }] of groups) {
    const total = counts.yes + counts.no + counts.abstain + counts.invalid + counts.absent
    const cast = total - counts.absent
    // Recounted from the tally rather than carried through: a group's rebels
    // are exactly its cast votes that are not the majority position. Safe to
    // subtract from `cast` because `majorityOf` never returns `absent`, so
    // `counts[majority.vote]` is always one of the cast tallies.
    const rebels = majority === null ? 0 : cast - counts[majority.vote]
    rows.push({ fraktion, ...counts, total, cast, majority, rebels })
  }
  return rows.sort((a, b) => b.total - a.total || a.fraktion.localeCompare(b.fraktion, "de"))
}

/**
 * Whether a vote went against the voter's own group — the "rebel" flag.
 *
 * Three things are deliberately *not* dissent, and each is a claim the sheet
 * does not support:
 *
 *  - An absence. `nichtabgegeben` is not a position, so there is nothing for it
 *    to contradict; counting it would make anyone who missed a sitting a rebel.
 *  - A vote in a group with no majority — a tie, or one where nobody voted.
 *    There is no line to break. See `majorityOf`.
 *  - A vote by an MP with no group on the record and none on the roster.
 *
 * Consistent with `getCrossPartyRankings` in convex/rankings.ts, which counts
 * the same event across a window of ballots for its leaderboard.
 */
export function isRebel(vote: Vote, majority: { vote: Vote; share: number } | null): boolean {
  if (vote === "absent") return false
  if (majority === null) return false
  return vote !== majority.vote
}

/**
 * One ballot by its Convex id, with every record joined to its voter — what
 * `/votes/[id]` renders.
 *
 * ## Why an id, when `getVoteSheet` takes the natural key
 *
 * Both identify the same row, and both stay. `(wahlperiode, sitzungnr,
 * abstimmnr)` is what the XLSX sheet name encodes, so it is the key the
 * *pipeline* has and the one a reader could reconstruct from an official
 * document. The id is what a *link* has: `getVoteSheetsPage` returns rows
 * carrying `id`, and a list that already holds the identity of each row should
 * not make its detail page re-derive a three-part key to look it up again.
 *
 * `ctx.db.get` returns null for a well-formed id that names no row; an id that
 * is not a `voteSheets` id at all throws, so the route validates before calling
 * — see `app/votes/[id]/page.tsx`.
 *
 * ## What it returns beyond the records
 *
 * `tallied` alongside the sheet's published counts, for the reason in the
 * header: they are stored un-derived from each other so an incomplete ingest
 * reads as a disagreement rather than as a different result.
 *
 * `groupVote` and `rebel` per record, and `breakdown` per group, all from the
 * one read of this ballot's records — bounded by the chamber at ~630 rows.
 * Computing them here rather than in the browser is what lets the per-MP table
 * be filtered and sorted without re-deriving each group's line on every
 * keystroke.
 */
export const getVoteSheetById = query({
  args: { id: v.id("voteSheets") },
  returns: v.union(
    v.null(),
    v.object({
      sheet: voteSheetDoc,
      records: v.array(voteRecordRow),
      tallied: v.object({
        yes: v.number(),
        no: v.number(),
        abstain: v.number(),
        invalid: v.number(),
        absent: v.number(),
      }),
      breakdown: v.array(fraktionBreakdownRow),
      /** How many records went against their group's line. The table's
       * "dissenters" filter counts this, so it is stated rather than left to
       * the client to recount. */
      rebelCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const sheet = await ctx.db.get(args.id)
    if (!sheet) return null

    // Bounded by the chamber: 630-odd rows for one ballot, well inside the
    // read limit, and a page of a ballot is not a useful thing to return.
    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
      .collect()

    // One `mpLabel` per record, resolved once and reused by the tally, the
    // rows and the breakdown — the join `voteRecordDoc` exists to avoid doing
    // 630 times in the client.
    const labels = new Map<string, { name: string; fraktion: string; photoUrl: string | null }>()
    for (const record of records) {
      if (labels.has(record.mpInternalId)) continue
      labels.set(record.mpInternalId, await mpLabel(ctx, record.mpInternalId, sheet.wahlperiode))
    }
    const fraktionOf = (mpInternalId: string) => labels.get(mpInternalId)?.fraktion ?? ""

    const tallied = { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }
    for (const record of records) tallied[record.vote]++

    const groups = tallyByGroup(records, fraktionOf)

    let rebelCount = 0
    const joined = []
    for (const record of records) {
      const label = labels.get(record.mpInternalId)
      const group = groupOf(record, fraktionOf)
      const majority = groups.get(group)?.majority ?? null
      const rebel = isRebel(record.vote, majority)
      if (rebel) rebelCount++
      joined.push({
        mpInternalId: record.mpInternalId,
        name: label?.name ?? record.mpInternalId,
        fraktion: label?.fraktion ?? "",
        photoUrl: label?.photoUrl ?? null,
        vote: record.vote,
        partyAtVote: record.partyAtVote,
        remark: record.remark,
        groupVote: majority,
        rebel,
      })
    }
    joined.sort((a, b) => a.name.localeCompare(b.name, "de"))

    return {
      sheet: toVoteSheetDoc(sheet),
      records: joined,
      tallied,
      breakdown: breakdownRows(groups),
      rebelCount,
    }
  },
})

/**
 * How each parliamentary group voted on one ballot.
 *
 * The same table `getVoteSheetById` embeds, as its own query — for a caller
 * that wants the group summary without 630 rows of records crossing the wire.
 * Both go through `tallyByGroup`, so the two can never disagree.
 */
export const getFraktionVoteBreakdown = query({
  args: { id: v.id("voteSheets") },
  returns: v.union(v.null(), v.array(fraktionBreakdownRow)),
  handler: async (ctx, args) => {
    const sheet = await ctx.db.get(args.id)
    if (!sheet) return null

    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
      .collect()

    // Only the records with no group printed on them need the roster, so this
    // resolves lazily rather than labelling all 630.
    const fallback = new Map<string, string>()
    for (const record of records) {
      if (record.partyAtVote !== null || fallback.has(record.mpInternalId)) continue
      const mp = await mpLabel(ctx, record.mpInternalId, sheet.wahlperiode)
      fallback.set(record.mpInternalId, mp.fraktion)
    }

    return breakdownRows(tallyByGroup(records, (id) => fallback.get(id) ?? ""))
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
