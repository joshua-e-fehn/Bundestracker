import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * Source-text guards on the `/committees` directory client component.
 *
 * The bugs this class of test catches, restated for this file: it cannot
 * render the component in a real DOM (no jsdom in this harness), but every
 * bug it does catch is one where a class of failure is settled by whether a
 * line is in the source at all. Three of those apply here:
 *
 *  - **The source caveat renders for closed periods.** Without
 *    `SourceCoverageNote`, `/committees?wp=19` would render a bare empty
 *    list — the exact silent-lie the header of convex/committees.ts warns
 *    against ("the UI must not present emptiness as a finding"). A refactor
 *    that dropped this line would ship the caveat missing.
 *  - **Detail links use `committeeHref` and `usePeriodHref`.** A hand-built
 *    `href` would preserve neither the encoding contract of committee names
 *    (see lib/committees.ts) nor the page's period, and the two failures
 *    look nothing alike.
 *  - **Search folds the input.** `foldName` is what lets `für` and `fuer`
 *    match — omitting it makes the search miss the two committees with
 *    umlauts.
 */

const source = readFileSync(
  new URL("./committee-directory.tsx", import.meta.url).pathname,
  "utf8",
)
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("CommitteeDirectory", () => {
  test("renders SourceCoverageNote for closed periods", () => {
    // The whole reason this component's empty state is not a plain paragraph.
    // See the header of convex/committees.ts, which warns in as many words:
    // an empty list must not read as a finding.
    expect(stripped).toContain("<SourceCoverageNote")
    expect(stripped).toContain('source="committees"')
  })

  test("consumes the current period from usePeriod, not from a re-derivation", () => {
    // A second answer to "which period is current" is one too many — see the
    // note in components/providers/period-provider.tsx. `SourceCoverageNote`
    // needs `current`, and this is where it comes from.
    expect(stripped).toMatch(/const\s*\{\s*current\s*\}\s*=\s*usePeriod\(\)/)
  })

  test("detail links go through committeeHref and usePeriodHref", () => {
    // `committeeHref` owns the encoding of committee names into URL segments
    // (see lib/committees.ts). `usePeriodHref` is what carries the page's
    // period into the destination. A hand-built href like
    // `/committees/${name}?wp=…` would fail on both counts.
    expect(stripped).toContain("committeeHref(")
    expect(stripped).toContain("usePeriodHref()")
  })

  test("search input folds through foldName", () => {
    // `foldName` folds `ß` to `ss` and drops combining marks — so "für"
    // matches "fur" and vice versa. Two WP21 committees carry umlauts
    // (`Ausschuss für Digitales`, `Ausschuss für …`), so a naive
    // `String.includes` would miss them for an English reader typing "fur".
    expect(stripped).toContain("foldName(")
  })

  test("the row calls out the seat-count wording, not membership-count", () => {
    // "Seats" is the language the audit and convex/committees.ts use for the
    // number this component renders — one row per (MP, committee), so a
    // chair counts once. The i18n key `committees.memberCount` interpolates
    // that; the singular sibling exists so "1 Sitz" reads correctly.
    expect(stripped).toContain('t("committees.memberCount"')
    expect(stripped).toContain('t("committees.memberCountOne")')
  })
})
