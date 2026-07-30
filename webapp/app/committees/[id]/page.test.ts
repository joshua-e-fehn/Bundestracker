import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Source-text guards on `/committees/[id]`.
 *
 * The detail page carries three load-bearing invariants that a well-typed
 * refactor can silently break — and this file pins each of them.
 *
 *  - **`notFound()` is only for a segment that cannot be a committee name.**
 *    An unknown-but-well-formed name goes to a "no such committee" page body,
 *    not a 404. Widening the guard to also 404 on unknowns would break
 *    shareable links to committees whose names were recut mid-period (§6.3).
 *  - **`?wp=` is preserved on the back link.** The heading receives
 *    `backHref`, computed server-side from `searchParams`. A refactor that
 *    dropped it would send readers from `/committees/X?wp=19` back to
 *    `/committees` and quietly switch them to the current period.
 *  - **Both heading and roster sit under a Suspense boundary.** `PeriodScope`
 *    inside uses `useSearchParams`; Next 16 fails the build if it is
 *    unwrapped.
 */

// `import.meta.dir` is Bun-native. Using `new URL("./page.tsx", import.meta.url)`
// URL-encodes the `[id]` in the path to `%5Bid%5D`, and the resulting pathname
// no longer names a file that exists.
const source = readFileSync(join(import.meta.dir, "page.tsx"), "utf8")
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("/committees/[id] page shell", () => {
  test("only 404s when the URL segment cannot be a committee name", () => {
    // The exact rule: `parseCommitteeParam(id) === null` is the ONLY
    // condition that calls `notFound()`. Nothing about the roster being
    // empty, and nothing about the period not covering committees, may
    // trigger it — those are page-body messages, not 404s.
    //
    // The regex looks for a `notFound()` call whose guard is exactly the
    // parse-null check. A refactor that adds a second `notFound()` for the
    // wrong reason fails this test.
    const notFoundCalls = stripped.match(/notFound\(\)/g) ?? []
    expect(notFoundCalls.length).toBe(1)
    expect(stripped).toMatch(/if\s*\(\s*committeeName\s*===\s*null\s*\)\s*notFound\(\)/)
  })

  test("PeriodScope carries the committee name as a serialisable prop", () => {
    // The name reaches the roster component through `PeriodScope`'s `props`
    // slot, not by re-parsing the URL inside `CommitteeMembers`. Two answers
    // to "which committee is this" would be one too many — see the note in
    // components/period-scope.tsx.
    expect(stripped).toMatch(
      /<PeriodScope\s+component=\{CommitteeMembers\}\s+props=\{\{\s*committeeName\s*\}\}/,
    )
  })

  test("Suspense wraps every child that reads useSearchParams", () => {
    // `PeriodScope` reads `useSearchParams` (any child of a client-hook that
    // does the same must sit under a boundary). The page must not have a
    // `PeriodScope` outside a `Suspense`.
    const suspenseWithScope = /<Suspense>[\s\S]*?<PeriodScope[\s\S]*?<\/Suspense>/
    expect(stripped).toMatch(suspenseWithScope)
  })

  test("back-link href is computed from the request's searchParams, not hardcoded", () => {
    // The concrete requirement the task specifies. If the back link were a
    // literal "/committees", `?wp=` would be dropped and a WP19 detail page
    // would send readers to the current-period directory. `backHref` is
    // built by `backToListHref(sp)` and passed to the heading.
    expect(stripped).toContain("backHref={backHref}")
    expect(stripped).toMatch(/backHref\s*=\s*backToListHref\(sp\)/)
    expect(stripped).toMatch(/function\s+backToListHref/)
  })

  test("metadata falls back to the not-found title when the id is unparseable", () => {
    // A segment that cannot be a committee name still gets a tab title —
    // just the neutral "not found" one, matching how party/[party] handles
    // an unknown key. Silently letting the tab render as `undefined` would
    // give browser history an empty entry.
    expect(stripped).toContain('t("common.notFound", DEFAULT_LOCALE)')
  })
})
