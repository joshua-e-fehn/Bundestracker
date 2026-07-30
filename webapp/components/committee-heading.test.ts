import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * Source-text guards on the committee detail heading.
 *
 * The one property that has to hold, and would not be caught by anything
 * else: the heading is a *stateless* client component. It reads no context,
 * no URL params, no queries — every value it needs comes in as a prop. That
 * is the shape that lets it render before `PeriodScope` runs, which is what
 * lets the page show the title over the "not published for this period"
 * caveat.
 *
 * A refactor that pulled `useSearchParams` (or `usePeriod`, or `usePeriodHref`)
 * back into this file would force a `<Suspense>` boundary above it and
 * silently change the page's rendering order — the title would flicker in
 * after the caveat, or worse, the boundary shape would break the build the
 * next time someone forgot to update the enclosing `<Suspense>`.
 */

const source = readFileSync(
  new URL("./committee-heading.tsx", import.meta.url).pathname,
  "utf8",
)
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("CommitteeHeading", () => {
  test("takes backHref as a prop — no useSearchParams inside", () => {
    // The whole reason the enclosing page computes `backHref` server-side.
    // See the header comments on both files.
    expect(stripped).toContain("backHref")
    expect(stripped).not.toContain("useSearchParams")
  })

  test("renders the committee name verbatim as an h1", () => {
    // No translation, no wrapping — the name is a proper noun from
    // Stammdaten and must reach the reader exactly as the source printed it.
    expect(stripped).toMatch(/<h1[^>]*>\{committeeName\}<\/h1>/)
  })

  test("back link uses backHref, not a hardcoded path", () => {
    // A hardcoded `/committees` would drop `?wp=` — the exact failure the
    // whole `backHref` plumbing prevents.
    expect(stripped).toMatch(/href=\{backHref\}/)
  })
})
