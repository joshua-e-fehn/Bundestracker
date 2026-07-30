import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * Source-text guards on `/committees`.
 *
 * ## Why this is a source-text test
 *
 * `bun test` has no layout engine and no React runtime — the harness the whole
 * repo uses is "assert against the source with comments stripped" (see
 * `app/page.test.ts` for the extended note). What is checked here is the
 * *shape* of the page: the pieces it must wire up because omitting any one of
 * them takes the page's contract with the reader down.
 *
 *  - `Suspense` around `PeriodScope` — `useSearchParams` inside the scope opts
 *    the subtree out of static prerender, and Next 16 fails the build without
 *    a boundary above it. The same note lives on `app/rankings/page.tsx`.
 *  - `PeriodScope` wraps the directory — without it, a shared
 *    `/committees?wp=19` link would render the current period instead of the
 *    named one, and the page would be a filter-on-URL that ignored the URL.
 *  - `PageHeading` with `committees.title` — the tab title in metadata is
 *    already set to the same key; if these ever disagree, either the page
 *    lacks a heading or the tab lies about what page it is on.
 *  - German metadata — mirroring every other route on the site; the tab
 *    title cannot see the client-side locale toggle.
 */

const source = readFileSync(new URL("./page.tsx", import.meta.url).pathname, "utf8")
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("/committees page shell", () => {
  test("PeriodScope drives the directory, not a bare component", () => {
    // A `<CommitteeDirectory />` at this level would ignore `?wp=` — the
    // page would render the current period regardless of what the URL asked
    // for. `PeriodScope` is the one component that reads the parameter and
    // installs a `PeriodProvider`; every link inside the page depends on
    // that provider to carry the period forward.
    expect(stripped).toMatch(/<PeriodScope\s+component=\{CommitteeDirectory\}/)
  })

  test("the Suspense boundary is above PeriodScope", () => {
    // The reason is not decorative — `useSearchParams` inside `PeriodScope`
    // opts the subtree out of static prerender, and Next 16 fails the build
    // without a boundary above it. Losing the boundary passes typecheck but
    // fails `bun run build`. This test fails at unit-test time instead.
    expect(stripped).toMatch(/<Suspense>[\s\S]*?<PeriodScope/)
  })

  test("the heading uses the same key the tab title does", () => {
    // A page whose <h1> and <title> disagree tells the reader they are on a
    // different page than they thought — a shape bug that has broken linking
    // on this site before. Both keys are `committees.title`, so this pins
    // the heading side; the metadata block just below pins the tab side.
    expect(stripped).toMatch(/titleKey="committees\.title"/)
    expect(stripped).toMatch(/subtitleKey="committees\.subtitle"/)
  })

  test("metadata carries the same German title and description", () => {
    // Mirrors app/parties/page.tsx and app/motions/page.tsx: `generateMetadata`
    // cannot see the client-side language toggle, so the tab is German and
    // the page body switches. Anything else here would ship a page whose tab
    // renames itself when the reader changes language, or whose tab differs
    // from the h1 in both languages.
    expect(stripped).toContain('t("committees.title", DEFAULT_LOCALE)')
    expect(stripped).toContain('t("committees.subtitle", DEFAULT_LOCALE)')
  })
})
