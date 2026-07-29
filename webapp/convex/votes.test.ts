import { describe, expect, test } from "bun:test"
import {
  breakdownRows,
  chunk,
  dissentFlagsFor,
  dissentWriteKeys,
  isRebel,
  majorityOf,
  TALLY_SLICE,
  tallyByGroup,
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
