import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Nothing builds an MP profile link by hand.
 *
 * ## The bug class this exists for
 *
 * Nine components link to `/mps/[id]`, and on a page scoped to a historical
 * Wahlperiode every one of them must carry that period or the reader clicks a
 * name on the WP19 rankings and lands on that person's WP21 profile — or on a
 * "did not sit in this period" page, if they left in WP20.
 *
 * `useMPHref` (components/providers/period-provider.tsx) makes the default
 * correct: a link built through it inherits the surrounding page's period
 * without the component knowing a period exists. What it cannot do is stop the
 * *tenth* link, added later by someone who did not read that note, from being
 * written as a template string again.
 *
 * And that tenth link would not fail anything. It renders, it navigates, the
 * page it reaches is a real page — it is simply the wrong Bundestag. No
 * typecheck sees it, no runtime error fires, and a browser test only catches it
 * if it happens to click that particular link on a historical period.
 *
 * So the assertion is on the *source text*. It is a blunt instrument and it is
 * the right one here: the property being protected is "there is one way to do
 * this", which is a claim about the codebase rather than about any execution of
 * it. lib/navigation.test.ts makes the same kind of claim by reading the
 * filesystem, for the same reason.
 *
 * ## Why the roster page is not exempt
 *
 * It would be the obvious exemption — `/mps` is the roster, so a row's link
 * "obviously" stays in the same period. That is exactly the reasoning that
 * would break it: `MPTable` renders rows for a period that now comes from the
 * URL, and a hand-built href there sends every one of 630 rows to the current
 * chamber.
 */

/** Every `.tsx` under `components/`, recursively. */
function componentFiles(): string[] {
  const root = new URL("../components/", import.meta.url).pathname
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".tsx")) out.push(path)
    }
  }
  walk(root)
  return out
}

/**
 * A profile path assembled from a template literal or a concatenation.
 *
 * Matches `` `/mps/${…}` `` and `"/mps/" + …`, which are the two ways the nine
 * original call sites were written. It deliberately does **not** match the bare
 * string `"/mps"` — that is the roster, a real destination, and several
 * components link to it correctly through `periodLink`.
 */
const BUILT_PROFILE_PATH = /["'`]\/mps\/\$\{|["']\/mps\/["']\s*\+/

/**
 * The same, but immediately wrapped by a period-aware builder.
 *
 * `periodLink("/mps/…", wp, current)` and `periodHref("/mps/…", next, …)` build
 * the *path* by hand and then hand it to the thing that adds the period, which
 * is correct and is what `useMPHref` itself does internally. Three call sites
 * are legitimately of this shape and none of them is a hand-built href:
 *
 *  - `providers/period-provider.tsx` — the builder itself.
 *  - `mp-profile-scope.tsx` — the profile's own period switcher and its
 *    "did not sit" links, which name an *explicit* period rather than
 *    inheriting the ambient one, so they cannot go through `useMPHref`.
 *
 * So the rule is not "never write the path" but "never write the href", and
 * the difference is whether a period-aware call wraps it.
 */
const WRAPPED_BY_PERIOD_BUILDER = /period(Link|Href)\(\s*[`"']\/mps\//

describe("MP profile links", () => {
  test("no component builds one by hand", () => {
    const offenders = componentFiles().filter((path) => {
      const source = readFileSync(path, "utf8")
      if (!BUILT_PROFILE_PATH.test(source)) return false
      return !WRAPPED_BY_PERIOD_BUILDER.test(source)
    })
    // Named in the failure rather than counted, so the message says which file
    // to fix and not merely that one exists.
    //
    // ⚠ `home-sections.tsx` is the one deliberate entry, and it is deliberate
    // rather than grandfathered: `/` and `/dashboard` are always the sitting
    // Bundestag by design (they render no selector and take no `?wp=`), so
    // their feed preview's link is correctly a bare path. Adding a period there
    // would name the period the reader was already going to get — the pinning
    // `lib/period.ts` exists to prevent. If that page ever becomes
    // period-scoped, this entry is what will say so.
    expect(offenders.map((path) => path.split("/components/")[1]).sort()).toEqual([
      "home-sections.tsx",
    ])
  })

  test("the components that link to profiles go through the shared builder", () => {
    // The other half: the rule above is satisfiable by deleting every link, so
    // this asserts the links still exist and still route through `useMPHref`.
    // These nine are the surfaces the audit and the backfill report both name
    // as the paths a reader takes from a list into a profile.
    const expected = [
      "activity-feed-item.tsx",
      "mp-card.tsx",
      // The roster's rows. It was the one file the first run of this test
      // caught: `MPRow` built the href by hand and used it *twice* — for the
      // name anchor and for the whole-row `router.push` — so a WP19 roster sent
      // all 630 rows to the current chamber, by click and by keyboard alike.
      "mp-table.tsx",
      "party-members.tsx",
      "rankings-table.tsx",
      "search-results.tsx",
      "seating-map.tsx",
      "vote-table.tsx",
    ]
    for (const name of expected) {
      const source = readFileSync(
        new URL(`../components/${name}`, import.meta.url).pathname,
        "utf8",
      )
      expect(source, `${name} no longer uses useMPHref`).toContain("useMPHref")
    }
  })
})

/**
 * Every period-bound route resolves its period the same way.
 *
 * The failure this guards is a page that reads `?wp=` with its own `Number()`
 * — which is what `/search` did before this branch, and which accepted
 * `?wp=21.5` and `?wp=0` where `parsePeriodParam` rejects both. Two parsers is
 * two answers to the same URL, and the one that disagrees is whichever page
 * the reader happens to be on.
 */
describe("period parsing", () => {
  test("nothing reads the wp parameter without the shared parser", () => {
    const offenders: string[] = []
    for (const path of componentFiles()) {
      const source = readFileSync(path, "utf8")
      // A component that names the parameter must also name the parser. The
      // module that *defines* the constant is the one exception, and it lives
      // in lib/ rather than components/, so it is not walked here.
      const readsParam = /params\.get\((PERIOD_PARAM|["']wp["'])\)/.test(source)
      if (readsParam && !source.includes("parsePeriodParam")) {
        offenders.push(path.split("/components/")[1])
      }
    }
    expect(offenders.sort()).toEqual([])
  })
})
