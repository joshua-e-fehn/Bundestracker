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
    // shape (25-row cap in convex/voteExplanations.ts).
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
    // worse — reference.
    expect(records).toMatch(/href=\{row\.sourceUrl\}/)
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
