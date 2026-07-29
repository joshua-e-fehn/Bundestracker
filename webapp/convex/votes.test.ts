import { describe, expect, test } from "bun:test"
import { recordingCtx } from "./lib/readRecorder.testing"
import {
  backfillVoteSheetVorgang,
  backfillVoteSheetVorgangHandler,
  breakdownRows,
  chunk,
  classifyVorgangPatch,
  decideVorgangPage,
  dissentFlagsFor,
  dissentWriteKeys,
  isRebel,
  majorityOf,
  TALLY_SLICE,
  tallyByGroup,
  type VorgangPageRow,
  vorgangPageFetchSize,
  voteSheetsMissingVorgang,
  voteSheetsMissingVorgangHandler,
} from "./votes"

/**
 * Tests for the group-line rules behind rebel highlighting.
 *
 * These four functions decide, for every row of a 630-line ballot, whether the
 * page prints "Abweichung" beside someone's name. That is a claim about a named
 * person's conduct, so the interesting cases are the ones where the honest
 * answer is *no claim at all* — a tied group, a group nobody voted in, an
 * absence. Each of those has a plausible wrong implementation that produces a
 * confident accusation instead, and none of them throws: the failure mode is a
 * page that looks entirely normal while libelling a backbencher.
 *
 * `tallyByGroup` and `breakdownRows` are pure and exported for exactly this
 * reason — the query handlers around them need a database, but the rule they
 * apply does not.
 */

/** A record as `tallyByGroup` reads one. */
function record(
  mpInternalId: string,
  vote: Parameters<typeof isRebel>[0],
  partyAtVote: string | null,
) {
  return { mpInternalId, vote, partyAtVote }
}

/** No record carries a group, so the roster fallback decides — the arm that
 * only fires for sheets missing `partyAtVote`. */
const noFallback = () => ""

describe("majorityOf", () => {
  test("the modal cast vote wins, with its share of votes cast", () => {
    expect(majorityOf(["yes", "yes", "no"])).toEqual({ vote: "yes", share: 2 / 3 })
  })

  test("an absence is not a position and is not in the denominator", () => {
    // Six absent, two voting yes, one no. If absences counted, the "line" would
    // be `absent` — reporting "the group did not vote" as the position an MP
    // defied, which is a claim the sheet does not make.
    const votes = majorityOf([
      "absent",
      "absent",
      "absent",
      "absent",
      "absent",
      "absent",
      "yes",
      "yes",
      "no",
    ])
    expect(votes).toEqual({ vote: "yes", share: 2 / 3 })
  })

  test("an exact tie is a split, not a line", () => {
    expect(majorityOf(["yes", "no"])).toBeNull()
    expect(majorityOf(["yes", "yes", "no", "no"])).toBeNull()
  })

  test("a group where nobody cast a vote has no line", () => {
    expect(majorityOf([])).toBeNull()
    expect(majorityOf(["absent", "absent"])).toBeNull()
  })

  test("abstain and invalid are positions that can win", () => {
    // `Enthaltung` is a vote cast — the MP was present and chose — so a group
    // that mostly abstained has abstention as its line.
    expect(majorityOf(["abstain", "abstain", "yes"])).toEqual({ vote: "abstain", share: 2 / 3 })
  })
})

describe("isRebel", () => {
  test("a cast vote against a real majority is a dissent", () => {
    expect(isRebel("no", { vote: "yes", share: 0.9 })).toBe(true)
  })

  test("voting the line is not", () => {
    expect(isRebel("yes", { vote: "yes", share: 0.9 })).toBe(false)
  })

  test("an absence is never a dissent", () => {
    // Missing a sitting is not defiance. Without this, every MP on parental
    // leave would be highlighted as voting against their group.
    expect(isRebel("absent", { vote: "yes", share: 0.9 })).toBe(false)
  })

  test("no majority means nothing to dissent from", () => {
    expect(isRebel("no", null)).toBe(false)
  })
})

describe("dissentFlagsFor", () => {
  const line = { vote: "yes" as const, share: 0.9 }

  test("a vote against the line is a dissent, and is counted", () => {
    expect(dissentFlagsFor("no", line)).toEqual({ dissent: true, counted: true })
  })

  test("a vote with the line is counted and is not a dissent", () => {
    expect(dissentFlagsFor("yes", line)).toEqual({ dissent: false, counted: true })
  })

  test("an absence is not a dissent and is not in the denominator", () => {
    // The distinction the whole tally turns on. Counting an absence in the
    // denominator inflates every member's `ballotsCast` by the sittings they
    // missed, which deflates every rate on the site — invisibly, because no
    // number looks wrong.
    expect(dissentFlagsFor("absent", line)).toEqual({ dissent: false, counted: false })
  })

  test("a group with no line puts the vote in neither half of the fraction", () => {
    // A tie, a group nobody voted in, or no group on the record: there was no
    // line to keep, so keeping it is not a fact about this member.
    expect(dissentFlagsFor("yes", null)).toEqual({ dissent: false, counted: false })
    expect(dissentFlagsFor("no", null)).toEqual({ dissent: false, counted: false })
  })

  test("counted is not the negation of dissent", () => {
    // Three situations give `dissent: false` and only one of them is counted.
    // Written as its own assertion because `counted = !dissent` passes every
    // test above except this one.
    const withLine = dissentFlagsFor("yes", line)
    const absent = dissentFlagsFor("absent", line)
    const noLine = dissentFlagsFor("yes", null)
    expect([withLine.dissent, absent.dissent, noLine.dissent]).toEqual([false, false, false])
    expect([withLine.counted, absent.counted, noLine.counted]).toEqual([true, false, false])
  })

  test("abstain and invalid are cast votes that can dissent", () => {
    // `Enthaltung` is a position — the member was present and chose — so
    // abstaining against a `yes` line is a dissent, not an absence.
    expect(dissentFlagsFor("abstain", line)).toEqual({ dissent: true, counted: true })
    expect(dissentFlagsFor("invalid", line)).toEqual({ dissent: true, counted: true })
    // And where abstention *is* the line, voting yes breaks it.
    const abstained = { vote: "abstain" as const, share: 0.8 }
    expect(dissentFlagsFor("abstain", abstained)).toEqual({ dissent: false, counted: true })
    expect(dissentFlagsFor("yes", abstained)).toEqual({ dissent: true, counted: true })
  })

  test("agrees with isRebel on every position", () => {
    // The two must not drift: the stored flag and the badge on the ballot page
    // are the same claim, and this is the assertion that keeps them one rule.
    for (const vote of ["yes", "no", "abstain", "invalid", "absent"] as const) {
      for (const majority of [line, null]) {
        expect(dissentFlagsFor(vote, majority).dissent).toBe(isRebel(vote, majority))
      }
    }
  })
})

describe("tallyByGroup", () => {
  test("groups by the ballot's own party, not the current roster", () => {
    // §6.4: six WP21 MPs changed Fraktion mid-period. A March vote belongs to
    // the group they sat with in March — reading it against their July group
    // would manufacture a dissent that never happened.
    const groups = tallyByGroup(
      [record("bt-1", "yes", "SPD"), record("bt-2", "yes", "SPD"), record("bt-3", "no", "CDU/CSU")],
      // The roster disagrees with every record on purpose.
      () => "Fraktionslos",
    )
    expect([...groups.keys()].sort()).toEqual(["CDU/CSU", "SPD"])
    expect(groups.get("SPD")?.majority).toEqual({ vote: "yes", share: 1 })
  })

  test("falls back to the roster only where the sheet carries no group", () => {
    const groups = tallyByGroup([record("bt-1", "yes", null)], () => "SPD")
    expect(groups.get("SPD")?.counts.yes).toBe(1)
  })

  test("a record with no group anywhere is left out of the breakdown", () => {
    // It is a real vote, but not one any caucus cast, so it belongs in the
    // ballot's totals and in no group's row.
    const groups = tallyByGroup([record("bt-1", "yes", null)], noFallback)
    expect(groups.size).toBe(0)
  })

  test("counts every position, absences included", () => {
    const groups = tallyByGroup(
      [
        record("bt-1", "yes", "SPD"),
        record("bt-2", "no", "SPD"),
        record("bt-3", "abstain", "SPD"),
        record("bt-4", "invalid", "SPD"),
        record("bt-5", "absent", "SPD"),
      ],
      noFallback,
    )
    expect(groups.get("SPD")?.counts).toEqual({
      yes: 1,
      no: 1,
      abstain: 1,
      invalid: 1,
      absent: 1,
    })
    // Four cast votes, one each — a four-way tie, so no line.
    expect(groups.get("SPD")?.majority).toBeNull()
  })
})

describe("breakdownRows", () => {
  const rows = (records: ReturnType<typeof record>[]) =>
    breakdownRows(tallyByGroup(records, noFallback))

  test("cast excludes absences; total includes them", () => {
    const [row] = rows([
      record("bt-1", "yes", "SPD"),
      record("bt-2", "yes", "SPD"),
      record("bt-3", "absent", "SPD"),
    ])
    expect(row.total).toBe(3)
    expect(row.cast).toBe(2)
    expect(row.majority).toEqual({ vote: "yes", share: 1 })
  })

  test("rebels are the cast votes that are not the line", () => {
    const [row] = rows([
      record("bt-1", "yes", "SPD"),
      record("bt-2", "yes", "SPD"),
      record("bt-3", "yes", "SPD"),
      record("bt-4", "no", "SPD"),
      // The absence must not be counted as a fifth dissenter.
      record("bt-5", "absent", "SPD"),
    ])
    expect(row.rebels).toBe(1)
  })

  test("a split group has no line and therefore no rebels", () => {
    // The case that matters most: with a naive "everyone not voting with the
    // plurality" rule, an evenly split group would report half its members as
    // rebels against a position the group never took.
    const [row] = rows([record("bt-1", "yes", "SPD"), record("bt-2", "no", "SPD")])
    expect(row.majority).toBeNull()
    expect(row.rebels).toBe(0)
  })

  test("a group that was entirely absent has no rebels", () => {
    const [row] = rows([record("bt-1", "absent", "SPD"), record("bt-2", "absent", "SPD")])
    expect(row.cast).toBe(0)
    expect(row.majority).toBeNull()
    expect(row.rebels).toBe(0)
  })

  test("ordered by size, largest first", () => {
    // §9 puts CDU/CSU at 209 seats and fraktionslos at 3; alphabetical order
    // would open the table on the three.
    const ordered = rows([
      record("bt-1", "yes", "Fraktionslos"),
      record("bt-2", "yes", "SPD"),
      record("bt-3", "yes", "SPD"),
      record("bt-4", "yes", "CDU/CSU"),
      record("bt-5", "yes", "CDU/CSU"),
      record("bt-6", "yes", "CDU/CSU"),
    ])
    expect(ordered.map((row) => row.fraktion)).toEqual(["CDU/CSU", "SPD", "Fraktionslos"])
  })

  test("equal-sized groups fall back to name order, so renders are stable", () => {
    const ordered = rows([record("bt-1", "yes", "SPD"), record("bt-2", "yes", "AfD")])
    expect(ordered.map((row) => row.fraktion)).toEqual(["AfD", "SPD"])
  })

  test("rebel counts agree with isRebel over the same records", () => {
    // The two are computed by different routes — one from the tally, one per
    // record — and the page uses both: `rebels` in the group summary, `rebel`
    // on each row. A disagreement would show as a summary saying "2" above a
    // table highlighting three names.
    const records = [
      record("bt-1", "yes", "SPD"),
      record("bt-2", "yes", "SPD"),
      record("bt-3", "yes", "SPD"),
      record("bt-4", "no", "SPD"),
      record("bt-5", "abstain", "SPD"),
      record("bt-6", "absent", "SPD"),
    ]
    const groups = tallyByGroup(records, noFallback)
    const majority = groups.get("SPD")?.majority ?? null
    const perRecord = records.filter((entry) => isRebel(entry.vote, majority)).length
    expect(breakdownRows(groups)[0].rebels).toBe(perRecord)
    expect(perRecord).toBe(2)
  })
})

/**
 * The write-partitioning invariant behind the dissent tally.
 *
 * ## What went wrong, and why a test rather than a comment
 *
 * `refreshBallotDissent` used to write the period tally as well as the flags:
 * one transaction reading and patching up to 630 `dissentTallies` rows. Two
 * ballots refreshed at once therefore overlapped on every member in the chamber,
 * and every one of those rows was also read whole by the leaderboard. Convex is
 * optimistic, so overlapping write sets are retried — and a retry re-reads and
 * re-writes all 630.
 *
 * The fix moves the roll-up to a mutation keyed by *member*, so a call's write
 * set is exactly the members it names. That property is what makes two
 * concurrent slices non-conflicting, and it is invisible in any output: the
 * arithmetic is idempotent, so a slicing bug that put one member in two
 * transactions would still produce the right final numbers, more slowly and
 * under contention. Nothing would look wrong. So it is asserted here.
 *
 * Contention itself is not asserted — it cannot be, without a real backend
 * scheduling real transactions (the open-source binary serialises writes, so
 * even there the wall-clock gap is not the signal). What is asserted is the
 * structural precondition: disjoint inputs produce disjoint write sets.
 */
describe("dissent tally write partitioning", () => {
  test("a slice's write set is exactly the members it names", () => {
    const keys = dissentWriteKeys(21, ["bt-1", "bt-2", "bt-3"])
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
  })

  test("disjoint member sets produce disjoint write sets", () => {
    // The whole point. Two slices that share no member share no document, so
    // they cannot conflict — which is what the ballot-keyed writer could not
    // offer, since its key was a ballot and its rows were keyed by member.
    const a = dissentWriteKeys(21, ["bt-1", "bt-2"])
    const b = dissentWriteKeys(21, ["bt-3", "bt-4"])
    expect(a.filter((key) => b.includes(key))).toEqual([])
  })

  test("the same member in two periods is two rows, not one", () => {
    // `internalId` is stable across periods (convex/schema.ts), so the period
    // has to be part of the key or a WP20 roll-up would clobber a WP21 one.
    const a = dissentWriteKeys(21, ["bt-1"])
    const b = dissentWriteKeys(20, ["bt-1"])
    expect(a[0]).not.toBe(b[0])
  })

  test("chunking a roster partitions it — no member in two slices, none dropped", () => {
    // The invariant a chunking bug would break silently: an off-by-one that
    // overlapped slices would put one member in two concurrent transactions,
    // reintroducing the contention while still arriving at the correct tally.
    const roster = Array.from({ length: 635 }, (_, index) => `bt-${String(index).padStart(4, "0")}`)
    const slices = chunk(roster, TALLY_SLICE)

    const seen = new Set<string>()
    for (const slice of slices) {
      expect(slice.length).toBeLessThanOrEqual(TALLY_SLICE)
      for (const member of slice) {
        // Fails on any overlap between slices.
        expect(seen.has(member)).toBe(false)
        seen.add(member)
      }
    }
    // And fails on any member dropped.
    expect(seen.size).toBe(roster.length)
    expect(slices.flat()).toEqual(roster)
  })

  test("every slice stays inside the transaction ceiling", () => {
    // `recomputeDissentTallies` rejects a longer list rather than truncating —
    // a silently shortened slice leaves tallies stale with nothing to say so.
    const roster = Array.from({ length: 772 }, (_, index) => `bt-${index}`)
    for (const slice of chunk(roster, TALLY_SLICE)) {
      expect(slice.length).toBeGreaterThan(0)
      expect(slice.length).toBeLessThanOrEqual(TALLY_SLICE)
    }
  })

  test("an empty roster chunks to nothing rather than to one empty slice", () => {
    // A slice of zero members would schedule a transaction that writes nothing —
    // harmless, but it would make `mpsRolledUp` non-zero for a period with no
    // roster, which is the one signal the backfill's caller reports.
    expect(chunk([], TALLY_SLICE)).toEqual([])
  })
})

/**
 * The tally arithmetic, as `recomputeDissentTallies` performs it.
 *
 * Derived from the stored flags rather than accumulated, which is what makes it
 * idempotent — and idempotence is what makes an OCC retry, a duplicate schedule
 * and a nightly re-ingest all harmless. The delta form this replaces was correct
 * only if applied exactly once, and that requirement is what forced the tally
 * write into the ballot's transaction in the first place.
 */
describe("dissent tallies derived from stored flags", () => {
  /** The counting loop in `recomputeDissentTallies`, as a pure function. */
  function tallyOf(records: Array<{ dissent?: boolean; dissentCounted?: boolean }>) {
    let dissents = 0
    let ballotsCast = 0
    for (const record of records) {
      if (record.dissentCounted === true) ballotsCast++
      if (record.dissent === true) dissents++
    }
    return { dissents, ballotsCast, dissentRate: ballotsCast === 0 ? 0 : dissents / ballotsCast }
  }

  test("counts the flags, and the denominator is not 'not a dissent'", () => {
    const tally = tallyOf([
      { dissent: false, dissentCounted: true }, // voted the line
      { dissent: true, dissentCounted: true }, // broke the line
      { dissent: false, dissentCounted: false }, // absent — no opportunity
      { dissent: false, dissentCounted: false }, // group had no line
    ])
    // 1 of 2, not 1 of 4. Folding the last two into the denominator deflates
    // every rate on the site without any number looking wrong — see
    // `dissentFlagsFor`.
    expect(tally).toEqual({ dissents: 1, ballotsCast: 2, dissentRate: 0.5 })
  })

  test("an unset flag is 'not computed', not a loyal vote", () => {
    // A record the backfill has not reached carries neither flag. Counting it as
    // `dissentCounted` would put a ballot nobody has assessed into the
    // denominator, understating the rate of every member mid-migration.
    const tally = tallyOf([{ dissent: true, dissentCounted: true }, {}, {}])
    expect(tally).toEqual({ dissents: 1, ballotsCast: 1, dissentRate: 1 })
  })

  test("recomputing is a no-op — the reason retries are safe", () => {
    const records = [
      { dissent: true, dissentCounted: true },
      { dissent: false, dissentCounted: true },
    ]
    // Three passes over unchanged flags. A delta-based tally would read 1, 2, 3.
    expect(tallyOf(records)).toEqual(tallyOf(records))
    expect(tallyOf(records).dissents).toBe(1)
  })

  test("a member with no countable ballot is a zeroed row, not a missing one", () => {
    // Zero is written rather than skipped: `purgeSeedData` and the leaderboard
    // both expect to find a row. `lib/dissent.ts` reads `ballotsCast` to tell
    // "never dissented" from "never voted", which is why the rate being 0 here
    // is not the ambiguity it looks like.
    expect(tallyOf([{ dissent: false, dissentCounted: false }])).toEqual({
      dissents: 0,
      ballotsCast: 0,
      dissentRate: 0,
    })
  })

  test("it cannot go negative, so it needs no clamp", () => {
    // The old delta form clamped at zero because an over-applied subtraction
    // could print a negative dissent count on a public leaderboard. A count of
    // stored flags has no such failure mode: the floor is an empty record set.
    expect(tallyOf([]).dissents).toBe(0)
    expect(tallyOf([]).ballotsCast).toBe(0)
  })
})

// --- L3 backfill-vote-vorgang — the shape assertions ---------------------

/** The JSON schema Convex builds from the runtime `args:` / `returns:` on a
 * function. It carries `type`, `value` for objects, and `fieldType` for
 * arrays — the shape the tests below key on. Convex's `internalMutation` and
 * `internalQuery` expose these as `exportArgs()` / `exportReturns()` at
 * runtime. */
type ConvexSchema = {
  type: string
  value?: Record<string, { fieldType: ConvexSchema; optional?: boolean }>
  values?: ConvexSchema[]
}

function argsSchema(fn: unknown): ConvexSchema {
  return JSON.parse((fn as { exportArgs: () => string }).exportArgs())
}

function returnsSchema(fn: unknown): ConvexSchema {
  return JSON.parse((fn as { exportReturns: () => string }).exportReturns())
}

describe("backfillVoteSheetVorgang: the mutation cannot write null", () => {
  test("each patch's dipVorgangId is a plain string, not nullable", () => {
    // This is the shape of the M2 invariant, held one level lower. The M2
    // failure was `dipVorgangId: null` overwriting a resolved link; the L3
    // route exists precisely so late resolutions can be patched in without
    // going near that path. Accepting a nullable dipVorgangId here would
    // let a caller silently erase what M2 protects on the ingest side.
    const args = argsSchema(backfillVoteSheetVorgang)
    // args.patches is an array; the element is an object; look up its
    // `dipVorgangId` field's schema and assert it is exactly `string`.
    const patchesField = args.value?.patches.fieldType
    // Convex encodes v.array(...) as { type: "array", value: <element> }.
    const element = (patchesField as unknown as { value: ConvexSchema }).value
    const dipVorgangId = element.value?.dipVorgangId.fieldType
    expect(dipVorgangId?.type).toBe("string")
    expect(dipVorgangId?.values).toBeUndefined()
  })

  test("patches are scoped by wahlperiode, so a WP20 sitting cannot alias WP21", () => {
    // The natural key is only unique within a period, so scoping is the whole
    // safety of the ballot lookup. A shortcut that took `(sitzungnr,
    // abstimmnr)` alone would silently patch the wrong ballot in another
    // period the moment two shared a sitting number.
    const args = argsSchema(backfillVoteSheetVorgang)
    expect(args.value?.wahlperiode.fieldType.type).toBe("number")
  })
})

describe("voteSheetsMissingVorgang: the read shape only carries the ballot key + tally", () => {
  test("each returned sheet has the four fields the client-side join needs and nothing else", () => {
    // The join key is `(sitzungnr, yes, no, abstain)` — that is what
    // `_ballot_vorgaenge` is indexed by. Returning the whole `voteSheets` row
    // would drag `title`, `sourceUrl`, `absentCount` and the rest across the
    // wire on every backfill page; the L3 pipeline needs none of them.
    const returns = returnsSchema(voteSheetsMissingVorgang)
    const sheetsField = returns.value?.sheets.fieldType
    const element = (sheetsField as unknown as { value: ConvexSchema }).value
    expect(Object.keys(element.value ?? {}).sort()).toEqual([
      "abstainCount",
      "abstimmnr",
      "noCount",
      "sitzungnr",
      "yesCount",
    ])
  })

  test("nextCursor is nullable, so a caller can page to exhaustion", () => {
    // The end signal is null, not absent — Convex's optional/undefined
    // handling is what M2 uses to preserve fields, and reusing that same
    // convention here would make an empty page indistinguishable from an
    // exhausted one.
    const returns = returnsSchema(voteSheetsMissingVorgang)
    const cursor = returns.value?.nextCursor.fieldType
    expect(cursor?.type).toBe("union")
    const kinds = (cursor?.value as unknown as ConvexSchema[] | undefined)?.map((m) => m.type)
    expect(kinds?.sort()).toEqual(["null", "object"])
  })
})

// --- L3 pagination — NEW-H2 / NEW-M3 behavioural tests --------------------

/** Small helper — every row is unresolved by default, so the test stays about
 * paging rather than boilerplating `dipVorgangId: null` on every input. */
function unresolved(sitzungnr: number, abstimmnr: number): VorgangPageRow {
  return { sitzungnr, abstimmnr, yesCount: 0, noCount: 0, abstainCount: 0, dipVorgangId: null }
}

function resolved(sitzungnr: number, abstimmnr: number): VorgangPageRow {
  return { sitzungnr, abstimmnr, yesCount: 0, noCount: 0, abstainCount: 0, dipVorgangId: "V" }
}

/** Emulates the caller-side loop over `decideVorgangPage`, threading the
 * cursor through and re-computing the `.gte`-scan for each iteration exactly
 * the way the fixed handler does. The tests below assert on the *complete*
 * sequence returned, so a page-boundary drop shows up as a missing row in
 * the concatenated result. */
function walk(allRows: VorgangPageRow[], limit: number): VorgangPageRow[] {
  const fetchSize = vorgangPageFetchSize(limit)
  const seen: VorgangPageRow[] = []
  let cursor: { sitzungnr: number; abstimmnr: number } | undefined
  // Safety net — a bug in `decideVorgangPage` can page forever; every test
  // case below converges well inside 20 pages, so hitting the cap is itself
  // a regression signal (and produces a readable failure message).
  for (let step = 0; step < 20; step++) {
    const scan = cursor
      ? allRows.filter((row) => row.sitzungnr >= cursor!.sitzungnr)
      : allRows.slice()
    const rows = scan.slice(0, fetchSize)
    const decision = decideVorgangPage(rows, cursor, limit, rows.length >= fetchSize)
    seen.push(...decision.sheets)
    if (decision.done || decision.nextCursor === null) return seen
    cursor = decision.nextCursor
  }
  throw new Error("decideVorgangPage did not converge after 20 pages")
}

describe("decideVorgangPage: unresolved sheets survive page boundaries", () => {
  test("three unresolved sheets in one sitting are all returned across three pages", () => {
    // The exact case NEW-H2 named: `(90,1)`, `(90,2)`, `(90,3)`, all
    // unresolved, `limit: 1`. Before the fix, the third row was lost when
    // the cursor advanced past sitting 90 with `.gt`. This walk asserts the
    // fix returns all three.
    const rows = [unresolved(90, 1), unresolved(90, 2), unresolved(90, 3)]
    const seen = walk(rows, 1)
    expect(seen.map((r) => [r.sitzungnr, r.abstimmnr])).toEqual([
      [90, 1],
      [90, 2],
      [90, 3],
    ])
  })

  test("a resolved sheet in the middle of a sitting does not evict its unresolved siblings", () => {
    // NEW-M3: the prior code cursored from `rows[limit]`, which could be a
    // *resolved* row. Once `.gte` includes the boundary sitting, that
    // cursor would skip any unresolved sheet in the same sitting between
    // the returned tail and the resolved boundary row. This walk pins the
    // rule that the cursor never advances past an unresolved sheet.
    const rows = [unresolved(90, 1), resolved(90, 2), unresolved(90, 3), unresolved(90, 4)]
    const seen = walk(rows, 1)
    expect(seen.map((r) => [r.sitzungnr, r.abstimmnr])).toEqual([
      [90, 1],
      [90, 3],
      [90, 4],
    ])
  })

  test("a run of resolved sheets is scanned through without skipping the next unresolved", () => {
    // The "over-fetch" case: a long run of resolved sheets between two
    // unresolved ones. The handler's over-fetch factor lets the client
    // filter drop the resolved tail; if the fetch runs out before the
    // second unresolved, the cursor must advance from the last raw row
    // (not a resolved row inside it) so the next page picks up from past
    // the last thing scanned.
    const rows = [
      unresolved(90, 1),
      resolved(90, 2),
      resolved(90, 3),
      resolved(90, 4),
      resolved(90, 5),
      resolved(90, 6),
      resolved(90, 7),
      resolved(90, 8),
      unresolved(90, 9),
      unresolved(91, 1),
    ]
    const seen = walk(rows, 1)
    expect(seen.map((r) => [r.sitzungnr, r.abstimmnr])).toEqual([
      [90, 1],
      [90, 9],
      [91, 1],
    ])
  })

  test("a sitting boundary between two returned pages loses no unresolved rows", () => {
    // Cross-sitting equivalent of the first test: `(90,3)`, `(91,1)`,
    // `(91,2)`, all unresolved, `limit: 1`. Every row must appear.
    const rows = [unresolved(90, 3), unresolved(91, 1), unresolved(91, 2)]
    const seen = walk(rows, 1)
    expect(seen.map((r) => [r.sitzungnr, r.abstimmnr])).toEqual([
      [90, 3],
      [91, 1],
      [91, 2],
    ])
  })

  test("done-on-empty: an empty scan returns nothing and terminates", () => {
    const decision = decideVorgangPage([], undefined, 5, false)
    expect(decision.sheets).toEqual([])
    expect(decision.nextCursor).toBeNull()
    expect(decision.done).toBe(true)
  })

  test("a scan of only resolved rows returns nothing and terminates", () => {
    // The whole page was resolved. `fetchExhausted=false` means the scan
    // saw them all, so `done=true` — no cursor to advance to, and no
    // unresolved to return.
    const decision = decideVorgangPage(
      [resolved(90, 1), resolved(90, 2), resolved(91, 1)],
      undefined,
      5,
      false,
    )
    expect(decision.sheets).toEqual([])
    expect(decision.done).toBe(true)
  })

  test("the cursor never lands on a resolved row's key", () => {
    // Walk every intermediate cursor decideVorgangPage returns across a
    // mixed set. None of them may equal a resolved sheet's key — that was
    // the exact NEW-M3 bug, and letting a resolved key become the cursor
    // opens the door back up.
    const rows = [
      unresolved(90, 1),
      resolved(90, 2),
      unresolved(90, 3),
      resolved(91, 1),
      unresolved(91, 2),
    ]
    const resolvedKeys = new Set(
      rows
        .filter((row) => row.dipVorgangId != null)
        .map((row) => `${row.sitzungnr}:${row.abstimmnr}`),
    )
    let cursor: { sitzungnr: number; abstimmnr: number } | undefined
    for (let step = 0; step < 20; step++) {
      const scan = cursor ? rows.filter((r) => r.sitzungnr >= cursor!.sitzungnr) : rows
      const decision = decideVorgangPage(scan, cursor, 1, false)
      if (decision.nextCursor === null) return
      expect(resolvedKeys).not.toContain(
        `${decision.nextCursor.sitzungnr}:${decision.nextCursor.abstimmnr}`,
      )
      cursor = decision.nextCursor
    }
    throw new Error("decideVorgangPage did not converge after 20 pages")
  })
})

// --- L3 mutation — NEW-L2 behavioural coverage of the four outcomes -------

describe("classifyVorgangPatch: the four outcomes", () => {
  test("an unknown sheet returns 'unknown', never a silent write", () => {
    // The (sitzungnr, abstimmnr) named a sheet the period does not carry.
    // This counter is what tells an operator the pipeline's map went past
    // what the deployment holds — a data corruption if it were to write
    // rather than count.
    expect(classifyVorgangPatch(null, "V")).toBe("unknown")
  })

  test("an absent stored dipVorgangId is patched with the incoming value", () => {
    // The intended write path: a ballot ingested before its referring
    // Vorgangsposition surfaced — dipVorgangId absent — receives the value
    // the referral walk just resolved.
    expect(classifyVorgangPatch({}, "V")).toBe("patched")
    // `null` and absent must classify identically; the schema keeps the
    // column `v.optional(v.union(v.null(), v.string()))` and the read
    // normaliser flattens absent to null. A regression that treats them
    // differently reintroduces the M2 boundary.
    expect(classifyVorgangPatch({ dipVorgangId: null }, "V")).toBe("patched")
  })

  test("a stored value equal to the incoming value is 'unchanged' — idempotent", () => {
    // Rerunning the L3 CLI on a fully-repaired period must be a no-op. If
    // this classified as 'patched' instead, a re-run would tick the
    // counter forever and the operator would never know they were done.
    expect(classifyVorgangPatch({ dipVorgangId: "V" }, "V")).toBe("unchanged")
  })

  test("a stored value that differs from the incoming value is 'conflict' — never overwritten", () => {
    // The re-attribution case. A ballot's stored Vorgang differs from what
    // this walk resolved. The mutation refuses to overwrite; the counter
    // signals the operator, and a real re-attribution needs to be a
    // deliberate migration, not a side effect of running the backfill.
    expect(classifyVorgangPatch({ dipVorgangId: "V" }, "OTHER")).toBe("conflict")
  })

  test("the classification is total over the state space — every input is one of the four", () => {
    // Prevents a fifth outcome sneaking in as `undefined`, which would
    // crash the counter increment in the mutation. Enumerated rather than
    // asserted structurally so a rename ("patch" → "created") fails here
    // rather than at runtime.
    const outcomes = new Set(["patched", "unchanged", "conflict", "unknown"])
    for (const input of [
      null,
      {},
      { dipVorgangId: null },
      { dipVorgangId: "V" },
      { dipVorgangId: "OTHER" },
    ]) {
      expect(outcomes.has(classifyVorgangPatch(input, "V"))).toBe(true)
    }
  })
})

// --- voteSheetsMissingVorgang handler — real ctx wiring assertions --------

/** The subset of `voteSheets` a `recordingCtx` fixture needs. `_id` is
 * required by the fake DB for `get`; every other field maps to what the
 * handler and its filter actually read. */
type SheetFixture = {
  _id: string
  wahlperiode: number
  sitzungnr: number
  abstimmnr: number
  yesCount: number
  noCount: number
  abstainCount: number
  dipVorgangId?: string | null
}

function fixtureSheet(
  overrides: Partial<SheetFixture> & Pick<SheetFixture, "sitzungnr" | "abstimmnr">,
): SheetFixture {
  return {
    _id: `sheet-${overrides.sitzungnr}-${overrides.abstimmnr}`,
    wahlperiode: 21,
    yesCount: 500,
    noCount: 100,
    abstainCount: 5,
    dipVorgangId: null,
    ...overrides,
  }
}

// The extracted handler function — not the internalQuery wrapper — so the
// tests do not print Convex's "should not directly call other Convex
// functions" warning. `_generated/server`'s `QueryCtx` is what the handler
// signature actually asks for; the fake from `recordingCtx` implements the
// subset it uses.
const missingVorgangHandler = voteSheetsMissingVorgangHandler as unknown as (
  ctx: unknown,
  args: { wahlperiode: number; cursor?: { sitzungnr: number; abstimmnr: number }; limit?: number },
) => Promise<{
  sheets: { sitzungnr: number; abstimmnr: number }[]
  nextCursor: { sitzungnr: number; abstimmnr: number } | null
  done: boolean
}>

describe("voteSheetsMissingVorgang: the handler wires .gte and paginates safely", () => {
  test("first-page scan uses no range bound, so the whole period is in reach", async () => {
    const { ctx, cost } = recordingCtx({
      voteSheets: [fixtureSheet({ sitzungnr: 90, abstimmnr: 1 })],
    })

    const result = await missingVorgangHandler(ctx, { wahlperiode: 21 })

    expect(result.sheets.map((s) => [s.sitzungnr, s.abstimmnr])).toEqual([[90, 1]])
    // No cursor → the handler should scan on `.eq(wahlperiode)` alone, with
    // no `.gt`/`.gte` at all — otherwise a cold call would silently skip
    // rows.
    const [read] = cost.reads
    expect(read.eq).toEqual([{ field: "wahlperiode", value: 21 }])
    expect(read.gt).toBeUndefined()
    expect(read.gte).toBeUndefined()
  })

  test("a cursor advances via .gte on sitzungnr — NEW-H2 regression at the handler layer", async () => {
    // The bug the prior code shipped: `.gt("sitzungnr", cursor.sitzungnr)`
    // silently dropped every row in the boundary sitting. Asserting the
    // recorded bound is `.gte` catches a regression that would reintroduce
    // the drop without needing a real Convex backend.
    const { ctx, cost } = recordingCtx({
      voteSheets: [fixtureSheet({ sitzungnr: 91, abstimmnr: 1 })],
    })

    await missingVorgangHandler(ctx, {
      wahlperiode: 21,
      cursor: { sitzungnr: 90, abstimmnr: 5 },
    })

    const [read] = cost.reads
    expect(read.gte).toEqual({ field: "sitzungnr", value: 90 })
    expect(read.gt).toBeUndefined()
  })

  test("three unresolved sheets in one sitting are all returned across three pages via the real handler", async () => {
    // The full end-to-end proof of the NEW-H2 fix: three sheets in sitting
    // 90, paged at `limit: 1`, must all come back. Uses the real handler
    // and the real cursor round-trip, so a regression in either the range
    // bound or the pure `decideVorgangPage` fails here.
    const tables = {
      voteSheets: [
        fixtureSheet({ sitzungnr: 90, abstimmnr: 1 }),
        fixtureSheet({ sitzungnr: 90, abstimmnr: 2 }),
        fixtureSheet({ sitzungnr: 90, abstimmnr: 3 }),
      ],
    }

    const seen: [number, number][] = []
    let cursor: { sitzungnr: number; abstimmnr: number } | undefined
    for (let step = 0; step < 5; step++) {
      const { ctx } = recordingCtx(tables)
      const result = await missingVorgangHandler(ctx, {
        wahlperiode: 21,
        cursor,
        limit: 1,
      })
      seen.push(...result.sheets.map((s): [number, number] => [s.sitzungnr, s.abstimmnr]))
      if (result.done || result.nextCursor === null) break
      cursor = result.nextCursor
    }

    expect(seen).toEqual([
      [90, 1],
      [90, 2],
      [90, 3],
    ])
  })

  test("a resolved sheet between two unresolved ones does not evict its unresolved siblings via the handler", async () => {
    // NEW-M3 regression at the handler layer.
    const tables = {
      voteSheets: [
        fixtureSheet({ sitzungnr: 90, abstimmnr: 1 }),
        fixtureSheet({ sitzungnr: 90, abstimmnr: 2, dipVorgangId: "V-resolved" }),
        fixtureSheet({ sitzungnr: 90, abstimmnr: 3 }),
        fixtureSheet({ sitzungnr: 91, abstimmnr: 1 }),
      ],
    }

    const seen: [number, number][] = []
    let cursor: { sitzungnr: number; abstimmnr: number } | undefined
    for (let step = 0; step < 5; step++) {
      const { ctx } = recordingCtx(tables)
      const result = await missingVorgangHandler(ctx, {
        wahlperiode: 21,
        cursor,
        limit: 1,
      })
      seen.push(...result.sheets.map((s): [number, number] => [s.sitzungnr, s.abstimmnr]))
      if (result.done || result.nextCursor === null) break
      cursor = result.nextCursor
    }

    expect(seen).toEqual([
      [90, 1],
      [90, 3],
      [91, 1],
    ])
  })

  test("done-on-empty: an empty period returns no sheets and done=true", async () => {
    const { ctx } = recordingCtx({ voteSheets: [] })
    const result = await missingVorgangHandler(ctx, { wahlperiode: 21 })
    expect(result.sheets).toEqual([])
    expect(result.nextCursor).toBeNull()
    expect(result.done).toBe(true)
  })

  test("only-resolved: a period with every sheet resolved returns nothing and done=true", async () => {
    const { ctx } = recordingCtx({
      voteSheets: [
        fixtureSheet({ sitzungnr: 90, abstimmnr: 1, dipVorgangId: "V1" }),
        fixtureSheet({ sitzungnr: 90, abstimmnr: 2, dipVorgangId: "V2" }),
      ],
    })
    const result = await missingVorgangHandler(ctx, { wahlperiode: 21 })
    expect(result.sheets).toEqual([])
    expect(result.done).toBe(true)
  })
})

// --- backfillVoteSheetVorgang handler — real ctx wiring for the four cases

const backfillHandler = backfillVoteSheetVorgangHandler as unknown as (
  ctx: unknown,
  args: {
    wahlperiode: number
    patches: { sitzungnr: number; abstimmnr: number; dipVorgangId: string }[]
  },
) => Promise<{ patched: number; unchanged: number; conflicts: number; unknown: number }>

describe("backfillVoteSheetVorgang handler: the four outcomes end-to-end", () => {
  test("idempotency — patching an already-resolved row returns unchanged and writes nothing", async () => {
    // Rerunning the L3 CLI on a fully-repaired period must be a no-op.
    // Assert the counter AND that `ctx.db.patch` was never invoked — a
    // regression that patched instead of skipping would tick idempotent
    // no-ops as writes forever.
    let patches = 0
    const rows = [fixtureSheet({ sitzungnr: 90, abstimmnr: 1, dipVorgangId: "V" })]
    const { ctx } = recordingCtx({ voteSheets: rows })
    // The fake ctx does not model `patch`; adding a spy just for this test
    // keeps the assertion honest without teaching the fake a full write API.
    ;(ctx as unknown as { db: Record<string, unknown> }).db.patch = async () => {
      patches++
    }

    const result = await backfillHandler(ctx, {
      wahlperiode: 21,
      patches: [{ sitzungnr: 90, abstimmnr: 1, dipVorgangId: "V" }],
    })

    expect(result).toEqual({ patched: 0, unchanged: 1, conflicts: 0, unknown: 0 })
    expect(patches).toBe(0)
  })

  test("conflict — a different stored value returns conflicts and refuses to overwrite", async () => {
    let patches = 0
    const { ctx } = recordingCtx({
      voteSheets: [fixtureSheet({ sitzungnr: 90, abstimmnr: 1, dipVorgangId: "STORED" })],
    })
    ;(ctx as unknown as { db: Record<string, unknown> }).db.patch = async () => {
      patches++
    }

    const result = await backfillHandler(ctx, {
      wahlperiode: 21,
      patches: [{ sitzungnr: 90, abstimmnr: 1, dipVorgangId: "INCOMING" }],
    })

    expect(result).toEqual({ patched: 0, unchanged: 0, conflicts: 1, unknown: 0 })
    expect(patches).toBe(0)
  })

  test("unknown — a patch naming a sheet that does not exist returns unknown, no write", async () => {
    let patches = 0
    const { ctx } = recordingCtx({
      voteSheets: [fixtureSheet({ sitzungnr: 90, abstimmnr: 1 })],
    })
    ;(ctx as unknown as { db: Record<string, unknown> }).db.patch = async () => {
      patches++
    }

    const result = await backfillHandler(ctx, {
      wahlperiode: 21,
      patches: [{ sitzungnr: 99, abstimmnr: 42, dipVorgangId: "V" }],
    })

    expect(result).toEqual({ patched: 0, unchanged: 0, conflicts: 0, unknown: 1 })
    expect(patches).toBe(0)
  })

  test("patched — an unresolved sheet receives the incoming Vorgang", async () => {
    const writes: { id: string; fields: Record<string, unknown> }[] = []
    const { ctx } = recordingCtx({
      voteSheets: [fixtureSheet({ sitzungnr: 90, abstimmnr: 1, dipVorgangId: null })],
    })
    ;(ctx as unknown as { db: Record<string, unknown> }).db.patch = async (
      id: string,
      fields: Record<string, unknown>,
    ) => {
      writes.push({ id, fields })
    }

    const result = await backfillHandler(ctx, {
      wahlperiode: 21,
      patches: [{ sitzungnr: 90, abstimmnr: 1, dipVorgangId: "V" }],
    })

    expect(result).toEqual({ patched: 1, unchanged: 0, conflicts: 0, unknown: 0 })
    expect(writes).toEqual([{ id: "sheet-90-1", fields: { dipVorgangId: "V" } }])
  })

  test("mixed batch — the counters correctly split across the four outcomes in one call", async () => {
    let patches = 0
    const { ctx } = recordingCtx({
      voteSheets: [
        fixtureSheet({ sitzungnr: 90, abstimmnr: 1 }),
        fixtureSheet({ sitzungnr: 90, abstimmnr: 2, dipVorgangId: "V" }),
        fixtureSheet({ sitzungnr: 90, abstimmnr: 3, dipVorgangId: "OTHER" }),
      ],
    })
    ;(ctx as unknown as { db: Record<string, unknown> }).db.patch = async () => {
      patches++
    }

    const result = await backfillHandler(ctx, {
      wahlperiode: 21,
      patches: [
        { sitzungnr: 90, abstimmnr: 1, dipVorgangId: "V" },
        { sitzungnr: 90, abstimmnr: 2, dipVorgangId: "V" },
        { sitzungnr: 90, abstimmnr: 3, dipVorgangId: "V" },
        { sitzungnr: 91, abstimmnr: 1, dipVorgangId: "V" },
      ],
    })

    expect(result).toEqual({ patched: 1, unchanged: 1, conflicts: 1, unknown: 1 })
    expect(patches).toBe(1) // only the resolvable row was written
  })
})
