import type { QueryCtx } from "../_generated/server"

/**
 * A fake `ctx.db` that records what a read *would have cost*, for tests.
 *
 * ## Why this exists rather than a database
 *
 * The two production incidents this repository has had on Convex were both
 * *cost* failures, not correctness failures: a scoring slice that read 32 002
 * documents where the limit is 32 000, and a tally write that every ballot and
 * every page render contended on. Neither is visible in an assertion about
 * return values — the old `voteParticipation` returned exactly the right
 * participation rate, and did so by reading a member's entire career and
 * fetching a `voteSheets` row per record.
 *
 * So the thing to assert is the *shape of the read*: which index, bounded by
 * which fields, and how many documents were fetched by id. That is what this
 * records. A test that pins it turns "this query is scope-bounded" from a
 * property of the current code into a property the next change has to preserve.
 *
 * ## Why a fake rather than `convex-test` or a local backend
 *
 * Both exist and both work here (`convex-test` runs under `bun test` with an
 * explicit modules map; the open-source backend binary runs with no
 * credentials). Neither is the right tool for *this* assertion:
 *
 *  - `convex-test` enforces the real transaction limits, so it can prove a read
 *    explosion *throws* — but only once the corpus is large enough to cross
 *    32 000 documents, which means fabricating tens of thousands of rows to
 *    catch a regression this catches with twelve.
 *  - The local backend reproduces real contention, but it needs a running
 *    process and a deploy, which CI has neither the binary nor the time for.
 *
 * This runs in milliseconds with no dependency, and it fails on the *first*
 * unbounded read rather than on the ten-thousandth. The repo's existing Convex
 * tests are pure-function tests for the same reason (`convex/votes.test.ts`
 * says so); this extends that to the read layer without importing a database.
 *
 * ## ⚠ Why the filename carries `.testing`
 *
 * Every `convex/**\/*.ts` without a second dot in its name is a *deployed
 * function module*: `scripts/check-codegen.ts` lists them, `_generated/api.d.ts`
 * imports them, and `bunx convex deploy` ships them. This file exports no Convex
 * function and belongs in no deployment, so it takes the second dot that
 * `auth.config.ts` and `*.test.ts` take, for exactly their reason. Renaming it
 * back would fail the codegen gate rather than silently deploying it, which is
 * the right way round.
 *
 * ## What it does not model
 *
 * Ordering, `.order("desc")`, and the contents of rows beyond what the fixture
 * supplies — it filters the fixture by the recorded bounds and returns matches,
 * which is enough for a cost assertion and not enough for a semantics one.
 * Semantics are asserted against the real helpers' pure counterparts and, for
 * the dissent rules, in `convex/votes.test.ts`.
 */

/** One index range a query asked for. */
export type RecordedRead = {
  table: string
  index: string
  /** The equality bounds, in the order they were applied. `undefined` is a real
   * value here — it is how Convex selects rows missing an optional field, and
   * the vote-scope migration depends on it. */
  eq: Array<{ field: string; value: unknown }>
  /** Range bounds, if any. Their presence is what distinguishes a windowed read
   * from one that takes a whole prefix. */
  gte?: { field: string; value: unknown }
  lte?: { field: string; value: unknown }
  gt?: { field: string; value: unknown }
  /** `.take(n)`'s argument, or null for `.collect()`. A `.collect()` over an
   * unbounded prefix is the shape that eventually exceeds a transaction. */
  take: number | null
  /** Rows the fixture returned for this range — the documents actually read. */
  returned: number
}

/** What a recorded run cost. */
export type ReadCost = {
  reads: RecordedRead[]
  /** `ctx.db.get` calls. Convex charges each one separately — there is no
   * per-transaction document cache (measured) — so this is the N+1 counter and
   * the single most useful number here. */
  gets: number
  /** Distinct ids fetched. Below `gets` means the same document was fetched
   * twice, which is charged twice. */
  distinctGets: number
  /** Documents returned by index ranges, plus documents fetched by id — the
   * closest analogue to Convex's `documentsRead`. */
  documents: number
}

type Row = Record<string, unknown> & { _id: string }

/**
 * Builds a fake `QueryCtx` over an in-memory fixture.
 *
 * `tables` maps a table name to its rows; every row needs an `_id` so `get` can
 * find it. The returned `cost` is live — read it after the call under test.
 */
export function recordingCtx(tables: Record<string, Row[]>): {
  ctx: QueryCtx
  cost: ReadCost
} {
  const reads: RecordedRead[] = []
  const fetched: string[] = []

  const db = {
    query(table: string) {
      return {
        withIndex(index: string, build?: (q: unknown) => unknown) {
          const read: RecordedRead = { table, index, eq: [], take: null, returned: 0 }
          reads.push(read)

          // The builder Convex hands the callback. Each method records its bound
          // and returns itself, which is exactly the shape the real one has —
          // `eq` narrows to the next field, the range methods terminate.
          const builder = {
            eq(field: string, value: unknown) {
              read.eq.push({ field, value })
              return builder
            },
            gte(field: string, value: unknown) {
              read.gte = { field, value }
              return builder
            },
            lte(field: string, value: unknown) {
              read.lte = { field, value }
              return builder
            },
            gt(field: string, value: unknown) {
              read.gt = { field, value }
              return builder
            },
            lt(field: string, value: unknown) {
              read.lte = { field, value }
              return builder
            },
          }
          if (build) build(builder)

          const matching = () => {
            const rows = tables[table] ?? []
            return rows.filter((row) => {
              for (const bound of read.eq) {
                // `undefined` compares equal to an absent key, which is the
                // semantics Convex gives a missing optional field — and the
                // whole basis of the vote-scope migration's cursor-free walk.
                if (row[bound.field] !== bound.value) return false
              }
              if (read.gte && !ge(row[read.gte.field], read.gte.value)) return false
              if (read.lte && !le(row[read.lte.field], read.lte.value)) return false
              if (read.gt && !gt(row[read.gt.field], read.gt.value)) return false
              return true
            })
          }

          const finish = {
            async collect() {
              const rows = matching()
              read.returned = rows.length
              return rows
            },
            async take(n: number) {
              read.take = n
              const rows = matching().slice(0, n)
              read.returned = rows.length
              return rows
            },
            async unique() {
              const rows = matching()
              read.returned = rows.length
              if (rows.length > 1) throw new Error(`unique() matched ${rows.length} rows`)
              return rows[0] ?? null
            },
            async first() {
              const rows = matching().slice(0, 1)
              read.returned = rows.length
              return rows[0] ?? null
            },
            // `.order()` does not change what is read, only the direction, so it
            // is recorded as a pass-through. A cost assertion does not depend on
            // it; a semantics one would, and belongs elsewhere.
            order() {
              return finish
            },
          }
          return finish
        },
      }
    },
    async get(id: string) {
      fetched.push(id)
      for (const rows of Object.values(tables)) {
        const hit = rows.find((row) => row._id === id)
        if (hit) return hit
      }
      return null
    },
  }

  const cost: ReadCost = {
    reads,
    get gets() {
      return fetched.length
    },
    get distinctGets() {
      return new Set(fetched).size
    },
    get documents() {
      return reads.reduce((total, read) => total + read.returned, 0) + fetched.length
    },
  } as ReadCost

  // The cast is the price of a fake: `QueryCtx` carries auth and storage this
  // does not model, and the helpers under test take `ctx: QueryCtx` and touch
  // only `ctx.db`. Narrowing the helpers' parameter to "just the db" would push
  // a test-shaped type into production signatures, which is worse.
  return { ctx: { db } as unknown as QueryCtx, cost }
}

/**
 * Whether a read is bounded by a field — i.e. the index constrains it rather
 * than the handler filtering afterwards.
 *
 * The assertion most of these tests make. A read that does not fix
 * `wahlperiode` reads every period the member has ever sat in, and no amount of
 * filtering after the fact un-reads those documents.
 */
export function boundsOf(read: RecordedRead): string[] {
  const fields = read.eq.map((bound) => bound.field)
  for (const bound of [read.gte, read.lte, read.gt]) {
    if (bound && !fields.includes(bound.field)) fields.push(bound.field)
  }
  return fields
}

function ge(a: unknown, b: unknown): boolean {
  return a !== undefined && (a as string | number) >= (b as string | number)
}
function le(a: unknown, b: unknown): boolean {
  return a !== undefined && (a as string | number) <= (b as string | number)
}
function gt(a: unknown, b: unknown): boolean {
  return a !== undefined && (a as string | number) > (b as string | number)
}
