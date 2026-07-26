import type { WithoutSystemFields } from "convex/server"
import type { Doc, TableNames } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

/** The system fields Convex adds and the ingestion API does not expose. Stripped
 * on read because `internalId` — not `_id` — is the identifier every table and
 * every URL uses, and offering both would invite a second one into the
 * frontend. */
type SystemFields = "_id" | "_creationTime"

/**
 * What every ingestion mutation shares: upsert-on-natural-key, and the bounds
 * that keep one request inside Convex's transaction limits.
 *
 * The pipeline re-runs: a daily sync re-reads anything whose `aktualisiert`
 * moved (§2.5), a failed run is simply run again, and re-backfilling a loaded
 * period must be a no-op rather than a second copy. So "insert if new, patch
 * if changed" is the only write shape here, defined once rather than eleven
 * times.
 */

/** Convex reads ~16 000 documents and writes ~8 000 in one transaction. A
 * batch upsert costs one read and one write per row, so 500 leaves room for
 * the index lookups underneath while still cutting a 630-MP roster to two
 * requests. The pipeline chunks to this; the validators enforce it. */
export const MAX_BATCH = 500

/** Ceiling on any client-supplied `limit`. A list query with an unbounded
 * `take` is one bad query string away from reading a whole table. */
export const MAX_PAGE = 200

/**
 * Clamps a caller-supplied limit into `1…MAX_PAGE`.
 *
 * `Number.isFinite` first, because `NaN` propagates through `Math.min`
 * unchanged and would reach `.take(NaN)` — which is not an error, just an
 * empty page that looks like missing data.
 */
export function pageLimit(limit: number | undefined, fallback = 50): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)))
}

/**
 * Rejects an oversized batch, naming what was sent and what the ceiling is.
 *
 * Rejects rather than truncates, so the pipeline gets a 400 it can chunk and
 * retry instead of a 200 that silently wrote the first `MAX_BATCH` rows. The
 * message names the unit (`speeches`, `sponsors`) because a caller posting
 * several kinds in a sync needs to know which one to split.
 */
export function assertBatchSize(count: number, unit: string): void {
  if (count > MAX_BATCH) {
    throw new Error(`Batch too large: ${count} ${unit}, maximum is ${MAX_BATCH}`)
  }
}

/** Drops Convex's system fields — the read-model shape for a table whose own
 * identifier is the one callers use. See `SystemFields`. */
export function withoutSystemFields<Table extends TableNames>(
  row: Doc<Table>,
): Omit<Doc<Table>, SystemFields> {
  const { _id, _creationTime, ...rest } = row
  return rest
}

/** As above, but re-exposing the Convex id under `id` — for the tables whose
 * rows a caller must be able to name again (a motion to fetch its sponsors, a
 * ballot to fetch its records). */
export function withId<Table extends TableNames>(
  row: Doc<Table>,
): Omit<Doc<Table>, SystemFields> & { id: Doc<Table>["_id"] } {
  return { id: row._id, ...withoutSystemFields(row) }
}

/**
 * A table's document minus everything the *caller* does not supply: Convex's
 * system fields, and the timestamps the mutation stamps itself. This is the
 * shape of the ingestion payload for any table, derived from the schema rather
 * than restated per module.
 */
type IngestFields<Table extends TableNames> = Omit<
  WithoutSystemFields<Doc<Table>>,
  "createdAt" | "updatedAt"
>

/**
 * Writes `fields` to `existing`, or inserts them, and reports which happened.
 *
 * The patch is unconditional rather than diffed first. Convex skips a write
 * whose values are unchanged, so a diff here would buy nothing but a way for
 * the two comparisons to disagree — and an amended record that differs only in
 * a field the diff forgot is exactly the case the daily sync exists to catch.
 *
 * `touchUpdatedAt` is a parameter rather than inferred because only some tables
 * carry an `updatedAt`: `mps` and `activityScores` are corrected in place and
 * want a modification time, while an ingested speech either exists or does not.
 *
 * The two casts are the price of being generic over `Table`: both narrow to
 * what the signature already promises, but `patch` and `insert` resolve their
 * parameter types from a concrete table name, which a type parameter is not.
 * The alternative is this function once per table, which is how upsert
 * semantics drift apart.
 */
export async function upsertRow<Table extends TableNames>(
  ctx: MutationCtx,
  table: Table,
  existing: Doc<Table> | null,
  fields: IngestFields<Table>,
  now: number,
  options: { touchUpdatedAt?: boolean } = {},
): Promise<{ id: Doc<Table>["_id"]; created: boolean }> {
  const stamped = options.touchUpdatedAt ? { ...fields, updatedAt: now } : { ...fields }
  if (existing) {
    await ctx.db.patch(existing._id, stamped as unknown as Partial<Doc<Table>>)
    return { id: existing._id, created: false }
  }
  const id = await ctx.db.insert(table, {
    ...stamped,
    createdAt: now,
  } as unknown as WithoutSystemFields<Doc<Table>>)
  return { id, created: true }
}

/** What a batch ingestion reports back. The pipeline logs these to tell a
 * genuinely incremental sync from one that is re-writing the world every night
 * because a natural key stopped matching. */
export type BatchResult = { inserted: number; updated: number }

export function emptyBatchResult(): BatchResult {
  return { inserted: 0, updated: 0 }
}

export function recordBatch(result: BatchResult, created: boolean): void {
  if (created) result.inserted++
  else result.updated++
}
