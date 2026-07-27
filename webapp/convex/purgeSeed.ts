import { v } from "convex/values"
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server"

/**
 * Removes synthetic MPs, and everything that hangs off them, from a deployment.
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
 * reachable from nine tables, deleting them in the wrong order leaves orphans
 * that no query returns and no error mentions, and doing it in Convex means the
 * traversal uses the same indexes the readers do. It is also re-runnable, which
 * a hand-written sequence of dashboard deletions is not.
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
 * caller here needs the whole of it. */
async function syntheticMandates(ctx: MutationCtx | { db: MutationCtx["db"] }) {
  const roster = await ctx.db.query("mps").withIndex("by_wahlperiode_and_fraktion").collect()
  return roster.filter((mp) => isSyntheticId(mp.internalId))
}

/**
 * The synthetic mandates, with the damage each one does.
 *
 * A dry run, and the reason this module has a query at all: the mutation below
 * deletes rows that cannot be recovered, so the operator gets to read the list —
 * by name — before running it. `purgeSeedData` recomputes the set rather than
 * taking these ids as an argument, so a roster that changed between the two
 * calls cannot cause the wrong rows to be deleted.
 *
 * `shadowsRealMP` is the finding restated as data: it is true for exactly the
 * members a reader saw listed twice.
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

    return { mps: mps.sort((a, b) => a.internalId.localeCompare(b.internalId)), totalEvents }
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
 * Deletes the synthetic mandates and everything derived from them.
 *
 * Sliced and re-runnable: the caller loops while `done` is false, exactly like
 * `backfillSearchText` in convex/search.ts. The dependants of an MP are deleted
 * **before** the mandate row itself, so an interrupted run leaves a mandate that
 * still owns its remaining rows rather than orphans no query can reach —
 * re-running finishes the job. That ordering is why this is not simply a
 * filtered delete over each table in turn.
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

    const mpsRemaining = (await syntheticMandates(ctx)).length
    return { deleted: counts, mpsRemaining, done: mpsRemaining === 0 }
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
 */
export const seedDataPresent = internalQuery({
  args: {},
  returns: v.object({ mps: v.number(), seedEvents: v.number(), realMPs: v.number() }),
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

    return {
      mps: synthetic.length,
      seedEvents,
      realMPs: roster.length - synthetic.length,
    }
  },
})
