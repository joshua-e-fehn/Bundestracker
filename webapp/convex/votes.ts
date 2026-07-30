import { type Infer, v } from "convex/values"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  pageLimit,
  recordBatch,
  upsertRow,
  withId,
} from "./lib/ingest"
import { findMandate, mpLabel, photoFields } from "./mps"
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

/** The ballot as a caller sees it.
 *
 * `dipVorgangId` is `v.optional` in storage — it was added to a populated table,
 * where a required field fails the whole deploy — but **total here**, for the
 * reason `mpDoc` gives at convex/mps.ts: a `returns` validator that does not
 * allow `undefined` fails the entire query with a bare "Server Error" naming
 * neither field nor function, and pushing a third state out to every consumer
 * would make them handle something that means exactly what `null` already does.
 * `toVoteSheetDoc` normalises it. */
const voteSheetDoc = v.object({
  id: v.id("voteSheets"),
  ...voteSheetInput,
  dipVorgangId: v.union(v.null(), v.string()),
  createdAt: v.number(),
})

/** Drops the system fields and fills in the read shape's one total column —
 * see `voteSheetDoc` on why `dipVorgangId` is nullable here but optional in
 * storage. */
function toVoteSheetDoc(row: Doc<"voteSheets">) {
  const doc = withId<"voteSheets">(row)
  return { ...doc, dipVorgangId: doc.dipVorgangId ?? null }
}

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
  ...photoFields,
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
      // Skip records for MPs not on the roster rather than aborting the batch
      const mp = await findMandate(ctx, record.mpInternalId, args.wahlperiode)
      if (!mp) continue
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
        // The ballot's period and date, copied onto the row — see
        // `voteRecordScopeFields` in convex/schema.ts for why. Taken from the
        // sheet this mutation already had to fetch to get `_id`, so it costs no
        // read; taken from the *sheet* rather than from `args.wahlperiode` so a
        // record cannot claim a period its ballot does not have, even though
        // `findSheet` matched on that argument and the two agree by
        // construction.
        { ...record, voteSheetId: sheet._id, wahlperiode: sheet.wahlperiode, date: sheet.date },
        now,
      )
      recordBatch(result, created)
    }

    // The dissent flags, in their own transaction — see `refreshBallotDissent`.
    // Scheduled rather than inlined because deciding dissent needs the *whole*
    // ballot plus the roster, and this mutation has already spent its read
    // budget resolving 500 mandates.
    //
    // Once per call, so a 630-row ballot posted in two chunks schedules two
    // refreshes. Both are wanted: the first computes lines from a half-ingested
    // ballot and is therefore wrong, and the second — seeing the complete set —
    // overwrites it. That correction is exact because the flags are derived from
    // the records rather than accumulated onto them.
    //
    // The refresh in turn schedules the period tallies for the members it
    // touched. Two hops rather than one because the two writes have different
    // natural keys — a ballot, and a member — and folding them into one
    // transaction is precisely what made the tally the deployment's contention
    // point. See `refreshBallotDissent`.
    await ctx.scheduler.runAfter(0, internal.votes.refreshBallotDissent, {
      voteSheetId: sheet._id,
    })
    return result
  },
})

// --- the dissent tally ----------------------------------------------------

/**
 * The dissent flags for one ballot. **Flags only — it writes no tally.**
 *
 * ## Why the flags are stored rather than computed on read
 *
 * Dissent is relative: it exists only against how the rest of the group voted in
 * the same division, so answering it for one record costs a scan of that group's
 * ~209 rows. `getVotesByMP` caps itself at 25 rows for exactly that reason, and
 * `getCrossPartyRankings` could only ever report the most recent 20 ballots —
 * ~630 records each against Convex's ~16 000-document read limit, which is 25
 * ballots' worth of budget for a question about four years.
 *
 * A period-wide figure is therefore not a larger version of that read. It is the
 * same answer decided once, at the moment a ballot lands, by the one caller that
 * already holds all 630 of its records — and then rolled up per member.
 *
 * ## ⚠ Why the roll-up is not written here, which is the whole fix
 *
 * It used to be. This mutation computed each record's flags, diffed them against
 * the stored ones, and applied the difference to the member's `dissentTallies`
 * row — up to 630 tally rows patched in one transaction. That is a correct
 * algorithm and a pathological write shape, and it is what made this the
 * deployment's contention point:
 *
 *  - **Every ballot wrote the same 630 documents.** A backfill refreshing three
 *    ballots per slice, or a sync posting a 630-row ballot in two chunks (which
 *    schedules two refreshes), had transactions whose write sets overlapped
 *    almost totally. Convex is optimistic: overlapping write sets are retried,
 *    and a retry re-reads and re-writes the same 630 rows.
 *  - **Every reader overlapped every writer.** `periodDissent` reads all ~630
 *    tally rows for the leaderboard in one indexed scan, so a page render
 *    conflicted with any refresh in flight.
 *  - **The delta made retries load-bearing.** A delta is only correct applied
 *    exactly once, so the flags and the tally had to be written together to stay
 *    consistent — which is precisely what forced the two keys into one
 *    transaction.
 *
 * Now this mutation writes **only the records of its own ballot**. Two ballots
 * have disjoint records by construction, so two refreshes can never conflict
 * with each other, and neither conflicts with the leaderboard, which reads a
 * different table. The roll-up is derived afterwards, keyed by member, by
 * `recomputeDissentTallies` — which this schedules for exactly the members whose
 * flags moved.
 *
 * That also removes the delta. Deriving a tally from the stored flags is
 * idempotent by construction rather than by careful bookkeeping: re-running it
 * arrives at the same number, so an OCC retry, a duplicate schedule and a
 * re-ingest are all harmless. The old form had to clamp at zero to avoid
 * printing a negative dissent count on a public leaderboard if the two ever came
 * apart; the derived form cannot come apart, because there is only one source.
 *
 * ## What the flags mean
 *
 * `isRebel` decides, not this function — the same rule the ballot page and the
 * profile page render, so a stored flag and a displayed badge cannot come apart.
 * `dissentCounted` is the denominator and is deliberately **not** `!dissent`:
 * an absence and a vote in an evenly-split group are both "not a dissent" and
 * neither belongs among the ballots on which the member could have dissented.
 *
 * ## Cost
 *
 * Reads one ballot's records (~630) and the roster (~630, for the group
 * fallback). Writes only the records whose flags actually changed — zero on a
 * re-ingest that changed nothing, which is the common case.
 */
export const refreshBallotDissent = internalMutation({
  args: {
    voteSheetId: v.id("voteSheets"),
    /**
     * Whether to schedule the period roll-up for the members touched.
     *
     * True by default, because a ballot landing on its own must leave the tally
     * correct. `backfillDissent` passes false and rolls up once at the end of
     * its walk instead: a migration refreshes every ballot in the period, so
     * per-ballot scheduling would queue the same member's recompute once per
     * ballot they voted in — ~390 redundant transactions per member, each
     * arriving at the same answer.
     */
    cascade: v.optional(v.boolean()),
  },
  returns: v.object({
    /** Records whose stored flags changed. Zero on a re-ingest that changed
     * nothing, which is the common case and the cheap one. */
    updated: v.number(),
    /** Members whose flags moved, and whose period tally is therefore stale
     * until the roll-up runs. Named `mpsTouched` as before: the number means the
     * same thing to a caller, it is simply no longer written in this
     * transaction. */
    mpsTouched: v.number(),
  }),
  handler: async (ctx, args) => {
    const sheet = await ctx.db.get(args.voteSheetId)
    // Deleted between the schedule and the run. Not an error: there is no ballot
    // left to have dissented in.
    if (!sheet) return { updated: 0, mpsTouched: 0 }

    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
      .collect()

    // The roster, once, for the records that carry no group of their own — the
    // same fallback `tallyByGroup` documents. One scan rather than `mpLabel` per
    // record, which would be 630 indexed lookups.
    const roster = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", sheet.wahlperiode))
      .collect()
    const fraktionOf = new Map(roster.map((mp) => [mp.internalId, mp.fraktion]))
    const groups = tallyByGroup(records, (id) => fraktionOf.get(id) ?? "")

    /** Members whose flags moved — the roll-up's work list, and nothing more.
     * A set rather than a delta map: what the tally should become is read from
     * the flags, not carried from here. */
    const touched = new Set<string>()
    let updated = 0

    for (const record of records) {
      const group = groupOf(record, (id) => fraktionOf.get(id) ?? "")
      const majority = groups.get(group)?.majority ?? null
      // `dissentFlagsFor` decides both, including why the denominator is not
      // simply "not a dissent" — see its header.
      const { dissent, counted: dissentCounted } = dissentFlagsFor(record.vote, majority)

      // Unchanged rows are skipped rather than re-patched: a re-ingest is the
      // common case (§2.5) and this is what makes it free. An *unset* flag is
      // "not yet computed" rather than `false`, and `undefined !== false`, so a
      // row the backfill has not reached never matches here and is always
      // written — which is what fills them in.
      if (record.dissent === dissent && record.dissentCounted === dissentCounted) continue

      await ctx.db.patch(record._id, { dissent, dissentCounted })
      updated++
      touched.add(record.mpInternalId)
    }

    if ((args.cascade ?? true) && touched.size > 0) {
      // Scheduled, not called: a separate transaction per slice is the point,
      // and `runAfter(0)` gives one that does not inherit this transaction's
      // read set. Chunked because the schedule's own argument list is bounded
      // and because a slice is a transaction — see `TALLY_SLICE`.
      for (const slice of chunk([...touched], TALLY_SLICE)) {
        await ctx.scheduler.runAfter(0, internal.votes.recomputeDissentTallies, {
          wahlperiode: sheet.wahlperiode,
          mpInternalIds: slice,
        })
      }
    }

    return { updated, mpsTouched: touched.size }
  },
})

/**
 * Members per tally-recompute transaction.
 *
 * Each one reads that member's flagged records for the period — bounded by the
 * corpus rather than by the chamber (§4.4: ~1 015 named ballots in the
 * Bundestag's entire history, of which 391 carry a machine-readable sheet), so
 * ~390 documents at the very worst — and writes exactly one row. 64 of them is
 * ~25 000 reads worst-case, which is inside Convex's 32 000-document ceiling
 * with the roster-free margin this needs.
 *
 * Sized in *members*, not ballots, and that is the structural point: the cost of
 * a slice scales with the members it names, never with the period's history or
 * the chamber's size. Adding WP18 adds no vote records at all (no XLSX exists
 * before 2019-09), so this bound does not erode as the backfill deepens.
 */
export const TALLY_SLICE = 64

/** Fixed-size chunks of a list, preserving order. Exported for
 * convex/votes.test.ts, which asserts the partition invariant on it. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The write keys one `recomputeDissentTallies` call will touch.
 *
 * Extracted and pure so the partitioning invariant is *asserted* rather than
 * inspected: two calls with disjoint `mpInternalIds` produce disjoint key sets,
 * which is exactly the property that makes them non-conflicting transactions.
 * convex/votes.test.ts checks it, including over the chunking above — a bug that
 * let one member appear in two slices would reintroduce the contention this
 * whole design removes, and it would do so silently, since the arithmetic is
 * idempotent and the final numbers would still be right.
 */
export function dissentWriteKeys(wahlperiode: number, mpInternalIds: readonly string[]): string[] {
  return mpInternalIds.map((id) => `dissentTallies:${id}:${wahlperiode}`)
}

/**
 * Derives one slice of members' period dissent tallies from their stored flags.
 *
 * ## Derived, not accumulated
 *
 * Reads the member's own `voteRecords` for the period and counts the flags
 * `refreshBallotDissent` put there. Nothing is added to a previous value, so:
 *
 *  - **Re-running is a no-op.** The pipeline re-ingests by design (§2.5) and
 *    Convex retries a conflicted mutation transparently; both arrive at the same
 *    number rather than at twice it.
 *  - **It is the repair.** A tally that has drifted for any reason — including
 *    one written by the delta implementation this replaces — is corrected by
 *    running this, because the answer does not depend on what was there before.
 *  - **It cannot go negative**, so it needs no clamp. The old form clamped
 *    because a delta could outrun its own history; a count of stored flags
 *    cannot.
 *
 * ## Why one member per row, and why that is the partitioning
 *
 * `dissentTallies` is keyed `(mpInternalId, wahlperiode)`, so a call naming a set
 * of members writes exactly that set of documents — see `dissentWriteKeys`. Two
 * concurrent calls over disjoint member sets have disjoint write sets and cannot
 * conflict, which is what the ballot-keyed writer could not offer: *its* natural
 * key was the ballot, but the rows it had to write were keyed by member, so
 * every ballot wrote every member.
 *
 * ## The period scope is an index range, not a filter
 *
 * `by_mpInternalId_and_wahlperiode_and_date` bounds the read to this member's
 * records in this Bundestag. Before that index existed the only per-MP index was
 * `by_mpInternalId` — the member's whole career — and recovering the period meant
 * a `ctx.db.get` per record. See `voteRecordScopeFields` in convex/schema.ts.
 *
 * ⚠ Records the scope backfill has not reached are **absent from this range**,
 * so a tally derived before `backfillVoteRecordScope` completes counts only the
 * migrated ones. That is the honest failure — an undercount that repairs itself
 * when this is re-run — rather than a mis-attribution, and it is why the
 * migration order in the report puts the scope backfill first.
 */
export const recomputeDissentTallies = internalMutation({
  args: {
    wahlperiode: v.number(),
    /** The members to roll up. Bounded by `TALLY_SLICE`; a longer list is
     * rejected rather than truncated, matching `assertBatchSize` — a silently
     * shortened slice would leave tallies stale with nothing to say so. */
    mpInternalIds: v.array(v.string()),
  },
  returns: v.object({
    /** Rows written. Below `mpInternalIds.length` when a member's numbers were
     * already correct, since Convex skips a patch that changes nothing. */
    updated: v.number(),
    /** Members whose recomputed tally counts no ballot at all. Their row is
     * still written — a zeroed row is what `purgeSeedData` and the leaderboard
     * both expect to find rather than a missing one — but the count is worth
     * reporting: a whole slice of zeroes on a populated period means the flags
     * have not been computed yet. */
    empty: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.mpInternalIds.length > TALLY_SLICE) {
      throw new Error(
        `recomputeDissentTallies: ${args.mpInternalIds.length} members exceeds the ` +
          `${TALLY_SLICE} one transaction will roll up. Slice the list.`,
      )
    }

    const now = Date.now()
    let updated = 0
    let empty = 0

    for (const mpInternalId of args.mpInternalIds) {
      const records = await ctx.db
        .query("voteRecords")
        .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
          q.eq("mpInternalId", mpInternalId).eq("wahlperiode", args.wahlperiode),
        )
        .collect()

      let dissents = 0
      let ballotsCast = 0
      for (const record of records) {
        // An unset flag is "not yet computed" and contributes nothing — the same
        // distinction the schema draws. It is not a loyal vote.
        if (record.dissentCounted === true) ballotsCast++
        if (record.dissent === true) dissents++
      }
      if (ballotsCast === 0 && dissents === 0) empty++

      const existing = await ctx.db
        .query("dissentTallies")
        .withIndex("by_mpInternalId_and_wahlperiode", (q) =>
          q.eq("mpInternalId", mpInternalId).eq("wahlperiode", args.wahlperiode),
        )
        .unique()

      await upsertRow(
        ctx,
        "dissentTallies",
        existing,
        {
          mpInternalId,
          wahlperiode: args.wahlperiode,
          dissents,
          ballotsCast,
          // Stored rather than derived on read so the leaderboard can order 630
          // rows without 630 divisions. 0 when nothing was cast — ambiguous with
          // "never dissented", which is why lib/dissent.ts reads `ballotsCast`
          // and returns null for that case rather than trusting this field.
          dissentRate: ballotsCast === 0 ? 0 : dissents / ballotsCast,
        },
        now,
        { touchUpdatedAt: true },
      )
      updated++
    }

    return { updated, empty }
  },
})

/**
 * Computes the flags and tallies for ballots that predate them — one slice per
 * call, oldest ballot first, then the members.
 *
 * The migration half of this feature, in the same shape as `backfillSearchText`
 * in convex/search.ts and for the same reason: the flags are `v.optional` because
 * they were added to a populated table, and until this has run those ballots are
 * *missing* from the tally rather than counted as loyal votes. A required field
 * would have failed the deploy outright.
 *
 * A route rather than a cron (`POST /api/pipeline/votes/backfill-dissent`), and
 * a slice rather than a sweep, because one ballot's refresh is already a
 * chamber-sized read. Loop on `cursor` until `done`.
 *
 * ## Two phases behind one cursor
 *
 * The cursor walks the period's ballots and then keeps going, over the roster:
 * `cursor < ballots` refreshes flags, `cursor >= ballots` rolls those flags up
 * into member tallies. One monotonically increasing integer, one `done`, so the
 * caller's loop is unchanged — `ConvexLoader.backfill_dissent` reads exactly
 * `records`, `nextCursor` and `done`, and it does `int(next_cursor)`, so the
 * cursor stays a number by contract and not by accident.
 *
 * The phases are ordered and not interleaved because a tally derived mid-refresh
 * would count a member's flags before all their ballots carried any — an
 * undercount that looks like a finding. Rolling up only after every ballot in
 * the period is flagged means each member is derived once, from a complete set,
 * instead of once per ballot they voted in.
 *
 * ## Cost, and why it no longer accumulates
 *
 * ⚠ `ctx.runMutation` from a mutation runs in the **same transaction** (verified
 * against convex 1.42.3's own types: "the mutation runs in a sub-transaction").
 * So the previous form's three nested `refreshBallotDissent` calls summed into
 * one transaction's budget — ~1 900 documents each, plus a fresh `.collect()` of
 * every sheet in the period on *every* slice merely to compute `sheets.length`.
 *
 * Both are gone. The sheets are read with `.take()` bounded by the slice, the
 * period's ballot count comes from a bounded count rather than a full collect,
 * and each ballot is refreshed in its **own scheduled transaction** rather than
 * nested into this one. This mutation now reads a slice's worth and schedules;
 * it is cheap regardless of `batchSize`.
 *
 * Safe to re-run and safe to run against a fully-populated deployment: flags are
 * derived from records and tallies from flags, so a second pass writes nothing
 * and arrives at the same numbers. That is also what makes it the repair for a
 * tally that has drifted — including one left behind by the delta implementation
 * this replaces.
 *
 * ⚠ It cannot repair a tally row whose *records* were deleted — the derived count
 * is then correctly zero, but a member with no records at all is never named by
 * phase 2's roster walk. `purgeSeedData` is the one thing that deletes vote
 * records, and it deletes the tally row alongside them.
 */
const BALLOT_BACKFILL_BATCH = 3

/**
 * Ceiling on a period's ballots for cursor arithmetic.
 *
 * §4.4 puts named ballots at ~1 015 in the Bundestag's *entire history*, of which
 * 391 carry a machine-readable sheet — so one period is a few hundred. This
 * bounds the `.take()` that counts them without collecting the table, and a
 * period that somehow exceeded it would be walked correctly up to this many
 * ballots rather than silently truncated: `done` is decided by the roster phase,
 * which always runs.
 */
const MAX_PERIOD_BALLOTS = 2_000

export const backfillDissent = internalMutation({
  args: {
    wahlperiode: v.number(),
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    /** Ballots whose refresh this slice scheduled. Zero during phase 2. */
    ballots: v.number(),
    /**
     * Records re-flagged. **Now always 0**, and deliberately so: the refreshes
     * run in their own transactions, so this mutation cannot know how many rows
     * they changed without waiting for them — which would put them back in this
     * transaction and undo the fix.
     *
     * Kept in the shape because `ConvexLoader.backfill_dissent` sums it and the
     * sync turns the sum into a stage note ("N vote records re-flagged" vs
     * "already current"). That note now always reads as "already current", which
     * is a less informative report and not a wrong one; `mpsRolledUp` below is
     * the signal that replaced it, and the report's verification queries measure
     * the outcome directly rather than trusting a counter.
     */
    records: v.number(),
    /** Members whose tally this slice recomputed. Zero during phase 1. */
    mpsRolledUp: v.number(),
    nextCursor: v.union(v.null(), v.number()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(10, Math.floor(args.batchSize ?? BALLOT_BACKFILL_BATCH)))
    const cursor = Math.max(0, Math.floor(args.cursor ?? 0))

    // Ascending by date, so the cursor is stable while a sync appends newer
    // ballots underneath a run in progress — the failure a descending order
    // would produce is a ballot skipped entirely, which reads as a member who
    // never dissented rather than as an unfinished migration.
    //
    // `.take()` rather than `.collect()`: the previous form re-read every sheet
    // in the period on every slice, and used all of them for one `.length`.
    const sheets = await ctx.db
      .query("voteSheets")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .take(Math.min(MAX_PERIOD_BALLOTS, cursor + batchSize + 1))

    // --- phase 1: the ballots ---------------------------------------------
    if (cursor < sheets.length) {
      const slice = sheets.slice(cursor, cursor + batchSize)
      for (const sheet of slice) {
        // Scheduled, not `runMutation`: nesting would run each refresh inside
        // *this* transaction and sum their read budgets, which is what made a
        // batch of three ~3 900 documents. `cascade: false` because phase 2
        // rolls every member up once, rather than once per ballot they voted in.
        await ctx.scheduler.runAfter(0, internal.votes.refreshBallotDissent, {
          voteSheetId: sheet._id,
          cascade: false,
        })
      }
      const nextCursor = cursor + slice.length
      return {
        ballots: slice.length,
        records: 0,
        mpsRolledUp: 0,
        nextCursor,
        // Never done in phase 1: the roster walk still has to run, even for a
        // period with no ballots at all — a member whose records were deleted
        // needs their tally zeroed.
        done: false,
      }
    }

    // --- phase 2: the members ----------------------------------------------
    //
    // The roster is walked by the same integer cursor, offset past the ballots.
    // `mps` is the source rather than `dissentTallies`, because a member with no
    // tally row yet is exactly who this exists to create one for.
    const offset = cursor - sheets.length
    const size = Math.min(TALLY_SLICE, batchSize * TALLY_SLICE)
    const window = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .take(offset + size + 1)

    const slice = window.slice(offset, offset + size)
    if (slice.length > 0) {
      // Scheduled for the same reason as phase 1, and one call per slice: the
      // roll-up's write set is the members it names, so this is where the
      // partitioning is actually established. See `dissentWriteKeys`.
      await ctx.scheduler.runAfter(0, internal.votes.recomputeDissentTallies, {
        wahlperiode: args.wahlperiode,
        mpInternalIds: slice.map((mp) => mp.internalId),
      })
    }

    const hasMore = window.length > offset + size
    return {
      ballots: 0,
      records: 0,
      mpsRolledUp: slice.length,
      nextCursor: hasMore ? cursor + slice.length : null,
      done: !hasMore,
    }
  },
})

/**
 * One member's period-wide dissent, or null where none has been computed.
 *
 * Null rather than a zeroed row, and the whole surface depends on the
 * difference: a member the backfill has not reached and a member who has never
 * voted against their group are opposite claims, and only one of them is a
 * finding. The profile panel renders the first as "not computed" and the second
 * as a figure. See `dissentRate` in lib/dissent.ts, which draws the same line for
 * a member who has cast no votes.
 *
 * Two indexed reads: the tally row, and the period's ballot count for context —
 * "3 of 412 ballots" is a different statement from "3 of 20", and the number the
 * page could previously print was the second one.
 */
export const getDissentTally = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      dissents: v.number(),
      ballotsCast: v.number(),
      dissentRate: v.number(),
      /** Named ballots in the period, whether or not this member voted in them.
       * Context for the denominator rather than part of it: `ballotsCast`
       * excludes absences and ballots where the group had no line. */
      ballotsInPeriod: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const tally = await ctx.db
      .query("dissentTallies")
      .withIndex("by_mpInternalId_and_wahlperiode", (q) =>
        q.eq("mpInternalId", args.mpInternalId).eq("wahlperiode", args.wahlperiode),
      )
      .unique()
    if (!tally) return null

    // Bounded by the corpus, not by a limit: §4.4 puts named ballots at ~1 015
    // in the Bundestag's entire history, so one period's sheets are a few
    // hundred rows. The same read `getVoteSheetsPage` makes for its pager.
    const sheets = await ctx.db
      .query("voteSheets")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    return {
      dissents: tally.dissents,
      ballotsCast: tally.ballotsCast,
      dissentRate: tally.dissentRate,
      ballotsInPeriod: sheets.length,
    }
  },
})

// --- the scope migration --------------------------------------------------

/**
 * Records per `backfillVoteRecordScope` call.
 *
 * Each row costs one read (from the index range) and one write, plus one sheet
 * fetch per *distinct* ballot in the slice — and a slice drawn from one ballot's
 * records shares that fetch. 500 matches `MAX_BATCH`, the ceiling the ingestion
 * mutations already chunk to, and sits an order of magnitude inside the 16 000
 * documents one transaction may write.
 */
const SCOPE_BACKFILL_BATCH = 500

/**
 * Copies each record's ballot period and date onto the record — the migration
 * for `voteRecordScopeFields`.
 *
 * ## Why this needs no cursor
 *
 * The un-migrated rows are exactly those with no `wahlperiode`, and Convex
 * orders a missing field **below every value** (`values/compare.ts` ranks
 * `undefined` at 0, beneath `null`). So they occupy a contiguous prefix of
 * `by_wahlperiode_and_date` — and `.eq("wahlperiode", undefined)` selects them
 * and nothing else. Verified against a real Convex backend: on a table of 200
 * migrated and 50 un-migrated rows, the range returned exactly 50 and the
 * `.eq("wahlperiode", 21)` range returned only migrated ones.
 *
 * Each call therefore takes the next un-migrated slice and migrates it, and the
 * rows it writes leave the range by construction. A caller loops until `done`
 * without tracking where it got to, and a crashed run resumes by being run
 * again — there is no cursor to lose. That is stronger than
 * `backfillSearchText`'s offset walk and is available here only because the
 * migrated flag is an *indexed* column rather than a payload field.
 *
 * That index leads with `wahlperiode` rather than with the member for a reason
 * an index range makes unavoidable: its fields must be fixed in order, so
 * selecting on `wahlperiode` through the MP-keyed index would mean naming a
 * member first — one query per member instead of one for the table.
 *
 * ## Idempotent, and safe to run beside live traffic
 *
 * A migrated row is skipped by the range, so a second pass writes nothing and
 * reports `done` immediately. A record ingested while this runs is written with
 * its scope already set (`upsertVoteRecords`), so the two cannot race to leave a
 * row behind. Nothing else about the row is touched: the vote, the flags and the
 * group are read-only here.
 */
export const backfillVoteRecordScope = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  returns: v.object({
    /** Rows migrated by this call. */
    migrated: v.number(),
    /** Distinct ballots fetched to do it — the cost this call actually paid
     * beyond the rows themselves. */
    sheetsRead: v.number(),
    /** Records whose ballot no longer exists. Left un-migrated deliberately:
     * there is nothing to copy, and a row invented from nothing would claim a
     * period the record cannot support. Non-zero means `purgeSeedData` or a
     * manual deletion removed a sheet without its records. */
    orphaned: v.number(),
    /** False while un-migrated rows remain. Loop until true. */
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.max(
      1,
      Math.min(SCOPE_BACKFILL_BATCH, Math.floor(args.batchSize ?? SCOPE_BACKFILL_BATCH)),
    )

    // One past the slice, so `done` is answered without a second query.
    const pending = await ctx.db
      .query("voteRecords")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", undefined))
      .take(batchSize + 1)

    const slice = pending.slice(0, batchSize)
    // One fetch per distinct ballot rather than per record. Convex charges every
    // `db.get` separately — there is no per-transaction document cache, measured
    // — so this Map is a real saving, not a stylistic one: a ballot's 630 records
    // become one sheet read instead of 630.
    const sheets = new Map<Id<"voteSheets">, Doc<"voteSheets"> | null>()
    let migrated = 0
    let orphaned = 0

    for (const record of slice) {
      let sheet = sheets.get(record.voteSheetId)
      if (sheet === undefined) {
        sheet = await ctx.db.get(record.voteSheetId)
        sheets.set(record.voteSheetId, sheet)
      }
      if (!sheet) {
        orphaned++
        continue
      }
      await ctx.db.patch(record._id, { wahlperiode: sheet.wahlperiode, date: sheet.date })
      migrated++
    }

    return {
      migrated,
      sheetsRead: sheets.size,
      orphaned,
      // Orphans stay in the range forever, so they must not keep `done` false —
      // a loop on this would never terminate. Progress is what decides: a slice
      // that migrated nothing has nothing left it can migrate.
      done: pending.length <= batchSize || migrated === 0,
    }
  },
})

/**
 * How far the scope migration has got — the read-only post-deploy check.
 *
 * `remaining` is capped rather than counted exactly: a count of a whole table is
 * the shape of read this branch exists to remove, and the question ("is any row
 * still un-migrated?") is answered by the first one found. A returned
 * `remaining` equal to `ceiling` means "at least this many", which
 * `atLeastCeiling` states rather than leaving to the caller to infer.
 *
 * **Operator surface**, reached over `POST /api/pipeline/coverage/vote-scope`
 * with the bearer key — see convex/http.ts and `scripts/verify-coverage.py`
 * for how it is called. Now an `internalQuery` (was a public `query`): the
 * only intended caller was an operator running a post-deploy check, so it
 * belongs behind the same bearer gate the ingest routes carry rather than on
 * the public surface where anyone who guessed the path could poll it.
 */
export const voteScopeCoverage = internalQuery({
  args: { ceiling: v.optional(v.number()) },
  returns: v.object({
    remaining: v.number(),
    atLeastCeiling: v.boolean(),
    /** True when every record carries its ballot's period. The period-scoped
     * reads are complete only from this point; before it they undercount. */
    complete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ceiling = pageLimit(args.ceiling, 500)
    const pending = await ctx.db
      .query("voteRecords")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", undefined))
      .take(ceiling)
    return {
      remaining: pending.length,
      atLeastCeiling: pending.length >= ceiling,
      complete: pending.length === 0,
    }
  },
})

// --- the Vorgang backfill (L3) --------------------------------------------

/** One ballot's natural-key + tally, the shape the read/write halves of the
 * L3 backfill exchange. Exported so `decideVorgangPage` and its tests can key
 * on the same type as the mutation. */
export type VorgangPageRow = {
  sitzungnr: number
  abstimmnr: number
  yesCount: number
  noCount: number
  abstainCount: number
  dipVorgangId?: string | null
}

/** The `{sitzungnr, abstimmnr}` cursor the L3 read pages with. */
export type VorgangPageCursor = { sitzungnr: number; abstimmnr: number }

/**
 * Decide what one page of `voteSheetsMissingVorgang` returns, from the raw
 * indexed scan and the cursor. Pure, so the cursor arithmetic that carries
 * the whole safety of the L3 backfill is testable without a database.
 *
 * ## The two rules this holds
 *
 * 1. **No unresolved sheet is skipped.** The prior code used `.gt` at the
 *    sitting level (NEW-H2 in `/tmp/rereview-source-backed-ingestion-gaps.md`),
 *    which lost the tail of any sitting straddling a page boundary. The
 *    fixed handler uses `.gte`, and this function filters out rows *at or
 *    before* the cursor with `row.abstimmnr > cursor.abstimmnr` when the
 *    sitting matches. So `(90,1)/(90,2)/(90,3)` at `limit=1` walks all
 *    three across three pages.
 *
 * 2. **The cursor advances only from safe progress**, never from a resolved
 *    row (NEW-M3). Two safe positions:
 *      - The last **returned** filtered row — everything strictly after it
 *        (per index order) is either unreturned-filtered or resolved, and
 *        `.gte + filter` handles both.
 *      - The last **raw** row we scanned, when the scan is filled but we
 *        did not have enough filtered rows to fill the page. Advancing to
 *        it moves the cursor strictly forward — the handler guarantees the
 *        raw scan is large enough that this last raw row is strictly past
 *        the incoming cursor (see `VORGANG_MIN_FETCH_SIZE`), so the next
 *        call cannot re-fetch the same window and loop.
 *
 *    The prior code took `rows[limit]` — the (limit+1)-th raw row — which
 *    could be a resolved sheet whose position, once used as a cursor,
 *    silently skipped any unresolved sheet in the same sitting between the
 *    returned tail and it. Never allowed here.
 *
 * ## Over-fetch factor and minimum fetch size
 *
 * The fetch takes `max(limit * OVER_FETCH_FACTOR, MIN_FETCH_SIZE) + 1` raw
 * rows so the client filter has room to drop resolved sheets without needing
 * a handler-side loop. Real sittings carry at most a handful of named
 * ballots (typically 2–8, hard-ceilinged well below `MIN_FETCH_SIZE`), so
 * the fetch is guaranteed to span at least one sitting boundary — which is
 * what makes "advance to last raw row" safe: the cursor always moves past
 * the previous cursor's sitting.
 *
 * The `+1` is the "there is more" probe. `fetchExhausted` is set when the
 * scan filled its ceiling — the sole signal that unreturned rows may exist
 * past what we saw.
 */
export const VORGANG_PAGE_OVER_FETCH = 4

/** Floor for the raw scan size, regardless of `limit`. Guarantees the scan
 * always spans past the largest possible sitting so `advance to last raw
 * row` cannot leave the cursor pinned inside a sitting the caller already
 * exhausted. Sittings hold at most a handful of named ballots (§4.4, and
 * the 8‑named‑votes protocol 21/90 is the busiest sampled), so 64 is two
 * orders of magnitude above the real maximum and still trivial to read. */
export const VORGANG_MIN_FETCH_SIZE = 64

export function vorgangPageFetchSize(limit: number): number {
  return Math.max(limit * VORGANG_PAGE_OVER_FETCH, VORGANG_MIN_FETCH_SIZE) + 1
}

export function decideVorgangPage(
  rows: VorgangPageRow[],
  cursor: VorgangPageCursor | undefined,
  limit: number,
  fetchExhausted: boolean,
): { sheets: VorgangPageRow[]; nextCursor: VorgangPageCursor | null; done: boolean } {
  const startingSitting = cursor?.sitzungnr
  const startingAbstimm = cursor?.abstimmnr
  const filtered = rows.filter((row) => {
    if (row.dipVorgangId != null) return false
    if (startingSitting !== undefined && row.sitzungnr === startingSitting) {
      // Strictly past the cursor within the boundary sitting; everything
      // else in later sittings passes unconditionally.
      return row.abstimmnr > (startingAbstimm ?? -1)
    }
    return true
  })

  const page = filtered.slice(0, limit)

  if (filtered.length > limit) {
    // More unreturned filtered rows sit in this fetch. Cursor from the last
    // returned filtered row so the next call re-fetches past it and drops
    // (via the sitting-boundary filter) the exact rows we just returned.
    const last = page[page.length - 1]
    return {
      sheets: page,
      nextCursor: { sitzungnr: last.sitzungnr, abstimmnr: last.abstimmnr },
      done: false,
    }
  }

  if (fetchExhausted && rows.length > 0) {
    // The scan hit its ceiling. Because `vorgangPageFetchSize` is
    // guaranteed to exceed the biggest sitting, `rows[last]` is strictly
    // past the incoming cursor — either in a later sitting, or in the same
    // sitting at a strictly higher abstimmnr. Advancing to it makes
    // progress; it also cannot skip an unresolved sheet, because
    // everything between the last returned filtered row and `rows[last]`
    // was scanned and filtered out (resolved) in this pass.
    const last = rows[rows.length - 1]
    return {
      sheets: page,
      nextCursor: { sitzungnr: last.sitzungnr, abstimmnr: last.abstimmnr },
      done: false,
    }
  }

  // Fetch drained: no more rows in the period.
  return { sheets: page, nextCursor: null, done: true }
}

/**
 * Sheets in one period that still have no resolved procedure.
 *
 * The read half of the `voteSheets.dipVorgangId` backfill (L3 in the
 * independent review). A ballot ingested *before* its referring
 * `Vorgangsposition` surfaced in the referrals window lands with
 * `dipVorgangId` absent, is added to `state.ingested_ballot_keys`, and an
 * incremental `sync` never revisits it — the sheet is not re-posted and the
 * ballot page shows no §31 section even when declarations exist. This query
 * lets the pipeline patch those late arrivals without a full `--full`
 * backfill (which is separately unsafe on a populated table when the
 * referrals stage errors — see M2).
 *
 * Returns just the fields the pipeline needs to join back to
 * `_ballot_vorgaenge`: the sitting and tally form the key, and
 * `(sitzungnr, abstimmnr)` is what the caller sends back on the patch.
 *
 * Bounded read: one period has at most a few thousand voteSheets and the
 * caller pages by `(sitzungnr, abstimmnr)` cursor so a growing table cannot
 * force this over the read cap.
 *
 * ⚠ **Uses `.gte` on the sitting field, not `.gt`** — the boundary sitting's
 * tail must stay in the scan so `decideVorgangPage`'s filter can walk it.
 * The prior `.gt` lost every mid-sitting page boundary silently (NEW-H2).
 */
/** The `voteSheetsMissingVorgang` handler body, extracted so tests can call
 * it with a fake `ctx` without going through the internalQuery wrapper —
 * which prints a "Convex functions should not directly call other Convex
 * functions" warning at test time even when the wrapping is what we want to
 * exercise. Convex's own docs recommend exactly this pattern for shared
 * logic; here the "shared" second caller is the test file. */
export async function voteSheetsMissingVorgangHandler(
  ctx: QueryCtx,
  args: { wahlperiode: number; cursor?: VorgangPageCursor; limit?: number },
): Promise<{
  sheets: VorgangPageRow[]
  nextCursor: VorgangPageCursor | null
  done: boolean
}> {
  const limit = pageLimit(args.limit, 200)
  const fetchSize = vorgangPageFetchSize(limit)

  const rows = await ctx.db
    .query("voteSheets")
    .withIndex("by_wahlperiode_and_sitzungnr_and_abstimmnr", (chain) => {
      const base = chain.eq("wahlperiode", args.wahlperiode)
      if (!args.cursor) return base
      // .gte, not .gt — the cursor's own sitting must stay in the scan so
      // its tail is walked. `decideVorgangPage`'s filter drops the exact
      // cursor row and any earlier row in the same sitting.
      return base.gte("sitzungnr", args.cursor.sitzungnr)
    })
    .take(fetchSize)

  const decision = decideVorgangPage(rows, args.cursor, limit, rows.length >= fetchSize)
  return {
    sheets: decision.sheets.map((row) => ({
      sitzungnr: row.sitzungnr,
      abstimmnr: row.abstimmnr,
      yesCount: row.yesCount,
      noCount: row.noCount,
      abstainCount: row.abstainCount,
    })),
    nextCursor: decision.nextCursor,
    done: decision.done,
  }
}

export const voteSheetsMissingVorgang = internalQuery({
  args: {
    wahlperiode: v.number(),
    /** Return sheets whose `(sitzungnr, abstimmnr)` sorts strictly after this
     * cursor. Absent means "from the beginning". */
    cursor: v.optional(v.object({ sitzungnr: v.number(), abstimmnr: v.number() })),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    sheets: v.array(
      v.object({
        sitzungnr: v.number(),
        abstimmnr: v.number(),
        yesCount: v.number(),
        noCount: v.number(),
        abstainCount: v.number(),
      }),
    ),
    /** The last returned sheet's key, or null when `done`. Never a resolved
     * row's key — see `decideVorgangPage` for why. */
    nextCursor: v.union(v.null(), v.object({ sitzungnr: v.number(), abstimmnr: v.number() })),
    done: v.boolean(),
  }),
  handler: voteSheetsMissingVorgangHandler,
})

/**
 * Patch late `dipVorgangId` links onto already-ingested ballots.
 *
 * The write half of the L3 backfill: takes a batch of `(sitzungnr, abstimmnr)
 * → dipVorgangId` and patches each row whose current value differs. **Never
 * writes null**, so a patch that fails to name a Vorgang is a no-op rather
 * than an erasure — the same invariant `vote_sheet_payload` holds (M2).
 *
 * Idempotent: a row already carrying the same value is skipped, so a
 * re-run reports `patched: 0` and reads only the sheets in the batch. A row
 * whose stored value *differs* is left alone and reported as `conflicts` —
 * a caller cannot silently reassign a ballot's procedure through this route
 * (that would require a deliberate migration).
 *
 * Scoped by `wahlperiode` because the natural key is only unique within a
 * period, and taking a shortcut would let a WP20 sitting number clash with
 * WP21's.
 */

/** What the L3 mutation should do with one patch, given the row it found
 * (if any). Extracted from the mutation so idempotency / conflict-refusal /
 * unknown are testable without a database — the four transitions are the
 * whole semantic surface of the write, and a regression that reintroduces
 * `patched` for a differing value or `unchanged` for a null wants a
 * failing test even in the pure layer. */
export type VorgangPatchOutcome = "patched" | "unchanged" | "conflict" | "unknown"

export function classifyVorgangPatch(
  existing: { dipVorgangId?: string | null } | null,
  incoming: string,
): VorgangPatchOutcome {
  if (existing === null) return "unknown"
  if (existing.dipVorgangId == null) return "patched"
  if (existing.dipVorgangId === incoming) return "unchanged"
  return "conflict"
}

/** The `backfillVoteSheetVorgang` handler body, extracted so tests can call
 * it with a fake `MutationCtx` without going through the internalMutation
 * wrapper — Convex prints a "should not directly call other Convex
 * functions" warning at test time otherwise. Convex's own docs recommend
 * this pattern for shared logic; here the "shared" second caller is the
 * test file, and lifting the handler out keeps the wrapper-level assertions
 * (arg validator, return validator) untouched. */
export async function backfillVoteSheetVorgangHandler(
  ctx: MutationCtx,
  args: {
    wahlperiode: number
    patches: { sitzungnr: number; abstimmnr: number; dipVorgangId: string }[]
  },
): Promise<{ patched: number; unchanged: number; conflicts: number; unknown: number }> {
  assertBatchSize(args.patches.length, "vote-sheet vorgang patches")
  const counters = { patched: 0, unchanged: 0, conflict: 0, unknown: 0 }
  for (const patch of args.patches) {
    const sheet = await findSheet(ctx, args.wahlperiode, patch.sitzungnr, patch.abstimmnr)
    const outcome = classifyVorgangPatch(sheet, patch.dipVorgangId)
    if (outcome === "patched") {
      // Non-null asserted because `outcome === "patched"` implies
      // `sheet !== null` — the classification's own contract. TS cannot
      // see through the branch, so the assertion is what states the
      // implication back to it.
      await ctx.db.patch(sheet!._id, { dipVorgangId: patch.dipVorgangId })
    }
    counters[outcome]++
  }
  return {
    patched: counters.patched,
    unchanged: counters.unchanged,
    conflicts: counters.conflict,
    unknown: counters.unknown,
  }
}

export const backfillVoteSheetVorgang = internalMutation({
  args: {
    wahlperiode: v.number(),
    patches: v.array(
      v.object({
        sitzungnr: v.number(),
        abstimmnr: v.number(),
        dipVorgangId: v.string(),
      }),
    ),
  },
  returns: v.object({
    /** Rows whose `dipVorgangId` was set for the first time by this call. */
    patched: v.number(),
    /** Rows already carrying the same value — the idempotent no-op path. */
    unchanged: v.number(),
    /** Rows carrying a *different* value than the patch proposes. Left alone
     * on purpose: a re-attributing write is a migration and needs to be
     * explicit. Non-zero here is the signal an operator should act on. */
    conflicts: v.number(),
    /** Rows the patch named but this period does not have — either a sitting
     * number that never existed or a ballot that was purged. */
    unknown: v.number(),
  }),
  handler: backfillVoteSheetVorgangHandler,
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
  const ballots = await ballotDates(ctx, mpInternalId, wahlperiode, from, to)

  let cast = 0
  let eligible = 0
  for (const ballot of ballots) {
    eligible++
    if (ballot.cast) cast++
  }
  return { rate: eligible === 0 ? null : cast / eligible, cast, eligible }
}

/**
 * One MP's ballots in a window, as (date, cast) pairs.
 *
 * The read `voteParticipation` does, without the aggregation — so a caller
 * covering several sub-windows of one period reads the period once and counts
 * each window in memory. See `gatherPeriod` in convex/activityScores.ts.
 *
 * `cast` is decided here rather than at the caller because it is the one
 * judgement in this read and §4.1 is emphatic about it: an abstention is a vote
 * — the MP was present and chose — and only `absent` (`nichtabgegeben`) counts
 * against the rate. Returning the raw position would let a second caller
 * collapse the two and flatter everyone who stayed away.
 *
 * ⚠ A record the scope backfill has not reached is absent from this range
 * entirely, not mis-dated — see `periodVoteRecords`.
 */
export async function ballotDates(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<Array<{ date: string; cast: boolean }>> {
  const records = await periodVoteRecords(ctx, mpInternalId, wahlperiode, from, to)
  return records.map((record) => ({
    // Non-null by the index range: `date` is a bound of the query that returned
    // this row, so a row with no date cannot be in it. The fallback keeps the
    // type total without inventing a date — an empty string sorts below every
    // real one and so falls outside every window a caller narrows to.
    date: record.date ?? "",
    cast: record.vote !== "absent",
  }))
}

/**
 * One MP's vote records inside one period and date window — **one index range,
 * no document fetches**.
 *
 * ## The read this replaces, and what it cost
 *
 * Every per-MP vote read used to be `by_mpInternalId` — an index with no period
 * column — followed by `ctx.db.get(record.voteSheetId)` per row to discover
 * which Bundestag and which month the vote belonged to. Two compounding faults:
 *
 *  - `internalId` is stable across periods by construction (convex/schema.ts),
 *    so the scan returned the member's **whole career**. Three periods are live,
 *    and one member's records across them are ~391 rows to answer a question
 *    about the 68 in WP21.
 *  - The `db.get` doubled it. Convex charges every `get` separately — there is
 *    no per-transaction document cache (measured against a real backend:
 *    `documentsRead` 0→1→2→3 for three gets of the same id) — so the sheets
 *    read almost exactly matched the records read.
 *
 * The deployment measured both, and the numbers are in `recomputeScores`'
 * header: 10 270 `voteRecords` beside 10 245 `voteSheets`, together 64 % of the
 * transaction that exceeded the read limit. The 1:1 ratio *is* the N+1.
 *
 * Now `by_mpInternalId_and_wahlperiode_and_date` carries all three columns, so
 * the window is the range and the sheet is never touched. Measured on a 250-row
 * fixture against a real Convex backend: **500 documents read → 100.**
 *
 * ## ⚠ Un-migrated rows are absent, not mis-attributed
 *
 * A record written before `voteRecordScopeFields` existed has no `wahlperiode`,
 * and Convex sorts a missing field *below every value* — so it falls outside
 * `.eq("wahlperiode", N)` rather than inside the wrong period. Until
 * `backfillVoteRecordScope` has run, participation is computed over the migrated
 * records only: an undercount that repairs itself, rather than a vote counted
 * against the wrong Bundestag. `voteScopeCoverage` reports what remains.
 */
async function periodVoteRecords(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
  from: string,
  to: string,
): Promise<Doc<"voteRecords">[]> {
  return await ctx.db
    .query("voteRecords")
    .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
      q
        .eq("mpInternalId", mpInternalId)
        .eq("wahlperiode", wahlperiode)
        .gte("date", from)
        .lte("date", to),
    )
    .collect()
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
 * The scoping rule is `voteParticipation`'s, and both now read the same index:
 * `periodVoteRecords` bounds the range by period and date, so neither fetches a
 * sheet. That is the fix its header describes — the record used to carry neither
 * column, which is why the ballot had to be fetched to learn when it happened.
 *
 * Absences are tallied, not dropped. §4.1's sheets encode `nichtabgegeben` as
 * its own column and convex/schema.ts keeps it distinct from `Enthaltung`, so a
 * month an MP missed entirely must render as a bar of absences rather than as a
 * month with no ballots — those are opposite claims about the same MP.
 *
 * ⚠ Bounded by the period rather than by a limit, and safe for the reason §4.4
 * gives: named ballots are roughly 1 015 in the Bundestag's *entire history* and
 * 391 carry a machine-readable sheet, so one MP's records in one period are a few
 * hundred documents — with no sheet fetch beside them any more. That bound is a
 * property of the corpus rather than of this query, which is why it is stated
 * here: it does not hold for any other table, and `getCrossPartyRankings` in
 * convex/rankings.ts bounds itself explicitly because it reads *every* MP's
 * records rather than one's.
 */
export async function voteTallyByMonth(
  ctx: QueryCtx,
  mpInternalId: string,
  wahlperiode: number,
): Promise<Map<string, Record<Vote, number>>> {
  // The whole period: `PERIOD_WINDOW` is the same pair `monthWindow(null)`
  // returns, stated here rather than imported to keep convex/votes.ts free of a
  // dependency on the scoring module that calls it.
  const records = await periodVoteRecords(
    ctx,
    mpInternalId,
    wahlperiode,
    "1949-01-01",
    "2999-12-31",
  )

  const byMonth = new Map<string, Record<Vote, number>>()
  for (const record of records) {
    // Dates are ISO `YYYY-MM-DD` (schema header), so the month is a slice rather
    // than a parse — and the slice is already the zero-padded `YYYY-MM` that
    // `activityScores.month` is keyed on, so the two line up without conversion.
    // Read off the record now that it carries the ballot's date; an un-migrated
    // row is outside the index range above and never reaches here.
    const month = (record.date ?? "").slice(0, 7)
    if (month === "") continue
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
//
// A natural-key single-ballot form used to live here (`getVoteSheet`), keyed
// on `(wahlperiode, sitzungnr, abstimmnr)`. `/votes/[id]` uses `getVoteSheetById`
// (Convex id) and no other caller ever materialised. Removed; `findSheet`
// below is still the shared lookup helper for the ballots page and the
// backfill route, so a future natural-key caller would go through it.

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
 * The two stored flags for one record — `isRebel`, plus the denominator it is
 * read against.
 *
 * `counted` is deliberately **not** `!dissent`, and that is the whole reason
 * this is a function rather than two expressions at the call site. Three
 * different situations all produce `dissent: false`:
 *
 *  - The MP voted their group's line. In the denominator.
 *  - The MP was absent. `nichtabgegeben` is not a position (§4.1), so there was
 *    no opportunity to dissent — **not** in the denominator.
 *  - The MP's group had no line: an exact split, a group nobody voted in, or no
 *    group on the record at all. Nothing to break — **not** in the denominator.
 *
 * Folding the last two into the denominator is the plausible mistake, and it is
 * invisible: it inflates every MP's `ballotsCast` by the ballots they missed,
 * which deflates every rate on the site by a third or so without any number
 * looking wrong. `dissentRate` in lib/dissent.ts and the badge threshold both
 * read that denominator.
 *
 * Exported and pure for convex/votes.test.ts — the rule is what needs testing,
 * and the mutation that applies it needs a database.
 */
export function dissentFlagsFor(
  vote: Vote,
  majority: { vote: Vote; share: number } | null,
): { dissent: boolean; counted: boolean } {
  return {
    dissent: isRebel(vote, majority),
    counted: vote !== "absent" && majority !== null,
  }
}

/**
 * How many ballots a deployment must hold before `getVoteSheetById` will
 * describe an id it cannot find as "no such division".
 *
 * A number rather than a boolean because the failure this guards against is not
 * an *empty* deployment but a *wrong* one, and the wrong ones are not empty:
 * the sibling this build has been pointed at holds six `(Testdaten)` sheets.
 * Twenty sits far above any fixture and far below a real period — production
 * carries 69 ballots for WP21 and 185 for WP20 — so the guard fires on a test
 * deployment and never on a real one, including early in a period when the
 * corpus is still small.
 */
const MIN_REAL_CORPUS = 20

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
    if (!sheet) {
      // "No such ballot" and "you are asking the wrong backend" are different
      // failures wearing the same `null`, and the route turns that null into
      // "Diese Abstimmung existiert nicht" — a factual claim about the
      // parliamentary record. Against a deployment that does not hold the
      // corpus, that claim is false for *every* id, and nothing looks broken:
      // the shell renders, the nav renders, nothing is logged.
      //
      // ⚠ The check is "does this deployment hold the corpus", not "is the table
      // empty". The sibling deployment this has actually been pointed at is not
      // empty — it carries six `Namentliche Abstimmung N (Testdaten)` sheets
      // with an electorate of 125 — so an emptiness test would pass there and
      // the lie would go on being told. A real period has hundreds of divisions
      // against a chamber of 600+; `MIN_REAL_CORPUS` is set well below that and
      // well above any fixture.
      //
      // A throw rather than a second return shape: this is a misconfiguration,
      // not a state the UI should learn to render. It surfaces as the error
      // boundary, which is what a wrong backend deserves, and leaves
      // `notFound()` for the case it actually describes. One indexed read.
      const corpus = await ctx.db.query("voteSheets").withIndex("by_date").take(MIN_REAL_CORPUS)
      if (corpus.length < MIN_REAL_CORPUS) {
        throw new Error(
          `voteSheets holds ${corpus.length} ballots, fewer than the ${MIN_REAL_CORPUS} a real ` +
            "corpus has — this deployment does not carry the Bundestag record, so no vote id " +
            "can resolve. Refusing to report a real division as nonexistent. Check " +
            "NEXT_PUBLIC_CONVEX_URL (see webapp/lib/convex-url.ts).",
        )
      }
      return null
    }

    // Bounded by the chamber: 630-odd rows for one ballot, well inside the
    // read limit, and a page of a ballot is not a useful thing to return.
    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
      .collect()

    // One `mpLabel` per record, resolved once and reused by the tally, the
    // rows and the breakdown — the join `voteRecordDoc` exists to avoid doing
    // 630 times in the client.
    const labels = new Map<string, Awaited<ReturnType<typeof mpLabel>>>()
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
        photoCredit: label?.photoCredit ?? null,
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

// A per-group tally form used to sit here (`getFraktionVoteBreakdown`).
// `getVoteSheetById` embeds the same table in its response through the same
// `tallyByGroup` helper, and no caller wanted the summary without the records
// beside it — so the isolated form was removed. `tallyByGroup` /
// `breakdownRows` are still the shared helpers the embed uses.

/**
 * A named set of ballots, looked up by natural key.
 *
 * ## Why the caller passes the keys
 *
 * The set this exists for — ballots on the Bundestag's own resources — is a
 * **curated editorial list**, and it lives in lib/own-resources-votes.ts where
 * each entry states its grounds and a reviewer can read the diff. Nothing about
 * that judgement belongs in the database: a `selfDealing` column would have to
 * survive every re-ingest, would record no reason, and would let the list be
 * changed without a diff. So this query knows how to *fetch* a set and nothing
 * about which ballots are in one.
 *
 * That also makes it reusable. Any future curated collection — confidence
 * votes, constitutional amendments — is this query with a different list, not a
 * second query with a second flag.
 *
 * ## The natural key, not the document id
 *
 * `(wahlperiode, sitzungnr, abstimmnr)` is what §4.1 says the sheet name
 * encodes, so a curated list keyed on it survives a re-ingest that rebuilds the
 * table and hands out new `_id`s. A list of ids would silently empty itself the
 * first time the corpus was reloaded — and an empty "votes on the Bundestag's
 * own resources" page is precisely the failure a reader would misread as a
 * finding.
 *
 * ## Missing is a real answer
 *
 * A requested key with no sheet is **omitted**, not returned as a null row. The
 * ballot may not be ingested yet, or the curated list may name one that does not
 * exist; either way the page shows the ballots it can prove and the count of
 * what it asked for is the caller's to compare. The alternative — throwing —
 * would let one stale curated entry take down the whole page.
 *
 * Bounded by the list: one indexed `.unique()` per key, and a curated
 * collection is a few dozen entries at most. `MAX_BALLOT_KEYS` is the guard
 * that keeps it that way rather than letting a caller turn this into a scan of
 * the corpus.
 */
export const MAX_BALLOT_KEYS = 60

export const getVoteSheetsByKey = query({
  args: {
    keys: v.array(
      v.object({
        wahlperiode: v.number(),
        sitzungnr: v.number(),
        abstimmnr: v.number(),
      }),
    ),
  },
  returns: v.array(voteSheetDoc),
  handler: async (ctx, args) => {
    if (args.keys.length > MAX_BALLOT_KEYS) {
      // Throwing rather than truncating, the same call `getVotesByMP` makes at
      // `MAX_GROUP_COMPARISONS` and for the same reason: a silently shortened
      // collection is indistinguishable from a collection with fewer ballots
      // in it, which is the one thing a curated list must never look like.
      throw new Error(
        `getVoteSheetsByKey: ${args.keys.length} keys exceeds the ${MAX_BALLOT_KEYS} this query will read`,
      )
    }

    const sheets = []
    for (const key of args.keys) {
      const sheet = await findSheet(ctx, key.wahlperiode, key.sitzungnr, key.abstimmnr)
      // Omitted, not null — see the header.
      if (sheet) sheets.push(toVoteSheetDoc(sheet))
    }

    // Newest first, matching every other list of ballots on the site. Sorted
    // here rather than trusting the caller's order, which is an editorial
    // ordering and not a chronological one.
    return sheets.sort((a, b) => b.date.localeCompare(a.date))
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

    // Newest first off the index — `date` is its trailing column, so descending
    // order *is* chronological within the period, and `.take(limit)` stops
    // there. The previous form collected the member's records across every
    // period, fetched a sheet per row to find out which period each belonged to,
    // sorted the lot in memory and then kept 25: ~254 records and ~254 sheet
    // fetches to return a page of five, on the site's most-visited page type.
    const records = await ctx.db
      .query("voteRecords")
      .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
        q.eq("mpInternalId", args.mpInternalId).eq("wahlperiode", args.wahlperiode),
      )
      .order("desc")
      .take(limit)

    const joined = []
    for (const record of records) {
      // The sheet is fetched for the page's *own* rows only — at most `limit` of
      // them, and it is the row being rendered rather than a lookup to decide
      // whether to render it. That is the difference between an N+1 and a join.
      const sheet = await ctx.db.get(record.voteSheetId)
      if (!sheet) continue
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
