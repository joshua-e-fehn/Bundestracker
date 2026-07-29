import { describe, expect, test } from "bun:test"
import { isSyntheticId, isSyntheticVoteSheet } from "./purgeSeed"

/**
 * The id rule that decides what gets deleted from production.
 *
 * Worth a test out of proportion to its four lines: it is the predicate a
 * destructive, irreversible mutation runs on every roster row, and both of its
 * failure directions are bad in a way that is invisible afterwards. Too narrow
 * and fabricated MPs stay on a site that promises none; too broad and real
 * mandates are deleted with everything joined to them.
 *
 * The ids below are the ones production actually held on 2026-07-27 — nine seed
 * rows shadowing sitting members, three more the obvious `bt-000[0-9]` pattern
 * would have missed, and real ids from the same query.
 */
describe("isSyntheticId", () => {
  test("recognises every id the seeders mint", () => {
    // `scripts/seed-local.ts` writes bt-0001…bt-0012; `convex/seedDev.ts`
    // pads the same way. All twelve were live in production.
    for (let n = 1; n <= 12; n++) {
      expect(isSyntheticId(`bt-${String(n).padStart(4, "0")}`)).toBe(true)
    }
  })

  test("catches the three the bt-000[0-9] pattern misses", () => {
    // The pattern in the original bug report stops at bt-0009, which would have
    // left fabricated Alice Weidel, Julia Klöckner and Alexander Dobrindt rows
    // in production — indistinguishable, afterwards, from a finished cleanup.
    expect(isSyntheticId("bt-0010")).toBe(true)
    expect(isSyntheticId("bt-0011")).toBe(true)
    expect(isSyntheticId("bt-0012")).toBe(true)
  })

  test("leaves real mandates alone", () => {
    // `internal_id()` in pipeline/src/bundestrack/pipeline/join.py:78 — `bt-`
    // plus the 8-digit Stammdaten id. These are Merz, Klingbeil and Weidel as
    // the pipeline actually wrote them, each of whom also had a seed twin.
    expect(isSyntheticId("bt-11002735")).toBe(false)
    expect(isSyntheticId("bt-11003715")).toBe(false)
    expect(isSyntheticId("bt-11004930")).toBe(false)
  })

  test("does not claim an id it has never seen the shape of", () => {
    // Nothing without the prefix is called synthetic: the pipeline puts one on
    // every id it mints, so an id without one came from a source this rule was
    // never written against — and guessing there deletes real rows.
    expect(isSyntheticId("11002735")).toBe(false)
    expect(isSyntheticId("")).toBe(false)
    expect(isSyntheticId("dip-1013")).toBe(false)
  })

  test("anchors both ends of the real-id pattern", () => {
    // A 9-digit body is not an 8-digit one. Unanchored, `bt-110027350` would
    // read as real and survive a purge; a trailing-suffix id would too.
    expect(isSyntheticId("bt-110027350")).toBe(true)
    expect(isSyntheticId("bt-1100273")).toBe(true)
    expect(isSyntheticId("bt-11002735-copy")).toBe(true)
  })
})

/**
 * The ballot rule — the second half of the purge contract.
 *
 * These matter for a reason the mandate tests do not have to argue: a
 * fabricated *division* is invisible on the page that renders it. A duplicate
 * Merz in a roster looks wrong to anyone scrolling past; `(21, 91, 2)` looked
 * exactly like a real electoral-law vote, published a 6/3/1 tally nobody cast,
 * and stood on the live site for two days *after* a purge that reported success
 * — because the sheets were left out of the traversal and the omission was
 * documented rather than closed.
 *
 * So the direction that matters most here is the opposite of the mandate case.
 * Too broad does not merely delete a real row, it deletes a **Bundestag
 * division** — and the rows most at risk are the ones a historical backfill is
 * loading right now: ballots reconstructed from the protocol XML, which
 * legitimately carry a null `sourceUrl` and a short roll.
 */
describe("isSyntheticVoteSheet", () => {
  /** A sheet as the predicate reads one. */
  const sheet = (totalEligible: number, sourceUrl: string | null) => ({
    totalEligible,
    sourceUrl,
  })

  const XLSX = "https://www.bundestag.de/resource/blob/1234/data.xlsx"

  test("catches the ballot the seeder invented", () => {
    // `scripts/seed-local.ts` writes `MPS.length` — twelve — and no source URL.
    // This is `(21, 91, 2)` as production actually held it.
    expect(isSyntheticVoteSheet(sheet(12, null))).toBe(true)
  })

  test("leaves every real chamber alone", () => {
    // The three electorates the corpus actually contains, across WP19–WP21.
    for (const chamber of [628, 630, 736]) {
      expect(isSyntheticVoteSheet(sheet(chamber, XLSX))).toBe(false)
    }
  })

  test("leaves an XML-reconstructed ballot alone", () => {
    // The counterexample that forces the rule to be a conjunction. A sheet
    // rebuilt from the protocol XML (§4.2) lists only the MPs who cast a vote
    // and carries no XLSX, so `sourceUrl` is null and the roll can be short —
    // both seed-shaped, neither synthetic. A historical backfill (WP19–WP14) is
    // exactly the traffic that lands these, so a rule keyed on either condition
    // alone would delete real divisions during a routine backfill.
    expect(isSyntheticVoteSheet(sheet(487, null))).toBe(false)
    expect(isSyntheticVoteSheet(sheet(99, XLSX))).toBe(false)
  })

  test("needs both conditions, at the boundary", () => {
    // 100 is `MIN_REAL_ELECTORATE`, and the comparison is strict: a sheet with
    // exactly 100 rows is not called synthetic. The seeder's twelve is nowhere
    // near it, so the margin is deliberately wide in the safe direction.
    expect(isSyntheticVoteSheet(sheet(100, null))).toBe(false)
    expect(isSyntheticVoteSheet(sheet(99, null))).toBe(true)
  })

  test("stops matching the moment the row becomes real", () => {
    // Why the rule is not the natural key `(21, 91, 2)`. The Bundestag may yet
    // hold a real sitting 91, vote 2 — `upsertVoteSheet` patches by natural key,
    // so this row would become a genuine ballot in place. A delete keyed on the
    // triple would then destroy real data; one keyed on the row's own
    // implausibility fails safe, which is what this asserts.
    expect(isSyntheticVoteSheet(sheet(630, XLSX))).toBe(false)
  })

  test("an empty source URL is not a missing one", () => {
    // `sourceUrl` is `v.union(v.null(), v.string())`, so "" is a value the
    // schema permits and `=== null` deliberately does not match. A truthiness
    // check here would widen the rule to any sheet with a blank URL, which is a
    // row shape nobody has described — the same conservatism `isSyntheticId`
    // applies to an unprefixed id.
    expect(isSyntheticVoteSheet(sheet(12, ""))).toBe(false)
  })
})
