import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The MP profile's §31 declarations panel — asserted against the source.
 *
 * `bun test` has no DOM, so the browser check verifies the render. These pin
 * the specific wrong versions of the panel that would look right and mislead a
 * reader — same trade-off as vote-explanations-disclosure.test.ts.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url).pathname, "utf8")
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const records = stripComments(read("./mp-recent-records.tsx"))
const dictionary = stripComments(read("../lib/i18n.ts"))

describe("the §31 declarations panel", () => {
  test("reads getExplanationsByMP for this MP in this Wahlperiode", () => {
    // A per-MP, per-period read — not a period-wide `getExplanationsByMotion`
    // that would sweep every declaration of the Bundestag and filter. The
    // profile page is one member; the query is designed for exactly that
    // shape. Cap is Math.max(1, Math.min(100, floor(limit ?? 25))) —
    // hard ceiling 100, default 25 — verified in convex/voteExplanations.ts.
    // F-11 fix: this comment used to say "25-row cap", which is the
    // *default*, not the ceiling.
    expect(records).toMatch(/api\.voteExplanations\.getExplanationsByMP/)
  })

  test("reads hasAnyExplanationsForPeriod for the coverage arm", () => {
    // The cheap boolean — one document at most, bounded on the period index.
    // The count form (`getExplanationCoverage`) `.collect()`s the whole
    // period and is deliberately not used on the browser page. Same rule
    // that vote-explanations-disclosure.tsx follows via its caller.
    expect(records).toMatch(/api\.voteExplanations\.hasAnyExplanationsForPeriod/)
    expect(records).not.toMatch(/api\.voteExplanations\.getExplanationCoverage/)
  })

  test("coverage decides between two distinct empty sentences", () => {
    // A shared key would fold "period not backfilled" into "this MP filed
    // none", which is exactly the collapse vote-explanations-disclosure
    // documents at length. Two states, two keys, one query result.
    expect(records).toMatch(/hasAnyForPeriod === false/)
    expect(records).toMatch(/t\("mp\.explanationsPeriodNotBackfilled"\)/)
    expect(records).toMatch(/t\("mp\.noExplanations"\)/)
  })

  test("loading gates emptiness until BOTH queries resolve", () => {
    // Rendering "no declarations" while coverage is still `undefined` would
    // flash a positive claim about the member on a period we haven't yet
    // checked — the exact bug the vote-explanations disclosure guards
    // against with the same rule.
    expect(records).toMatch(
      /explanations === undefined \|\| hasAnyForPeriod === undefined/,
    )
  })
})

describe("the panel never generates or paraphrases a reason", () => {
  test("no forbidden field is read from a row", () => {
    // `voteExplanationInput` carries no prose column
    // (convex/voteExplanations.test.ts asserts that schema-side). This side
    // must not synthesise one either — the caveat below the list says as
    // much, and the browser row must not add a field the schema forbids.
    for (const forbidden of [
      "row.reason",
      "row.summary",
      "row.explanation",
      "row.rationale",
      "row.text",
      "row.body",
    ]) {
      expect(records).not.toContain(forbidden)
    }
  })

  test("the caveat is present on the populated arm", () => {
    // The rule the whole feature turns on, restated wherever the list is —
    // a reader who scanned the rows must not leave without having read it.
    expect(records).toMatch(/t\("voteExplanations\.caveat"\)/)
  })

  test("the source link points at the stored URL, not a fabricated one", () => {
    // `sourceUrl` is the deep link into the protocol PDF, per the schema.
    // A `href={protocolPdfUrl(...)}` here would build a URL to the *sitting*
    // rather than to the declaration's page, which is a different — and
    // worse — reference. `SourceLink` accepts the raw `row.sourceUrl` and
    // routes it through `safeExternalUrl` internally (see the F-10 guard),
    // so the panel row still names the stored value on the surface.
    expect(records).toMatch(/href=\{row\.sourceUrl\}/)
  })

  test("SourceLink routes the href through safeExternalUrl before rendering", () => {
    // The F-01/F-10 render-time guard: a `javascript:` or `data:` URL that
    // landed in `voteExplanations.sourceUrl` — a data-side regression — must
    // not reach `<a href>`. `SourceLink` calls `safeExternalUrl(href)` and
    // returns null when it returns null. The behavioural tests for the
    // helper live in `lib/bundestag.test.ts`; this asserts the wiring.
    expect(records).toMatch(/safeExternalUrl\(href\)/)
  })

  test("SourceLink emits rel='noopener noreferrer' (not just noreferrer)", () => {
    // F-01: `noreferrer` alone leaks `window.opener` on stale WebView /
    // ancient Chromium. Every other outbound link on the site pairs both;
    // this was the last one that did not, and now does.
    expect(records).toMatch(/rel="noopener noreferrer"/)
    // Guard against a regression to the old form. `noopener noreferrer` may
    // legitimately appear in a docstring — narrow the negation to actual
    // JSX attributes on `<a>` in this file.
    const badPattern = /<a\b[^>]*\brel="noreferrer"(?!\s*noopener)/
    expect(records).not.toMatch(badPattern)
  })
})

describe("panel headings sit inside the h1 hierarchy (F-05)", () => {
  test("the shared Panel renders its title as an <h2>, not a bare <div>", () => {
    // F-05: `CardTitle` used to be a `<div>`, so the MP profile's heading
    // list had exactly one entry (the member's name) and a screen-reader
    // reader could not jump between the five landmark panels. `Panel` in
    // this file wraps all five, and `CardTitle as="h2"` is what lifts them
    // into the heading hierarchy under the profile's `<h1>`.
    expect(records).toMatch(/CardTitle as="h2">\{title\}<\/CardTitle>/)
  })

  test("no Panel CardTitle drops the `as` prop — regression guard", () => {
    // If a future edit split `Panel` into a per-panel variant that lost
    // `as="h2"`, the five panels would silently regress to `<div>`. The
    // grep pins the shape: every CardTitle in this file must carry `as=`.
    const allCardTitles = records.match(/<CardTitle\b[^>]*>/g) ?? []
    expect(allCardTitles.length).toBeGreaterThan(0)
    for (const opener of allCardTitles) {
      expect(opener).toMatch(/\bas="h[2-6]"/)
    }
  })
})

describe("the CardTitle primitive accepts `as` — F-05 support", () => {
  const card = stripComments(read("./ui/card.tsx"))

  test("CardTitle accepts an `as` prop typed to h2-h6 or div", () => {
    // The primitive is what makes the callers above work. Guarding the
    // signature here rather than trusting typescript alone because a
    // future refactor that widened `as` to `keyof JSX.IntrinsicElements`
    // would trade the deliberate closed union for an accidental
    // "anything goes"; and one that narrowed it below `h2` would silently
    // undo the fix.
    expect(card).toMatch(/type CardTitleAs = "h2" \| "h3" \| "h4" \| "h5" \| "h6" \| "div"/)
    expect(card).toMatch(/as: As = "div"/)
  })
})

describe("the dictionary has both locales for every new key the panel uses", () => {
  test("German and English are both populated for mp.latestExplanations", () => {
    // Missing an English translation would fall through to the German
    // string, which is silently the wrong locale for an EN reader. The
    // dictionary is the schema (see the header of lib/i18n.ts), so a key
    // added to one and not the other should be a test failure rather than
    // a browser oddity.
    const german = /"mp\.latestExplanations": "Neueste Erklärungen nach §31 GO-BT"/
    const english = /"mp\.latestExplanations": "Latest §31 GO-BT declarations"/
    expect(dictionary).toMatch(german)
    expect(dictionary).toMatch(english)
  })

  test("both empty-state sentences exist in both locales", () => {
    for (const key of [
      "mp.noExplanations",
      "mp.explanationsPeriodNotBackfilled",
      "mp.explanationSubjectMissing",
    ]) {
      // A "key was added but only in one locale" mistake would render the
      // raw key on the other side, which the reader sees as a bug label.
      // Two matches means both dictionaries have it.
      const matches = dictionary.match(new RegExp(`"${key.replace(".", "\\.")}":\\s*"`, "g"))
      expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2)
    }
  })
})
