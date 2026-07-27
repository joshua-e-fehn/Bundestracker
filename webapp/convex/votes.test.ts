import { describe, expect, test } from "bun:test"
import { breakdownRows, dissentFlagsFor, isRebel, majorityOf, tallyByGroup } from "./votes"

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
