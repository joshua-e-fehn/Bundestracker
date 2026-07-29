import { describe, expect, test } from "bun:test"
import { activityDates } from "./activities"
import { boundsOf, recordingCtx } from "./lib/readRecorder.testing"
import { speechDates } from "./speeches"
import { ballotDates, voteParticipation, voteTallyByMonth } from "./votes"

/**
 * Read-cost regression tests for the scoring inputs.
 *
 * ## What these assert, and why it is not a return value
 *
 * The Convex account was disabled for exceeding a spending limit, and the
 * nightly sweep of 2026-07-27 died having read 32 002 documents to score 25
 * members. Every one of those reads returned the **right answer**: the old
 * `voteParticipation` computed a correct participation rate, and did so by
 * collecting the member's votes across every Wahlperiode they had ever sat in
 * and fetching a `voteSheets` row per record to find out which period each vote
 * belonged to.
 *
 * So a test that checks the number is a participation rate cannot catch the
 * regression that mattered. These check the *shape of the read* — which index,
 * bounded by which fields, and how many documents were fetched by id — because
 * that is the property that failed, and the property the next change has to
 * preserve.
 *
 * ## The fixture is deliberately cross-period
 *
 * Every member here holds records in WP20 as well as WP21, because that is the
 * condition under which the old code was wrong: `internalId` is stable across
 * periods by construction (convex/schema.ts), and three periods are live in
 * production. A single-period fixture would pass against the pre-fix code.
 *
 * See convex/lib/readRecorder.testing.ts for what the fake models and what it
 * does not.
 */

const WP21 = 21
const WP20 = 20

/** Two ballots in the scored month, one outside it, three in a previous period.
 * The member's career is 6 records; the WP21 answer is 3; the month's is 2. */
function voteFixture() {
  const sheets = [
    { _id: "sheet-a", wahlperiode: WP21, date: "2026-07-03" },
    { _id: "sheet-b", wahlperiode: WP21, date: "2026-07-21" },
    { _id: "sheet-c", wahlperiode: WP21, date: "2026-06-11" },
    { _id: "sheet-d", wahlperiode: WP20, date: "2023-05-04" },
    { _id: "sheet-e", wahlperiode: WP20, date: "2022-09-14" },
    { _id: "sheet-f", wahlperiode: WP20, date: "2021-11-30" },
  ]
  const voteRecords = sheets.map((sheet, index) => ({
    _id: `rec-${sheet._id}`,
    mpInternalId: "bt-0001",
    voteSheetId: sheet._id,
    // One absence in the scored month, so `cast` and `eligible` differ and a
    // test cannot pass by returning the row count twice.
    vote: index === 1 ? "absent" : "yes",
    wahlperiode: sheet.wahlperiode,
    date: sheet.date,
  }))
  return { voteSheets: sheets, voteRecords }
}

describe("voteParticipation reads only the period and window asked for", () => {
  test("the index range fixes the period and both date bounds", async () => {
    const { ctx, cost } = recordingCtx(voteFixture())
    await voteParticipation(ctx, "bt-0001", WP21, "2026-07-01", "2026-07-31")

    expect(cost.reads).toHaveLength(1)
    const [read] = cost.reads
    expect(read.table).toBe("voteRecords")
    expect(read.index).toBe("by_mpInternalId_and_wahlperiode_and_date")
    // All three columns constrain the read. Dropping `wahlperiode` here is
    // precisely the regression: the answer stays correct and the cost becomes
    // the member's whole career.
    expect(boundsOf(read)).toEqual(["mpInternalId", "wahlperiode", "date"])
  })

  test("no document is fetched by id — the N+1 is gone", async () => {
    const { ctx, cost } = recordingCtx(voteFixture())
    await voteParticipation(ctx, "bt-0001", WP21, "2026-07-01", "2026-07-31")

    // The measured signature of the old implementation was 10 270 voteRecords
    // beside 10 245 voteSheets — a 1:1 ratio, which is one `db.get` per record.
    // Convex charges every `get` separately (there is no per-transaction
    // document cache), so this counter is the whole of that 64 % of the sweep.
    expect(cost.gets).toBe(0)
  })

  test("it reads exactly the rows in the window, not the career", async () => {
    const { ctx, cost } = recordingCtx(voteFixture())
    const result = await voteParticipation(ctx, "bt-0001", WP21, "2026-07-01", "2026-07-31")

    // Two ballots in July 2026; one of them an absence.
    expect(result).toEqual({ rate: 0.5, cast: 1, eligible: 2 })
    // The member holds 6 records. The old shape read all 6 and fetched 6
    // sheets — 12 documents to answer about 2.
    expect(cost.documents).toBe(2)
  })

  test("the period total reads the period, not every period", async () => {
    const { ctx, cost } = recordingCtx(voteFixture())
    // `monthWindow(null)`'s bounds — the widest window the scorer ever asks for.
    const result = await voteParticipation(ctx, "bt-0001", WP21, "1949-01-01", "2999-12-31")

    expect(result.eligible).toBe(3)
    // Three WP21 records read; the three WP20 ones are outside the index range
    // rather than filtered out of the result.
    expect(cost.documents).toBe(3)
  })

  test("a record the scope backfill has not reached is absent, not mis-dated", async () => {
    // The pre-migration row shape: no `wahlperiode`, no `date`.
    const fixture = voteFixture()
    fixture.voteRecords.push({
      _id: "rec-unmigrated",
      mpInternalId: "bt-0001",
      voteSheetId: "sheet-a",
      vote: "yes",
    } as (typeof fixture.voteRecords)[number])

    const { ctx } = recordingCtx(fixture)
    const result = await voteParticipation(ctx, "bt-0001", WP21, "2026-07-01", "2026-07-31")

    // Still 2, not 3. Convex sorts a missing field below every value, so the row
    // falls outside `.eq("wahlperiode", 21)` rather than inside the wrong
    // period. The failure mode is an undercount that `backfillVoteRecordScope`
    // repairs, never a vote counted against the wrong Bundestag.
    expect(result.eligible).toBe(2)
  })
})

describe("voteTallyByMonth reads the period once", () => {
  test("one bounded index range, no sheet fetches", async () => {
    const { ctx, cost } = recordingCtx(voteFixture())
    const byMonth = await voteTallyByMonth(ctx, "bt-0001", WP21)

    expect([...byMonth.keys()].sort()).toEqual(["2026-06", "2026-07"])
    expect(byMonth.get("2026-07")).toEqual({
      yes: 1,
      no: 0,
      abstain: 0,
      invalid: 0,
      absent: 1,
    })
    expect(cost.reads).toHaveLength(1)
    expect(boundsOf(cost.reads[0])).toContain("wahlperiode")
    // The month came off the record's own `date`. Fetching the sheet for it is
    // what made the profile chart cost the member's career.
    expect(cost.gets).toBe(0)
  })
})

describe("speechVolume reads the period from the index", () => {
  const speeches = [
    {
      _id: "s1",
      mpInternalId: "bt-0001",
      wahlperiode: WP21,
      protocolDate: "2026-07-08",
      wordCount: 900,
    },
    {
      _id: "s2",
      mpInternalId: "bt-0001",
      wahlperiode: WP21,
      protocolDate: "2026-07-22",
      wordCount: 300,
    },
    {
      _id: "s3",
      mpInternalId: "bt-0001",
      wahlperiode: WP21,
      protocolDate: "2026-05-02",
      wordCount: 100,
    },
    {
      _id: "s4",
      mpInternalId: "bt-0001",
      wahlperiode: WP20,
      protocolDate: "2023-03-09",
      wordCount: 5000,
    },
    {
      _id: "s5",
      mpInternalId: "bt-0001",
      wahlperiode: WP20,
      protocolDate: "2022-01-19",
      wordCount: 4000,
    },
  ]

  test("the period is an index bound, not a filter applied afterwards", async () => {
    const { ctx, cost } = recordingCtx({ speeches })
    const rows = await speechDates(ctx, "bt-0001", WP21, "2026-07-01", "2026-07-31")

    expect(rows).toHaveLength(2)
    expect(boundsOf(cost.reads[0])).toEqual(["mpInternalId", "wahlperiode", "protocolDate"])
    expect(cost.documents).toBe(2)
  })

  test("the period total does not degenerate into the whole career", async () => {
    const { ctx, cost } = recordingCtx({ speeches })
    // The period-total window. Under the old index this bound nothing at all —
    // it is `1949-01-01…2999-12-31` — so the range was the member's every
    // speech and `wahlperiode` was checked in JS afterwards.
    const rows = await speechDates(ctx, "bt-0001", WP21, "1949-01-01", "2999-12-31")

    expect(rows).toHaveLength(3)
    // 3, not 5: the WP20 rows are never read.
    expect(cost.documents).toBe(3)
  })
})

describe("activityDates is period-and-window bounded", () => {
  const activities = [
    {
      _id: "a1",
      mpInternalId: "bt-0001",
      wahlperiode: WP21,
      date: "2026-07-04",
      aktivitaetsart: "Kleine Anfrage",
    },
    {
      _id: "a2",
      mpInternalId: "bt-0001",
      wahlperiode: WP21,
      date: "2026-02-14",
      aktivitaetsart: "Kleine Anfrage",
    },
    {
      _id: "a3",
      mpInternalId: "bt-0001",
      wahlperiode: WP20,
      date: "2022-07-04",
      aktivitaetsart: "Kleine Anfrage",
    },
  ]

  test("all three columns bound the read", async () => {
    const { ctx, cost } = recordingCtx({ activities })
    const rows = await activityDates(ctx, "bt-0001", WP21, "2026-07-01", "2026-07-31")

    expect(rows).toHaveLength(1)
    expect(boundsOf(cost.reads[0])).toEqual(["mpInternalId", "wahlperiode", "date"])
    expect(cost.gets).toBe(0)
  })
})

describe("the whole scoring gather, as the sweep performs it", () => {
  /**
   * The regression that took the deployment down, expressed as a budget.
   *
   * `recomputeScores` scores 8 members per transaction, and when a month is
   * given it writes two rows per member. The old implementation gathered every
   * source **twice** per member — once for the month, once for the period total,
   * over windows where the first is a subset of the second — on top of the
   * unbounded vote read and its N+1. Measured: ~1 280 documents per member,
   * 32 002 for 25.
   *
   * This asserts the two properties that number depended on: the period is read
   * once, and nothing is fetched by id. It is a *shape* budget rather than a
   * document count, because a document count would encode this fixture's size
   * rather than the property.
   */
  test("one read per source, and no fetch-by-id anywhere", async () => {
    const fixture = {
      ...voteFixture(),
      speeches: [
        {
          _id: "s1",
          mpInternalId: "bt-0001",
          wahlperiode: WP21,
          protocolDate: "2026-07-08",
          wordCount: 900,
        },
      ],
      activities: [
        {
          _id: "a1",
          mpInternalId: "bt-0001",
          wahlperiode: WP21,
          date: "2026-07-04",
          aktivitaetsart: "Kleine Anfrage",
        },
      ],
      committeeMemberships: [
        { _id: "c1", mpInternalId: "bt-0001", wahlperiode: WP21, committeeName: "Haushalt" },
      ],
    }
    const { ctx, cost } = recordingCtx(fixture)

    // What `gatherPeriod` does: each source read once, over the whole period.
    const whole = { from: "1949-01-01", to: "2999-12-31" }
    await Promise.all([
      activityDates(ctx, "bt-0001", WP21, whole.from, whole.to),
      speechDates(ctx, "bt-0001", WP21, whole.from, whole.to),
      ballotDates(ctx, "bt-0001", WP21, whole.from, whole.to),
    ])

    // Three sources, three reads. The month row is derived from these in memory
    // rather than re-read, which is what removed the doubling.
    expect(cost.reads).toHaveLength(3)
    for (const read of cost.reads) {
      expect(boundsOf(read)).toContain("wahlperiode")
    }
    expect(cost.gets).toBe(0)
  })

  test("every read names an index — none scans a table", async () => {
    const { ctx, cost } = recordingCtx(voteFixture())
    await ballotDates(ctx, "bt-0001", WP21, "1949-01-01", "2999-12-31")

    // A `.query(table)` with no `.withIndex` never reaches the recorder's
    // `withIndex` path, so an unindexed scan would record nothing at all — which
    // this catches as a missing read rather than as a cheap one.
    expect(cost.reads.length).toBeGreaterThan(0)
    for (const read of cost.reads) {
      expect(read.index).toBeTruthy()
      expect(read.eq.length).toBeGreaterThan(0)
    }
  })
})

/**
 * The scope migration's cursor-free walk.
 *
 * `backfillVoteRecordScope` has no cursor, and that is not a simplification —
 * it is a property of the index. Convex orders a missing field **below every
 * value** (`values/compare.ts` ranks `undefined` at 0, beneath `null`), so the
 * un-migrated rows occupy a contiguous prefix of `by_wahlperiode_and_date` and
 * `.eq("wahlperiode", undefined)` selects exactly them. A migrated row leaves
 * that range by being written, so each call simply asks for the next slice.
 *
 * Verified against a real Convex backend before it was relied on: a table of 200
 * migrated and 50 un-migrated rows returned exactly 50 for the `undefined`
 * range and only migrated rows for `.eq("wahlperiode", 21)`. These tests pin the
 * *consequence* — that the two ranges partition the table — so a future change
 * that starts writing `null` instead of omitting the key, or that reuses the
 * MP-keyed index here, fails rather than silently walking forever.
 */
describe("the vote-scope migration selects exactly the un-migrated rows", () => {
  /** Stated rather than inferred, because the migration's whole subject is a
   * row where these two keys are *absent* — an inferred union would type them
   * away and the test would stop compiling against the case it exists for. */
  type ScopeRow = {
    _id: string
    mpInternalId: string
    voteSheetId: string
    vote: string
    wahlperiode?: number
    date?: string
  }

  function mixedFixture(): {
    voteRecords: ScopeRow[]
    voteSheets: Array<Record<string, unknown> & { _id: string }>
  } {
    const migrated: ScopeRow[] = Array.from({ length: 8 }, (_, index) => ({
      _id: `mig-${index}`,
      mpInternalId: `bt-${index}`,
      voteSheetId: "sheet-a",
      vote: "yes",
      wahlperiode: WP21,
      date: "2026-07-03",
    }))
    // The pre-migration shape: the keys are *absent*, not null.
    const unmigrated: ScopeRow[] = Array.from({ length: 3 }, (_, index) => ({
      _id: `old-${index}`,
      mpInternalId: `bt-${index}`,
      voteSheetId: "sheet-a",
      vote: "yes",
    }))
    return {
      voteRecords: [...migrated, ...unmigrated],
      voteSheets: [{ _id: "sheet-a", wahlperiode: WP21, date: "2026-07-03" }],
    }
  }

  /** The range `backfillVoteRecordScope` and `voteScopeCoverage` both read. */
  async function pending(ctx: Parameters<typeof ballotDates>[0], take: number) {
    return await ctx.db
      .query("voteRecords")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", undefined))
      .take(take)
  }

  test("the undefined range returns the un-migrated rows and nothing else", async () => {
    const { ctx } = recordingCtx(mixedFixture())
    const rows = await pending(ctx, 500)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.wahlperiode === undefined)).toBe(true)
  })

  test("a migrated row leaves the range, which is why there is no cursor", async () => {
    const fixture = mixedFixture()
    const { ctx } = recordingCtx(fixture)
    expect(await pending(ctx, 500)).toHaveLength(3)

    // Simulate one slice's writes.
    for (const row of fixture.voteRecords) {
      if (row.wahlperiode === undefined) {
        row.wahlperiode = WP21
        row.date = "2026-07-03"
      }
    }
    // The walk terminates because the range empties, not because a counter ran
    // out. A crashed run resumes by being run again.
    expect(await pending(ctx, 500)).toHaveLength(0)
  })

  test("the period range and the undefined range partition the table", async () => {
    const fixture = mixedFixture()
    const { ctx } = recordingCtx(fixture)
    const unmigrated = await pending(ctx, 500)
    const inPeriod = await ctx.db
      .query("voteRecords")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", WP21))
      .take(500)

    // No row in both, and every row in one — so nothing is migrated twice and
    // nothing is left invisible to both the migration and the readers.
    expect(unmigrated.length + inPeriod.length).toBe(fixture.voteRecords.length)
    const ids = new Set(inPeriod.map((row) => row._id))
    expect(unmigrated.some((row) => ids.has(row._id))).toBe(false)
  })

  test("coverage is complete only when the range is empty", async () => {
    const fixture = mixedFixture()
    const { ctx } = recordingCtx(fixture)
    // What `voteScopeCoverage` reports, and the check the post-deploy
    // verification runs: `remaining` is capped rather than counted, because
    // counting a whole table is the shape of read this branch exists to remove.
    expect((await pending(ctx, 500)).length === 0).toBe(false)
    for (const row of fixture.voteRecords) row.wahlperiode = WP21
    expect((await pending(ctx, 500)).length === 0).toBe(true)
  })
})
