import { describe, expect, test } from "bun:test"
import { isSyntheticId, isSyntheticVorgangId, isSyntheticVoteSheet } from "./purgeSeed"

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

  /**
   * ## seedDev's ballots escape the electorate check, and the branch's added
   *    invariant fails silently until this passes.
   *
   * `FRAKTIONEN` in `convex/seedDev.ts` sums to `40+28+24+18+13+2 = 125`
   * seats. `seedDev` writes six `voteSheets` with `totalEligible: roster.length`
   * (125) and `sourceUrl: null`; the original rule needed `< 100 AND
   * sourceUrl === null` and quietly reported those six as *not synthetic*, so
   * `deleteSyntheticVoteSheets` skipped them and `seedDataPresent`
   * reported `voteSheets: 0` while `Namentliche Abstimmung 1..6 (Testdaten)`
   * stayed in the corpus. The branch's added
   * `deleteSyntheticMotionsAndReferrals` docstring says "after purgeSeedData
   * reports done, nothing a seeder wrote is left in any table" — the
   * invariant contradicted by exactly this L1 defect.
   *
   * The tests below pin the exact `seedDev` shape (125 seats, `(Testdaten)`
   * title, `seed-vorgang-N` id, `sourceUrl: null`) so a future roster edit
   * or title reshape does not silently reintroduce the omission.
   */
  describe("catches seedDev's sheets — the L1 finding", () => {
    /** A sheet as `seedDev` writes it (odd-numbered = linked, even = null-Vorgang). */
    const seedDevSheet = (sitting: number, withVorgang: boolean) => ({
      totalEligible: 125, // FRAKTIONEN sums to 40+28+24+18+13+2 — do not "fix" this
      sourceUrl: null,
      dipVorgangId: withVorgang ? `seed-vorgang-${sitting}` : null,
      title: `Namentliche Abstimmung ${sitting} (Testdaten)`,
    })

    test("catches every one of seedDev's six ballots at their real roster size", () => {
      for (let sitting = 1; sitting <= 6; sitting++) {
        const withVorgang = sitting % 2 === 1
        expect(
          isSyntheticVoteSheet(seedDevSheet(sitting, withVorgang)),
          `seedDev ballot ${sitting} (${withVorgang ? "linked" : "unlinked"})`,
        ).toBe(true)
      }
    })

    test("the seed-Vorgang marker alone is enough, regardless of electorate", () => {
      // A future seed roster growing past 100 must not silently reintroduce
      // the omission — the marker carries the claim on its own for the
      // ballots that carry a Vorgang.
      expect(
        isSyntheticVoteSheet({
          totalEligible: 630,
          sourceUrl: null,
          dipVorgangId: "seed-vorgang-42",
          title: "some other title",
        }),
      ).toBe(true)
    })

    test("the (Testdaten) suffix is only synthetic under the source-url guard", () => {
      // A real ballot titled `… (Testdaten)` (satirical Antrag, editorial
      // gloss) that carries an XLSX is not synthetic. The suffix on its own
      // is a title, not a marker; the guard is what makes it safe.
      expect(
        isSyntheticVoteSheet({
          totalEligible: 630,
          sourceUrl: "https://www.bundestag.de/resource/blob/x/data.xlsx",
          title: "Etwas Groteskes (Testdaten)",
        }),
      ).toBe(false)
    })
  })

  describe("does not clip a real ballot that carries a real Vorgang id", () => {
    test("digit-string Vorgang ids never match the seed prefix range", () => {
      // Real DIP Vorgang ids are digit strings ("333135", "217890", …).
      // Digits sort at 0x30-0x39, well below `s` at 0x73 — no real id can
      // fall in `[seed-, seed.)`. Asserted here so a future rename of the
      // seed prefix that breaks this invariant fails loudly.
      for (const realId of ["333135", "217890", "999999", "1", "12"]) {
        expect(
          isSyntheticVoteSheet({
            totalEligible: 630,
            sourceUrl: "https://www.bundestag.de/resource/blob/x/data.xlsx",
            dipVorgangId: realId,
            title: "Reales Gesetz zur Reform",
          }),
        ).toBe(false)
      }
    })
  })
})

/**
 * The `SEED_VORGANG_PREFIX` decides which motions and referrals get
 * deleted from production, so it needs to catch both seeders — and only
 * those — no matter what shape their ids take.
 */
describe("isSyntheticVorgangId", () => {
  test("catches every prefix both seeders mint", () => {
    // Enumerated against `seedDev.ts` (line 259: `seed-vorgang-${sitting}`,
    // line 361: `seed-motion-N`) and `seed-local.ts` (the `seed-vorgang-*`
    // spellings across the file after the L1 fix).
    for (const id of [
      "seed-vorgang-1",
      "seed-vorgang-42",
      "seed-vorgang-klimaschutz",
      "seed-motion-1",
      "seed-motion-3",
    ]) {
      expect(isSyntheticVorgangId({ dipVorgangId: id }), id).toBe(true)
    }
  })

  test("leaves real DIP Vorgang ids and unrelated prefixes alone", () => {
    for (const id of [
      "333135", // measured real DIP id
      "217890",
      "vorgang-1", // the old seed-local prefix that leaked the L1 seed-local defect
      "seedling", // any string not starting with `seed-` proper
      "",
    ]) {
      expect(isSyntheticVorgangId({ dipVorgangId: id }), id).toBe(false)
    }
  })

  test("leaves a null dipVorgangId alone (the schema-nullable case)", () => {
    // A motion ingested by its Drucksache alone carries `dipVorgangId: null`
    // by design (schema.ts). The predicate must not fire on it — the
    // downstream `.gte("dipVorgangId", "seed-")` range naturally excludes
    // nulls (Convex sorts null below every value), but the type-guard
    // narrows to `dipVorgangId: string` which the traversal needs.
    expect(isSyntheticVorgangId({ dipVorgangId: null })).toBe(false)
  })
})
