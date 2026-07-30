import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"

/**
 * Removes everything a seeder wrote from a deployment: the synthetic MPs and
 * all that hangs off them, and the ballots they invented.
 *
 * ## Why this exists
 *
 * `scripts/seed-local.ts` was run against **production**. Twelve invented
 * mandates (`bt-0001`…`bt-0012`) landed beside the real roster, and because
 * nine of them carry the names of sitting members — Merz, Klingbeil, Esken,
 * Weidel and five more — those nine appeared *twice* in the roster and twice in
 * search. The seed rows also carry fabricated speeches, motions and a year of
 * `referenceType: "seed"` feed events, which were scored and ranked. On a site
 * whose premise is that every metric is backed by a Bundestag record, that is
 * the one defect that cannot be left to a later release.
 *
 * A mutation rather than a one-off script run from a laptop: the rows are
 * reachable from ten tables, deleting them in the wrong order leaves orphans
 * that no query returns and no error mentions, and doing it in Convex means the
 * traversal uses the same indexes the readers do. It is also re-runnable, which
 * a hand-written sequence of dashboard deletions is not.
 *
 * ## Two id rules, because there are two kinds of fabricated row
 *
 * `isSyntheticId` decides a mandate; `isSyntheticVoteSheet` decides a ballot.
 * They are separate because a sheet is owned by nobody — it is the division, not
 * a person's participation in it — so no traversal from a mandate reaches one.
 *
 * That was originally read as a reason to leave sheets out of the purge, and the
 * omission was written down instead of closed. It cost two days: the mandates
 * were deleted on 2026-07-27, `seedDataPresent` reported a clean deployment, and
 * `/votes/own-resources` went on publishing `(21, 91, 2)` — a 6/3/1 tally nobody
 * cast, above an empty voter table — until 2026-07-29. Both halves now run from
 * one entry point and are answered by one `done`, so a purge that reports
 * success has left nothing behind.
 *
 * ## What identifies a synthetic row
 *
 * The **id shape**, not a list of ids and not a `bt-000…` prefix.
 * `pipeline/src/bundestrack/pipeline/join.py:78` derives every real id as `bt-`
 * plus the 8-digit Stammdaten id, so `bt-` followed by anything else was minted
 * by a seeder. The obvious pattern — `bt-000[0-9]` — matches only nine of the
 * twelve and would have left fabricated Weidel, Klöckner and Dobrindt rows in
 * production looking exactly like the ones that had been cleaned up.
 *
 * `convex/seedDev.ts` mints the same 4-digit shape, so this covers both seeders.
 *
 * ⚠ It follows that a real Stammdaten id which is not 8 digits would be read as
 * synthetic. None exists — §6.2's dump is fixed-width — and `isSyntheticId`
 * requires the id to be `bt-` *and* to hold no 8-digit body, so an unprefixed or
 * differently-shaped id from a future source is left alone rather than deleted.
 *
 * ## Everything is reached by index, including the fabricated feed events
 *
 * The seeder stamps `referenceType: "seed"` on every event it writes, which is
 * the tempting thing to delete on — and there is no index over it, so doing so
 * would mean a full scan of the largest table in the deployment. It is also
 * unnecessary: the seeder writes `mpInternalId: seed.internalId` on every one of
 * those events (`scripts/seed-local.ts`), so each is owned by a synthetic
 * mandate and the per-MP range scan below already reaches it. The marker is used
 * for *verification* instead — `countSeedEvents` walks the synthetic MPs and
 * reports how many of their events carry it — which answers the same question
 * from the index side.
 */

/** `bt-` plus exactly eight digits — what `internal_id()` mints for every real
 * mandate. Anchored, so `bt-110040110` is not a match. */
const REAL_ID = /^bt-\d{8}$/

/** The marker `scripts/seed-local.ts` writes on every fabricated feed event.
 * Real events name a source table or a DIP id space here. */
const SEED_REFERENCE_TYPE = "seed"

/**
 * Whether an `mps.internalId` was minted by a seeder rather than by the pipeline.
 *
 * Deliberately conservative in one direction: a value that does not start with
 * `bt-` at all is *not* called synthetic. Everything the pipeline writes carries
 * the prefix, so an id without one came from somewhere this function has never
 * seen — and deleting rows on the strength of a shape nobody has described is
 * how a cleanup becomes the incident.
 */
export function isSyntheticId(internalId: string): boolean {
  return internalId.startsWith("bt-") && !REAL_ID.test(internalId)
}

/** The synthetic mandates on this deployment. One roster scan, shared by the
 * dry run, the purge and the verification — the roster is ~650 rows and every
 * caller here needs the whole of it.
 *
 * `QueryCtx` rather than `MutationCtx`: both of these only read, and a mutation
 * ctx satisfies the query one, so the narrower type is what lets the two
 * `internalQuery` callers share the definition with the mutation instead of
 * keeping a second copy of the filter. */
async function syntheticMandates(ctx: QueryCtx) {
  const roster = await ctx.db.query("mps").withIndex("by_wahlperiode_and_fraktion").collect()
  return roster.filter((mp) => isSyntheticId(mp.internalId))
}

/** The fabricated ballots on this deployment, the sheet-side counterpart to
 * `syntheticMandates`. Shared by the dry run, the purge and the verification for
 * the same reason: ~254 rows, and each caller needs all of them. */
async function syntheticVoteSheets(ctx: QueryCtx) {
  const sheets = await ctx.db.query("voteSheets").withIndex("by_date").collect()
  return sheets.filter(isSyntheticVoteSheet)
}

/**
 * The synthetic mandates and ballots, with the damage each one does.
 *
 * A dry run, and the reason this module has a query at all: the mutation below
 * deletes rows that cannot be recovered, so the operator gets to read the list —
 * by name — before running it. `purgeSeedData` recomputes the set rather than
 * taking these ids as an argument, so a roster that changed between the two
 * calls cannot cause the wrong rows to be deleted.
 *
 * `shadowsRealMP` is the finding restated as data: it is true for exactly the
 * members a reader saw listed twice.
 *
 * `voteSheets` lists the ballots by their natural key and published tally. It is
 * here because the sheets are the half of the purge nobody could see coming: the
 * mandates announce themselves by name in a roster, whereas a fabricated
 * division is indistinguishable from a real one on any page that renders it —
 * `(21, 91, 2)` published a 6/3/1 result above an empty voter table and read as
 * an ordinary electoral-law vote. An operator should see it listed before it is
 * deleted, and — more to the point — before deciding the deployment is clean.
 */
export const listSeedRows = internalQuery({
  args: {},
  returns: v.object({
    mps: v.array(
      v.object({
        internalId: v.string(),
        name: v.string(),
        wahlperiode: v.number(),
        /** True when a real mandate carries this same name — the duplicate a
         * reader actually saw on the roster. */
        shadowsRealMP: v.boolean(),
        events: v.number(),
      }),
    ),
    voteSheets: v.array(
      v.object({
        wahlperiode: v.number(),
        sitzungnr: v.number(),
        abstimmnr: v.number(),
        title: v.string(),
        /** The electorate that gives it away — twelve, where a real sheet
         * carries 628, 630 or 736. */
        totalEligible: v.number(),
        /** Records still filed against it. Normally zero by the time this is
         * read: the mandate traversal takes them first. */
        records: v.number(),
      }),
    ),
    totalEvents: v.number(),
  }),
  handler: async (ctx) => {
    const roster = await ctx.db.query("mps").withIndex("by_wahlperiode_and_fraktion").collect()
    const realNames = new Set(
      roster.filter((mp) => !isSyntheticId(mp.internalId)).map((mp) => mp.name),
    )

    const mps = []
    let totalEvents = 0
    for (const mp of roster.filter((row) => isSyntheticId(row.internalId))) {
      const events = await ctx.db
        .query("activityEvents")
        .withIndex("by_mpInternalId_and_date", (q) => q.eq("mpInternalId", mp.internalId))
        .collect()
      totalEvents += events.length
      mps.push({
        internalId: mp.internalId,
        name: mp.name,
        wahlperiode: mp.wahlperiode,
        shadowsRealMP: realNames.has(mp.name),
        events: events.length,
      })
    }

    const voteSheets = []
    for (const sheet of await syntheticVoteSheets(ctx)) {
      const records = await ctx.db
        .query("voteRecords")
        .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
        .collect()
      voteSheets.push({
        wahlperiode: sheet.wahlperiode,
        sitzungnr: sheet.sitzungnr,
        abstimmnr: sheet.abstimmnr,
        title: sheet.title,
        totalEligible: sheet.totalEligible,
        records: records.length,
      })
    }

    return {
      mps: mps.sort((a, b) => a.internalId.localeCompare(b.internalId)),
      voteSheets,
      totalEvents,
    }
  },
})

/** Rows deleted per slice. Each delete is a write, and Convex allows ~8 000 per
 * transaction — the same budget `backfillSearchText` in convex/search.ts slices
 * against, kept well below the ceiling because one seeded MP owns several
 * hundred feed events on its own. */
const PURGE_BATCH = 2000

type Counts = Record<string, number>

function bump(counts: Counts, table: string): void {
  counts[table] = (counts[table] ?? 0) + 1
}

/**
 * Deletes every row keyed to one synthetic MP, across every table that
 * references `mpInternalId`.
 *
 * The list is exhaustive against convex/schema.ts as of this commit, and that is
 * worth stating rather than assuming: a table added later that keys by
 * `mpInternalId` and is not added here leaves orphans behind a purge that
 * reports success. Every read goes through the index the schema defines for that
 * key, so this costs one range scan per table per MP rather than a table scan.
 *
 * ⚠ "Exhaustive" here means *of the tables keyed by `mpInternalId`* — a table
 * holding fabricated rows that no mandate owns is invisible to this function no
 * matter how carefully the list is kept. `voteSheets` was exactly that, and the
 * cost is recorded in the module header. Its counterpart is
 * `deleteSyntheticVoteSheets`; a future table of that shape needs its own.
 *
 * `voteRecords` is the one that cannot be reached from the ballot side, and the
 * reason the whole traversal is keyed on the MP. The seeder's first ballot
 * collided with a **real** sheet — production holds a genuine `(21, 90, 1)` with
 * 630 eligible voters — so deleting "synthetic ballots" would have left twelve
 * invented votes attached to a real one, skewing its tally and its
 * Fraktionsdisziplin figures while looking clean. Keying on the MP catches those
 * records wherever they were filed.
 */
async function deleteRowsFor(
  ctx: MutationCtx,
  mpInternalId: string,
  budget: { remaining: number },
  counts: Counts,
): Promise<void> {
  /** Each table's rows for this MP, read through its own index and capped by
   * what is left of the slice's write budget. Returning early on an exhausted
   * budget is what makes the traversal resumable rather than partial. */
  const readers = [
    {
      table: "activityEvents",
      read: (take: number) =>
        ctx.db
          .query("activityEvents")
          .withIndex("by_mpInternalId_and_date", (q) => q.eq("mpInternalId", mpInternalId))
          .take(take),
    },
    {
      table: "activityScores",
      read: (take: number) =>
        ctx.db
          .query("activityScores")
          .withIndex("by_mpInternalId_and_wahlperiode_and_month", (q) =>
            q.eq("mpInternalId", mpInternalId),
          )
          .take(take),
    },
    {
      table: "voteRecords",
      read: (take: number) =>
        ctx.db
          .query("voteRecords")
          .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", mpInternalId))
          .take(take),
    },
    {
      // The roll-up over the rows above, and it must go with them. It is a
      // *stored sum* maintained by delta (convex/votes.ts), so unlike every
      // other table here it does not become empty merely because its inputs
      // did: deleting a synthetic MP's vote records without this would leave a
      // tally counting votes that no longer exist, on the one board where the
      // number is a claim about a named person's conduct. `backfillDissent`
      // cannot repair that either — a deleted record carries no flag to
      // subtract.
      table: "dissentTallies",
      read: (take: number) =>
        ctx.db
          .query("dissentTallies")
          .withIndex("by_mpInternalId_and_wahlperiode", (q) => q.eq("mpInternalId", mpInternalId))
          .take(take),
    },
    {
      table: "speeches",
      read: (take: number) =>
        ctx.db
          .query("speeches")
          .withIndex("by_mpInternalId_and_protocolDate", (q) => q.eq("mpInternalId", mpInternalId))
          .take(take),
    },
    {
      table: "motionSponsors",
      read: (take: number) =>
        ctx.db
          .query("motionSponsors")
          .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", mpInternalId))
          .take(take),
    },
    {
      table: "questions",
      read: (take: number) =>
        ctx.db
          .query("questions")
          .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
            q.eq("mpInternalId", mpInternalId),
          )
          .take(take),
    },
    {
      table: "committeeMemberships",
      read: (take: number) =>
        ctx.db
          .query("committeeMemberships")
          .withIndex("by_mpInternalId_and_wahlperiode_and_committeeName", (q) =>
            q.eq("mpInternalId", mpInternalId),
          )
          .take(take),
    },
    {
      // `voteExplanations` is keyed by MP — a §31 declaration is a named
      // person's statement — so a synthetic mandate's seeded declarations
      // reach the same per-MP scan every other member-keyed table does.
      // Added when seedDev started writing them so the vote-detail
      // disclosure has a populated arm to render; without this reader a
      // subsequent purge would leave those rows and a re-seed would land
      // beside them.
      table: "voteExplanations",
      read: (take: number) =>
        ctx.db
          .query("voteExplanations")
          .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
            q.eq("mpInternalId", mpInternalId),
          )
          .take(take),
    },
    {
      table: "activities",
      read: (take: number) =>
        ctx.db
          .query("activities")
          .withIndex("by_mpInternalId_and_wahlperiode_and_date", (q) =>
            q.eq("mpInternalId", mpInternalId),
          )
          .take(take),
    },
    {
      table: "seatingAssignments",
      read: (take: number) =>
        ctx.db
          .query("seatingAssignments")
          .withIndex("by_mpInternalId_and_wahlperiode", (q) => q.eq("mpInternalId", mpInternalId))
          .take(take),
    },
  ] as const

  for (const { table, read } of readers) {
    if (budget.remaining <= 0) return
    for (const row of await read(budget.remaining)) {
      await ctx.db.delete(row._id)
      budget.remaining--
      bump(counts, table)
    }
  }
}

/**
 * Deletes the fabricated ballots, and any records still filed against them.
 *
 * Part of `purgeSeedData` rather than a mutation of its own, which is the fix
 * for the way this went wrong the first time: the sheets were left out of the
 * purge because they are not reachable from a mandate, the omission was
 * *documented* rather than closed, and `(21, 91, 2)` then sat on the live
 * `/votes/own-resources` page for two days after a purge that reported success.
 * A cleanup with a second half an operator has to know to run separately is one
 * that will be half-run. One entry point, one contract: after `purgeSeedData`
 * reports `done`, nothing a seeder wrote is left in any table.
 *
 * Records first, on the same ordering argument as `deleteRowsFor`: an
 * interrupted run leaves a sheet that still owns its rows rather than records
 * pointing at nothing. In practice the mandate traversal has already taken them,
 * so this is about the invariant, not the count.
 */
async function deleteSyntheticVoteSheets(
  ctx: MutationCtx,
  budget: { remaining: number },
  counts: Counts,
): Promise<Array<{ wahlperiode: number; sitzungnr: number; abstimmnr: number }>> {
  const deleted = []

  for (const sheet of await ctx.db.query("voteSheets").withIndex("by_date").collect()) {
    if (budget.remaining <= 0) break
    // Both conditions, not either — see `isSyntheticVoteSheet` on the XML-route
    // sheets each would otherwise catch on its own.
    if (!isSyntheticVoteSheet(sheet)) continue

    const rows = await ctx.db
      .query("voteRecords")
      .withIndex("by_voteSheetId_and_mpInternalId", (q) => q.eq("voteSheetId", sheet._id))
      .take(budget.remaining)
    for (const row of rows) {
      await ctx.db.delete(row._id)
      budget.remaining--
      bump(counts, "voteRecords")
    }
    // Only once its records are gone; a budget exhausted by them leaves the
    // sheet for the next slice.
    if (budget.remaining <= 0) break

    await ctx.db.delete(sheet._id)
    budget.remaining--
    bump(counts, "voteSheets")
    deleted.push({
      wahlperiode: sheet.wahlperiode,
      sitzungnr: sheet.sitzungnr,
      abstimmnr: sheet.abstimmnr,
    })
  }

  return deleted
}

/**
 * The Vorgang-id prefix seedDev mints for the synthetic motions and
 * referrals — a real DIP id is a bare integer, so this cannot collide.
 * Kept separate from `isSyntheticVoteSheet` because these tables carry no
 * electorate and no XLSX URL; the prefix is the only honest marker.
 */
const SEED_VORGANG_PREFIX = "seed-"

function isSyntheticVorgangId(id: string | null): boolean {
  return id !== null && id.startsWith(SEED_VORGANG_PREFIX)
}

/**
 * Deletes seeded motions and the referrals attached to them.
 *
 * Neither table names an MP, so `deleteRowsFor`'s per-mandate traversal
 * cannot reach them — the same reason `voteSheets` needs its own path
 * (`deleteSyntheticVoteSheets`). Referrals first, so a slice exhausted on
 * them leaves the motion in place for the next slice rather than the
 * reverse — the mirror of the ordering the vote-sheet path uses for its
 * records-then-sheet order.
 */
async function deleteSyntheticMotionsAndReferrals(
  ctx: MutationCtx,
  budget: { remaining: number },
  counts: Counts,
): Promise<void> {
  // Referrals: keyed on Vorgang id, so a range read per seeded motion
  // reaches exactly its rows without a table scan.
  const motions = await ctx.db.query("motions").withIndex("by_dipVorgangId").collect()
  const seedMotions = motions.filter((row) => isSyntheticVorgangId(row.dipVorgangId))
  for (const motion of seedMotions) {
    if (budget.remaining <= 0) break
    if (motion.dipVorgangId !== null) {
      const referrals = await ctx.db
        .query("committeeReferrals")
        .withIndex("by_dipVorgangId", (q) => q.eq("dipVorgangId", motion.dipVorgangId))
        .take(budget.remaining)
      for (const row of referrals) {
        await ctx.db.delete(row._id)
        budget.remaining--
        bump(counts, "committeeReferrals")
      }
      if (budget.remaining <= 0) break
    }
    await ctx.db.delete(motion._id)
    budget.remaining--
    bump(counts, "motions")
  }
}

/** Whether any seeded motion or referral remains — the check `purgeSeedData`'s
 * `done` flag needs to answer for these two tables the way it answers for
 * mandates and vote sheets. */
async function seedMotionsRemaining(
  ctx: QueryCtx,
): Promise<{ motions: number; referrals: number }> {
  const motions = await ctx.db.query("motions").withIndex("by_dipVorgangId").collect()
  const seedMotions = motions.filter((row) => isSyntheticVorgangId(row.dipVorgangId))
  let referrals = 0
  for (const motion of seedMotions) {
    if (motion.dipVorgangId === null) continue
    const rows = await ctx.db
      .query("committeeReferrals")
      .withIndex("by_dipVorgangId", (q) => q.eq("dipVorgangId", motion.dipVorgangId))
      .collect()
    referrals += rows.length
  }
  return { motions: seedMotions.length, referrals }
}

/**
 * Deletes the synthetic mandates, everything derived from them, and the ballots
 * the seeder invented.
 *
 * Sliced and re-runnable: the caller loops while `done` is false, exactly like
 * `backfillSearchText` in convex/search.ts. The dependants of an MP are deleted
 * **before** the mandate row itself, so an interrupted run leaves a mandate that
 * still owns its remaining rows rather than orphans no query can reach —
 * re-running finishes the job. That ordering is why this is not simply a
 * filtered delete over each table in turn.
 *
 * `done` answers for **both** halves. It used to mean "no synthetic mandates
 * remain", which was true of a deployment still publishing a fabricated
 * division, so an operator who ran this to completion and checked the one flag
 * it returned was told the site was clean while it was not.
 *
 * Returns what it deleted, per table. An operator needs that to compare against
 * the dry run: a purge reporting zero deletions when `listSeedRows` reported
 * twelve mandates means the id rule and the data have diverged, which is worth
 * knowing *before* the roster count is checked and found plausible.
 */
export const purgeSeedData = internalMutation({
  args: { batch: v.optional(v.number()) },
  returns: v.object({
    deleted: v.record(v.string(), v.number()),
    mpsRemaining: v.number(),
    /** Ballots still matching `isSyntheticVoteSheet` after this slice. */
    voteSheetsRemaining: v.number(),
    /** Seeded motions still matching the Vorgang-id prefix. Kept alongside
     * `mpsRemaining` and `voteSheetsRemaining` for the same reason: `done`
     * has to answer for every table the seeder writes, and forgetting one
     * is exactly the failure mode this module's header records. */
    motionsRemaining: v.number(),
    referralsRemaining: v.number(),
    /** Each deleted sheet's natural key, so an operator can check what went
     * against the corpus rather than trusting a count. */
    voteSheetsDeleted: v.array(
      v.object({ wahlperiode: v.number(), sitzungnr: v.number(), abstimmnr: v.number() }),
    ),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const budget = { remaining: Math.max(1, Math.floor(args.batch ?? PURGE_BATCH)) }
    const counts: Counts = {}

    for (const mp of await syntheticMandates(ctx)) {
      if (budget.remaining <= 0) break
      await deleteRowsFor(ctx, mp.internalId, budget, counts)
      // Only once its dependants are gone — see the note above on ordering.
      if (budget.remaining <= 0) break
      await ctx.db.delete(mp._id)
      budget.remaining--
      bump(counts, "mps")
    }

    // After the mandates, so a slice spent on the roster is not also spent
    // here, and so the records a sheet owns are usually already gone.
    const voteSheetsDeleted = await deleteSyntheticVoteSheets(ctx, budget, counts)

    // The last of the three non-per-mandate halves — see the note on the
    // helper. Nothing else references seed motions or referrals, so this
    // ordering is not load-bearing beyond the budget-slicing invariant.
    await deleteSyntheticMotionsAndReferrals(ctx, budget, counts)

    const mpsRemaining = (await syntheticMandates(ctx)).length
    const voteSheetsRemaining = (await syntheticVoteSheets(ctx)).length
    const remainingMotions = await seedMotionsRemaining(ctx)
    return {
      deleted: counts,
      mpsRemaining,
      voteSheetsRemaining,
      motionsRemaining: remainingMotions.motions,
      referralsRemaining: remainingMotions.referrals,
      voteSheetsDeleted,
      done:
        mpsRemaining === 0 &&
        voteSheetsRemaining === 0 &&
        remainingMotions.motions === 0 &&
        remainingMotions.referrals === 0,
    }
  },
})

/**
 * Whether this deployment still holds anything a seeder wrote.
 *
 * The check to run after a purge, and the one `scripts/seed-local.ts` runs
 * *before* it writes — which is how the seeder now refuses to touch a deployment
 * holding a real roster. Kept here rather than in the seeder so there is one
 * definition of "synthetic data is present"; the seeder cannot query Convex
 * directly, so it reaches this through the HTTP API (convex/http.ts).
 *
 * `seedEvents` counts the fabricated feed events still reachable from a
 * synthetic mandate, by the `referenceType` marker the seeder stamps. Zero
 * synthetic mandates therefore implies zero seed events, which is the invariant
 * the purge establishes and this reports on.
 *
 * `voteSheets` is the field this answer was missing, and the omission was not
 * academic: the mandates were purged on 2026-07-27 and this query then reported
 * a clean deployment for two days while `/votes/own-resources` published a
 * ballot nobody ever cast. A sheet is owned by no mandate, so a mandate-shaped
 * check cannot see it — which is the whole reason it has to be counted here
 * rather than inferred.
 */
export const seedDataPresent = internalQuery({
  args: {},
  returns: v.object({
    mps: v.number(),
    seedEvents: v.number(),
    voteSheets: v.number(),
    /** Seeded motions still in the corpus, matched by Vorgang-id prefix.
     * Reported alongside `mps` and `voteSheets` because a purge that leaves
     * these behind leaves publicly-visible fabricated rows on `/motions` —
     * exactly the class of defect the `voteSheets` field on this object was
     * added to catch after the two-day incident recorded in the module
     * header. */
    motions: v.number(),
    referrals: v.number(),
    realMPs: v.number(),
  }),
  handler: async (ctx) => {
    const roster = await ctx.db.query("mps").withIndex("by_wahlperiode_and_fraktion").collect()
    const synthetic = roster.filter((mp) => isSyntheticId(mp.internalId))

    let seedEvents = 0
    for (const mp of synthetic) {
      const events = await ctx.db
        .query("activityEvents")
        .withIndex("by_mpInternalId_and_date", (q) => q.eq("mpInternalId", mp.internalId))
        .collect()
      seedEvents += events.filter((row) => row.referenceType === SEED_REFERENCE_TYPE).length
    }

    const remainingMotions = await seedMotionsRemaining(ctx)
    return {
      mps: synthetic.length,
      seedEvents,
      voteSheets: (await syntheticVoteSheets(ctx)).length,
      motions: remainingMotions.motions,
      referrals: remainingMotions.referrals,
      realMPs: roster.length - synthetic.length,
    }
  },
})

/** An electorate below this is not a chamber. The Bundestag's real sheets carry
 * 628, 630 or 736; the seeder writes `MPS.length` — twelve. */
const MIN_REAL_ELECTORATE = 100

/**
 * Whether a ballot was invented by a seeder rather than held by the Bundestag.
 *
 * ## Why sheets need their own predicate at all
 *
 * `deleteRowsFor` reaches everything a synthetic *mandate* owns, and a vote
 * sheet is owned by nobody — it is the ballot, not a person's participation in
 * it. Keying the traversal on the MP was right for the records (the note there
 * explains why: the seeder's first ballot landed on the natural key of a
 * **real** division, so deleting "synthetic ballots" would have destroyed a
 * genuine sheet) but it left the sheets themselves unreachable. The seeder wrote
 * two. One collided with a real key and has since been overwritten in place by
 * the pipeline — `upsertVoteSheet` patches by natural key, so it is now the real
 * ballot and must be left alone. The other, `(21, 91, 2)`, named a sitting the
 * Bundestag has not held, so nothing ever overwrote it and it stayed: a
 * fabricated division on a public site, its twelve votes purged, publishing a
 * 6/3/1 tally that nobody cast above an empty table.
 *
 * ## What identifies one, and why it is not the natural key
 *
 * **Both** an electorate below `MIN_REAL_ELECTORATE` and a null `sourceUrl`.
 * Across the 254 ballots in production every real sheet carries the chamber
 * *and* its bundestag.de XLSX, and the seed row is the only one failing either.
 *
 * Two conditions rather than one because each alone has a real counterexample.
 * A low electorate is not by itself synthetic: `totalEligible` is the number of
 * rows on the sheet (`total_eligible` in pipeline models/votes.py), and a ballot
 * reconstructed from the protocol XML lists only the MPs who cast a vote (§4.2)
 * — the same case where `sourceUrl` is null and `absentCount` cannot be trusted,
 * per the schema note. A null `sourceUrl` is not by itself synthetic either, for
 * exactly that reason. Only the conjunction — a chamber of a dozen *and* no
 * published sheet — describes something no Bundestag division can be. A
 * historical backfill (WP19–WP14) is precisely the traffic that lands XML-route
 * sheets, so the narrower rule is not hypothetical.
 *
 * A hard-coded `(21, 91, 2)` would be the more obvious rule and is the wrong
 * one, for the reason that key is dangerous in the first place: the Bundestag
 * may yet hold a real sitting 91, vote 2, and `upsertVoteSheet` would patch this
 * row into a genuine ballot. A delete keyed on the triple would then destroy
 * real data, while one keyed on the row's own implausibility stops matching the
 * moment the row becomes real — the safe direction to fail.
 *
 * Exported and pure for the same reason `isSyntheticId` is: it is the predicate
 * an irreversible delete runs over every ballot in the corpus, and it can be
 * tested exhaustively without a database.
 */
export function isSyntheticVoteSheet(sheet: {
  totalEligible: number
  sourceUrl: string | null
}): boolean {
  return sheet.totalEligible < MIN_REAL_ELECTORATE && sheet.sourceUrl === null
}
