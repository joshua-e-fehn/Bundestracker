import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { occupationFields, occupationOf } from "./bundestag"

/**
 * Every surface that answers "what does this MP do" answers it the same way.
 *
 * ## Why a filesystem check, and why it lives in lib/
 *
 * The defect being guarded against is *a call site choosing its own rule*, and
 * no test of the code that exists today can catch the next one that does. It is
 * also what actually happened, three times over:
 *
 *  - `components/seat-tooltip.tsx` printed `profession` alone while
 *    `components/mp-table.tsx` printed `occupationOf`'s answer, so the same
 *    member read as a lawyer on `/mps` and an MdB on the seating map — the
 *    disagreement `occupationOf` was written to end, on a surface that was
 *    still not using it.
 *  - `components/search-results.tsx` called `occupationOf({ occupation })` —
 *    the right function with the fallback field withheld — so the 28 WP21
 *    members carrying a `profession` and no `occupation` matched a search and
 *    then showed a blank line under their name.
 *  - `convex/search.ts` projected `mp.occupation ?? null` into its `returns`
 *    validator, which typechecks, returns a valid response, and drops the
 *    fallback the rest of the site applies.
 *
 * Each was consistent with itself and none failed a type check. The same shape
 * as `components/mp-photo.test.ts`, which reads a directory for the same
 * reason, and `lib/auth-routes.test.ts`, which reads `app/`.
 *
 * Here rather than beside either half because the rule spans both: `lib/` owns
 * it, `convex/` resolves it server-side for two surfaces, and `components/`
 * resolves it in the browser for two more. A test in `convex/` could not use
 * `node:fs` at all — that directory is bundled for a V8 isolate with no Node
 * builtins.
 */

const WEBAPP_DIR = join(import.meta.dir, "..")

function source(path: string): string {
  return readFileSync(join(WEBAPP_DIR, path), "utf8")
}

/** Newline-joined, so a call site spanning several lines can be matched as one
 * thing. The same treatment `components/mp-photo.test.ts` applies, and for the
 * same reason: tsconfig's target predates the `s` regex flag. */
function flat(path: string): string {
  return source(path).replace(/\s+/g, " ")
}

/**
 * Every surface the brief names, and the expression each resolves the trade
 * with.
 *
 * Listed explicitly rather than derived, because the point is **coverage**: a
 * surface that dropped the field entirely would pass any pattern check by
 * having nothing to check. GAP-011 was exactly that — a merge lost the commit
 * that added occupation to three of four planned surfaces, and nothing failed.
 */
const SURFACES: ReadonlyArray<{ file: string; resolves: string; why: string }> = [
  {
    file: "components/mp-table.tsx",
    resolves: "occupationOf(row.mp)",
    why: "the roster table's sortable occupation column",
  },
  {
    file: "components/seat-tooltip.tsx",
    resolves: "occupationOf(seat)",
    why: "the seating map's hover card",
  },
  {
    // The one surface that deliberately shows **both**, on two labelled rows:
    // a profile has room to say that "what they do now" and "what they did
    // before" are different answers. So the precedence does not apply to it,
    // and what is asserted is that it reads `occupation` at all — showing
    // `profession` alone was the state this whole gap describes.
    file: "components/mp-profile.tsx",
    resolves: "mp.occupation",
    why: "the profile's Biografie card",
  },
  {
    // Resolved server-side, in convex/parties.ts.
    file: "components/party-members.tsx",
    resolves: "row.occupation",
    why: "a Fraktion's member table",
  },
  {
    // Resolved server-side, in convex/search.ts.
    file: "components/search-results.tsx",
    resolves: "mp.occupation",
    why: "the /search result card",
  },
]

/**
 * The Convex queries that carry an occupation to one of those surfaces.
 *
 * `rankings.ts` was already correct and is listed anyway: it is the precedent
 * the others were brought into line with, and a regression there would be as
 * invisible as the one this file was written for.
 */
const QUERIES: ReadonlyArray<{ file: string; surface: string }> = [
  { file: "convex/search.ts", surface: "the /search result card" },
  { file: "convex/parties.ts", surface: "a Fraktion's member table" },
  { file: "convex/rankings.ts", surface: "the leaderboards" },
  { file: "convex/seating.ts", surface: "the seating map's hover card" },
]

describe("one occupation rule, every surface", () => {
  test("each planned surface still resolves an occupation", () => {
    const missing = SURFACES.filter(({ file, resolves }) => !flat(file).includes(resolves))
    // Named in the failure, with what the surface is *for*: a dropped column is
    // invisible on the page, so the message has to say which reader lost it.
    expect(missing.map((surface) => `${surface.file} (${surface.why})`)).toEqual([])
  })

  test("each query still declares the field", () => {
    const missing = QUERIES.filter(({ file }) => !flat(file).includes("occupation:"))
    expect(missing.map((query) => `${query.file} (${query.surface})`)).toEqual([])
  })

  test("no query reads a raw column into a total validator", () => {
    // `occupation: mp.occupation ?? null` typechecks, returns a valid response,
    // and silently drops the fallback — so a card matches on a word it then
    // declines to print. It is also a runtime hazard: both columns are
    // `v.optional` in storage, so an un-enriched row reads back `undefined`,
    // which fails a `v.union(v.null(), v.string())` and takes the whole query
    // down with a bare "Server Error" (convex/mps.ts:photoFields). Routing
    // through `occupationOf` fixes both at once — it returns `string | null`.
    //
    // `seating.ts` is the exception and is checked on its own below.
    const offenders: string[] = []
    for (const { file } of QUERIES) {
      if (file === "convex/seating.ts") continue
      const text = flat(file)
      if (/occupation:\s*\w+\??\.occupation/.test(text)) offenders.push(file)
      if (!text.includes("occupationOf(")) offenders.push(file)
    }
    expect([...new Set(offenders)]).toEqual([])
  })

  test("seating sends both columns, because its consumer resolves them", () => {
    // The tooltip needs `occupationOf`'s answer and computes it in the browser.
    // Sending one column would put the choice back inside a component, which is
    // where the two rules diverged in the first place.
    expect(flat("convex/seating.ts")).toContain("occupation: mp?.occupation ?? null")
    expect(flat("convex/seating.ts")).toContain("profession: mp?.profession ?? null")
    // And the mapping between them keeps both, with `?? null` for the deploy
    // window in which a browser on this build meets an older backend.
    expect(flat("components/seating.tsx")).toContain("occupation: entry.occupation ?? null")
  })

  test("no surface picks between the two fields itself", () => {
    // The `??` chain `occupationOf` replaced. A second copy is how the seating
    // map and the roster table came to disagree; a third is how they would
    // again.
    const offenders = [...SURFACES, ...QUERIES]
      .map(({ file }) => file)
      // The profile shows both fields on two labelled rows — see `SURFACES` —
      // and seating carries both across the wire. Neither is choosing.
      .filter((file) => file !== "components/mp-profile.tsx" && file !== "convex/seating.ts")
      .filter((file) => /\.occupation\s*(\?\?|\|\|)\s*[\w.?]*profession/.test(flat(file)))
    expect(offenders).toEqual([])
  })

  test("the roster table sorts on the resolved value, not on one column", () => {
    // Sorting by `profession` while displaying `occupationOf`'s answer would
    // order the column by a value the column does not show, which reads as a
    // broken sort rather than as two fields.
    const table = flat("components/mp-table.tsx")
    expect(table).toContain('case "occupation":')
    expect(table).toContain('occupationOf(a.mp) ?? ""')
    // Missing values last in both directions, like an unscored MP — the rule
    // `isMissing` exists for. Through the resolver, so a change to the
    // precedence cannot leave the sort reading a different field.
    expect(table).toContain("occupationOf(row.mp) === null")
  })

  test("search matches over every recorded field, not only the label", () => {
    // The recall half of GAP-010. Matching `occupationOf`'s single answer would
    // leave a lawyer whose `occupation` reads "MdB" — which is most of them —
    // unreachable by the lexicon's largest section.
    const text = flat("convex/search.ts")
    expect(text).toContain("occupationFields(mp)")
    // Through the shared folding rule rather than a bare `includes`, so a
    // keyword reachable in a motion title is reachable in a trade.
    expect(text).toContain("foldedTextMatches")
  })
})

/**
 * The missing-data contract every surface above is written against.
 *
 * Restated against the values a row actually carries, because the three
 * absences arrive from three different places and a surface has to handle all
 * of them identically: the columns are `v.optional` in storage so an
 * un-enriched row has the key absent, the enrichment stage writes null for what
 * it could not resolve, and both sources publish empty strings.
 */
describe("missing occupation is unknown", () => {
  test("all three absences collapse to null, which renders as nothing", () => {
    // A dash in a table cell, an omitted line in a tooltip — never the word
    // "unemployed", which no source publishes and this code does not invent.
    for (const row of [
      {},
      { occupation: null },
      { profession: null },
      { occupation: null, profession: null },
      { occupation: "", profession: "" },
      { occupation: "   " },
    ]) {
      expect(occupationOf(row)).toBeNull()
      expect(occupationFields(row)).toEqual([])
    }
  })

  test("a row that predates the fields is not a row with no trade", () => {
    // The deploy-window case components/seat-tooltip.tsx documents: a browser
    // on this build against a backend not yet redeployed receives rows without
    // the keys at all. `undefined` must behave as null does rather than throw —
    // the first version of that tooltip narrowed on `!== null` and took the
    // seating page to its error boundary on the first hover.
    expect(occupationOf({ occupation: undefined, profession: undefined })).toBeNull()
    expect(() => occupationOf({})).not.toThrow()
  })

  test("the two tables render the absence as a dash, like their score columns", () => {
    // Asserted because "shows unknown honestly" is a product requirement here
    // rather than a formatting preference: the cell has to say *something*, and
    // the something has to be the same mark the columns beside it use for a
    // figure the sweep has not computed.
    for (const file of ["components/mp-table.tsx", "components/party-members.tsx"]) {
      expect(flat(file), file).toContain('text-muted-foreground/60">—')
    }
  })

  test("a recorded trade is passed through verbatim, never translated", () => {
    // The other half of the honesty rule, and the one the lexicon makes
    // tempting to break: a reader who searches `lawyer` gets a card whose
    // evidence says `Rechtsanwältin`, because that is the word the Bundestag
    // published. Answering with "lawyer" would assert a translation no source
    // made — the page's `search.alsoSearched` line explains the match instead.
    //
    // Byte-identical, so an umlaut is not folded on the way to the screen
    // either: the folding exists to make two spellings *compare* equal, not to
    // change how one is printed.
    for (const value of ["Rechtsanwältin", "Diplom-Ingenieur (FH)", "selbstständig, Ökonom"]) {
      expect(occupationOf({ profession: value })).toBe(value)
      expect(occupationFields({ occupation: value })).toEqual([value])
    }
  })
})
