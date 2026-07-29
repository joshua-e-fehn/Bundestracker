import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * A guard on the home page's title fitting the narrowest screen.
 *
 * ## The bug
 *
 * The wordmark opened at `text-5xl` — 48px — with no step below `sm:`. That
 * size applied from a 0px viewport all the way to 639px, and "Bundestracker"
 * is a single unbreakable word, so its *min-content* width is the entire
 * wordmark: there is no wrap point for the layout engine to take. Measured in
 * Chromium at `font-semibold` with this tracking, 48px needs **325px** and the
 * content box at a 320px viewport is **288px** (`main` carries `px-4`).
 *
 * The 37px it could not have came out of the page. The `<h1>` sits in a
 * `grid gap-3` whose implicit column is `auto`, which sizes to its widest item
 * and refuses to shrink below it, so the track took 325px, the `<header>` grew
 * with it, and the document — which scrolls as one — was **20px wider than the
 * screen**. Every route is unaffected; `/` alone overflowed, in both locales.
 *
 * That is the same failure shape as the sidebar's overflowing group labels
 * (components/nav-sidebar.tsx): an `auto` grid track pinned open by content
 * that cannot wrap. It is recorded twice because the two fixes are different —
 * there the track was constrained with `minmax(0,1fr)`, here the *content* is
 * made smaller, because a wordmark clipped by `overflow-hidden` or shrunk by a
 * `minmax` would be a title page whose title is cut in half.
 *
 * ## Why the test is written against the source text
 *
 * The bug is only reproducible in a real layout engine: it needs font metrics,
 * a resolved `px-4`, and grid track sizing, none of which `bun test` has. A
 * jsdom harness would not reproduce it either — jsdom does not lay text out and
 * reports every width as 0. The browser check is the real verification; this
 * makes the regression fail on the commit that reintroduces it rather than on a
 * reader's phone, which is the same trade
 * `components/providers/theme-color.test.ts` and
 * `components/nav-sidebar.test.ts` make for the same reason.
 *
 * It guards the property that actually matters — that the *smallest* step of
 * the ramp is one that fits — rather than pinning an exact class, so restyling
 * the hero stays free as long as it still fits a 320px screen.
 */

const source = readFileSync(new URL("./page.tsx", import.meta.url).pathname, "utf8")

/** The file with comments stripped, so the prose above the `<h1>` — which
 * names `text-5xl` while explaining why it is not used — cannot satisfy a
 * check looking for the class being *applied*. */
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/** The `<h1>`'s class list. */
const heading = stripped.match(/<h1 className="([^"]+)"/)?.[1] ?? ""

/**
 * What "Bundestracker" needs, in px, at each step of Tailwind's type scale.
 *
 * Measured in Chromium against the deployed page at `font-semibold` and
 * `tracking-tight` (-0.025em) rather than computed from a metric, because the
 * value that matters is the one the reader's browser arrives at with the font
 * that actually loaded.
 */
const WORDMARK_WIDTH_PX: Record<string, number> = {
  "text-3xl": 204,
  "text-4xl": 248,
  "text-5xl": 325,
  "text-6xl": 400,
}

/** The narrowest viewport the site supports, and the gutter `main` puts either
 * side of it (`px-4`). 320px is the floor because it is the iPhone SE / older
 * Android width and the narrowest thing in common use. */
const NARROWEST_VIEWPORT_PX = 320
const MAIN_GUTTER_PX = 16
const CONTENT_BOX_PX = NARROWEST_VIEWPORT_PX - MAIN_GUTTER_PX * 2

describe("the home page title fits the narrowest screen", () => {
  test("the unprefixed size fits a 320px viewport", () => {
    // The base (unprefixed) size is the one that applies at 320px — every
    // breakpoint variant here is `min-width`, so none of them are in play.
    const base = heading
      .split(/\s+/)
      .filter((c) => !c.includes(":"))
      .find((c) => c.startsWith("text-"))

    expect(base).toBeDefined()
    const needs = WORDMARK_WIDTH_PX[base as string]

    // An unmeasured size is a failure rather than a skip: silently passing for
    // a class this table does not know would make the guard vacuous the moment
    // someone picks `text-[2.5rem]`, which is exactly when it should speak up.
    expect(
      needs,
      `"${base}" is not in WORDMARK_WIDTH_PX — measure it in a browser at 320px and add it`,
    ).toBeDefined()

    expect(
      needs,
      `"${base}" needs ${needs}px but the content box at ${NARROWEST_VIEWPORT_PX}px is ${CONTENT_BOX_PX}px — ` +
        "the wordmark cannot wrap, so the grid track holds the page open and the whole document scrolls sideways",
    ).toBeLessThanOrEqual(CONTENT_BOX_PX)
  })

  test("the desktop size is unchanged", () => {
    // The correction is a step *below* the ramp, not a shrunken hierarchy. The
    // title page's scale from `sm` up is the design and is not what overflowed:
    // at 640px the 60px wordmark has 576px to sit in.
    expect(heading).toContain("sm:text-6xl")
  })

  test("the title page still leads with an h1", () => {
    // Cheap, and it pins the thing the two assertions above are about. A hero
    // restyled into a `<p>` would keep them both passing while removing the
    // page's only top-level heading.
    expect(stripped).toMatch(/<h1 className="[^"]*">\{t\("app\.name"\)\}<\/h1>/)
  })
})
