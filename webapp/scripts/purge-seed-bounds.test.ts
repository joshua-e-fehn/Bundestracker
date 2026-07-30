import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The `convex/purgeSeed.ts` recovery path's read-cost invariant, asserted
 * against the source.
 *
 * ## Why a source-text test rather than a unit test
 *
 * The bug this pins is a `.collect()` on `motions` with no index range,
 * which throws on Convex's ~16 384-doc per-query cap. Reproducing the
 * failure at runtime would need a `motions` table with more than 16 k rows;
 * a bun test cannot produce that. The correctness invariant is
 * *structural* — the query must carry the prefix bounds — and a grep over
 * the file that catches a regression at review time is worth more than a
 * runtime test that only fires on a deployment nobody has set up.
 *
 * Same pattern as `components/follow-button.test.ts` and
 * `components/vote-explanations-disclosure.test.ts` — the tests read the
 * file as text and pin the load-bearing lines. The convex/ lint rule that
 * bans Node builtins is why this test lives in scripts/ rather than
 * beside the source it guards.
 *
 * ## The failure mode this exists to prevent
 *
 * From the independent review's H1 finding:
 *
 * > The historical incident the module header records was that
 * > `scripts/seed-local.ts` ran against production and left fabricated rows
 * > behind. The purge module was rewritten so `purgeSeedData` and
 * > `seedDataPresent` could be run against production as the recovery path.
 * > The new helpers this branch adds — for the new `motions` and
 * > `committeeReferrals` seed rows — do NOT survive prod scale. On prod:
 * > `purgeSeedData` throws or truncates on the first `.collect()`;
 * > `seedDataPresent` — the check operators use to verify a clean
 * > deployment — throws instead of returning a count; so a repeat of the
 * > seed-in-prod incident with the NEW seeder is undetectable and
 * > unrecoverable through this route.
 *
 * The bound this test enforces is what stops that.
 */

const source = readFileSync(
  new URL("../convex/purgeSeed.ts", import.meta.url).pathname,
  "utf8",
)

/** The block from a named async function to the matching `^}` at column 0. */
function functionBody(name: string): string {
  const marker = `async function ${name}(`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`function ${name} not found`)
  const rest = source.slice(start)
  const end = rest.indexOf("\n}\n")
  if (end < 0) throw new Error(`unterminated function ${name}`)
  return rest.slice(0, end)
}

/**
 * The two helpers both walk `by_dipVorgangId` and both must carry the
 * prefix-range constraint. Named individually — a rename that split them
 * apart, or an add of a third helper without the bound, would fail here
 * rather than at 3 AM on the day the seeder next lands in prod.
 */
const BOUNDED_HELPERS = ["deleteSyntheticMotionsAndReferrals", "seedMotionsRemaining"]

describe("purgeSeed traversal is bounded to the seeded prefix range", () => {
  test.each(BOUNDED_HELPERS)(
    "%s constrains by_dipVorgangId with gte(SEED_VORGANG_PREFIX).lt(SEED_RANGE_END)",
    (name: string) => {
      const body = functionBody(name)

      // The `.query("motions").withIndex("by_dipVorgangId", ...)` block must
      // carry the bound. A regex that walks the argument list allows for
      // formatting drift (line breaks, spacing) but pins the essential
      // shape: gte on the start, lt on the end, both against the two
      // named constants.
      const pattern =
        /withIndex\(\s*"by_dipVorgangId"\s*,\s*\(q\)\s*=>\s*q\s*\.gte\(\s*"dipVorgangId"\s*,\s*SEED_VORGANG_PREFIX\s*\)\s*\.lt\(\s*"dipVorgangId"\s*,\s*SEED_RANGE_END\s*\)\s*,?\s*\)/
      expect(body).toMatch(pattern)

      // And a full-table `.collect()` — with no index at all, or with the
      // index selected but with no range — must not sneak back in. A
      // `.withIndex("by_dipVorgangId")` with no callback is the exact
      // regression this test exists to catch.
      const unboundedIndexOnly =
        /withIndex\(\s*"by_dipVorgangId"\s*\)\s*\.collect\(\)/
      expect(body).not.toMatch(unboundedIndexOnly)
    },
  )

  test("the two range constants agree on the seeded prefix", () => {
    // Read the constants back from the source rather than importing them
    // (convex/ modules are hostile to Node builtins and would drag the
    // rest of the module into this test's runtime). Regex the two
    // string literals directly.
    const startMatch = source.match(/SEED_VORGANG_PREFIX\s*=\s*"([^"]+)"/)
    const endMatch = source.match(/SEED_RANGE_END\s*=\s*"([^"]+)"/)
    expect(startMatch?.[1]).toBe("seed-")
    expect(endMatch?.[1]).toBe("seed.")

    // The bound is `[start, end)`. String-compare must place every
    // `start`-prefixed id below `end`, so a future rename that broke the
    // byte-order argument fails here immediately.
    if (startMatch && endMatch) {
      for (const suffix of ["", "0", "vorgang-1", "vorgang-klimaschutz", "￿"]) {
        const seeded = startMatch[1] + suffix
        expect(seeded >= startMatch[1], seeded).toBe(true)
        expect(seeded < endMatch[1], seeded).toBe(true)
      }
      // And a digit-prefix real DIP id must sort *below* `start` — so the
      // range does not have to fear real ids sneaking in from the other
      // side either.
      for (const realId of ["1", "333135", "999999"]) {
        expect(realId < startMatch[1], realId).toBe(true)
      }
    }
  })
})
