import { describe, expect, test } from "bun:test"
import { competitionRanks } from "./ranking"

/**
 * The tie rule had three implementations before this module — `ranked` in
 * convex/rankings.ts, an inline loop in `getPartyMembers`, and a backwards
 * rescan in components/party-score-table.tsx. They agreed, which is exactly the
 * situation a test is for: three copies agree until one is edited, and the part
 * people get wrong is the *skip after a tied block*, which produces a ranking
 * that looks entirely plausible.
 */

describe("competitionRanks", () => {
  test("numbers a strictly descending list 1, 2, 3", () => {
    expect(competitionRanks([50, 40, 30])).toEqual([1, 2, 3])
  })

  test("ties share a rank and the next one skips", () => {
    // The rule itself: two on 40 are both rank 2, and the next is rank 4 — not
    // rank 3. Numbering by a running counter is the bug this pins.
    expect(competitionRanks([50, 40, 40, 30])).toEqual([1, 2, 2, 4])
  })

  test("a tied block of three skips by three", () => {
    expect(competitionRanks([9, 5, 5, 5, 1])).toEqual([1, 2, 2, 2, 5])
  })

  test("a tie at the top still starts at 1", () => {
    expect(competitionRanks([7, 7, 3])).toEqual([1, 1, 3])
  })

  test("every value equal makes everyone rank 1", () => {
    expect(competitionRanks([4, 4, 4])).toEqual([1, 1, 1])
  })

  test("null is rank 0 and does not consume a rank", () => {
    // An unscored mandate is beside the ranking rather than in it — the same
    // distinction `getMPsWithScores` draws by returning null rather than 0. It
    // must not push the ranks of the rows above it.
    expect(competitionRanks([50, 40, null, null])).toEqual([1, 2, 0, 0])
  })

  test("a null between values does not break a tie run", () => {
    // Defensive rather than a shape the callers produce — they sort nulls last.
    // A null in the middle must not silently reset the tie state and renumber
    // the block after it.
    expect(competitionRanks([40, null, 40])).toEqual([1, 0, 1])
  })

  test("zero is a value, not a missing one", () => {
    // `0` and `null` are the distinction this whole codebase keeps: a member who
    // scored nothing is ranked; one the sweep has not reached is not.
    expect(competitionRanks([5, 0, 0])).toEqual([1, 2, 2])
  })

  test("an empty list ranks nothing", () => {
    expect(competitionRanks([])).toEqual([])
  })

  test("returns one rank per input, always", () => {
    const values = [10, 10, 8, null, 3]
    expect(competitionRanks(values)).toHaveLength(values.length)
  })
})
