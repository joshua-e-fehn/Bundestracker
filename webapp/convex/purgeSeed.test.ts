import { describe, expect, test } from "bun:test"
import { isSyntheticId } from "./purgeSeed"

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
