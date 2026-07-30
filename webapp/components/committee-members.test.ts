import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * Source-text guards on the `/committees/[id]` roster.
 *
 * Three states, three shapes — see the header of committee-members.tsx. This
 * test pins that each of the three is wired to the right source of truth and
 * cannot be silently collapsed into the wrong one.
 *
 *  - **Source-unavailable branch** uses `sourceUnavailable` — the same
 *    predicate every other surface uses — rather than a hand-rolled
 *    `wahlperiode < current`. That is what keeps every closed-period surface
 *    on one answer, and what stops a future WP22 from silently marking WP21
 *    unavailable.
 *  - **Empty-in-current-period branch** shows `unknownCommittee` copy, not
 *    the historical caveat. The two look identical in the roster (both are
 *    empty) and opposite to the reader — see the header of
 *    components/source-coverage-note.tsx.
 *  - **MP profile links** go through `useMPHref`, which carries the period.
 *    A hand-built `/mps/${id}` would drop the period and 404 on an MP whose
 *    mandate ended in the previous period.
 */

const source = readFileSync(
  new URL("./committee-members.tsx", import.meta.url).pathname,
  "utf8",
)
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("CommitteeMembers", () => {
  test("uses sourceUnavailable to decide the closed-period branch", () => {
    // A hand-rolled `wahlperiode < current` here would drift the moment
    // committees ever become available for a closed period (they will not
    // become so under the current source, but the pattern must not encode
    // that as a hard-coded comparison — see the note in lib/period.ts).
    expect(stripped).toContain("sourceUnavailable(")
    expect(stripped).toContain('"committees"')
  })

  test("renders SourceCoverageNote in the unavailable branch", () => {
    // The caveat that names *why* the roster is empty on a closed period.
    // Silently rendering "no members" would be the exact failure
    // convex/committees.ts warns against.
    expect(stripped).toContain("<SourceCoverageNote")
  })

  test("empty-in-current-period uses unknownCommittee copy", () => {
    // The three-state split: this string is the one that appears when the
    // source *is* published for this period and the committee name is not on
    // record — a stale URL or a mid-period rename. It must not be swapped
    // for the historical caveat (they say opposite things).
    expect(stripped).toContain('t("committees.detail.unknownCommittee")')
  })

  test("MP profile links go through useMPHref", () => {
    // The hook that carries the page's period into every MP profile link —
    // the one thing that stops a WP19 committee link from opening a WP21
    // profile. Nine other list components already use it; this is the tenth.
    expect(stripped).toContain("useMPHref()")
    expect(stripped).toContain("mpHref(member.mpInternalId)")
  })

  test("shows PartyBadge — not the raw fraktion string", () => {
    // The reader sees the folded, colour-coded label. A raw string here
    // would show `Fraktion der …` (the Stammdaten long form) alongside
    // `CDU/CSU` (the vote-sheet short form) — the exact §6.4 spelling drift
    // lib/parties.ts exists to hide.
    expect(stripped).toContain("<PartyBadge")
  })

  test("role is rendered raw when present, and neutrally when null", () => {
    // Role values are German proper nouns from Stammdaten
    // (`Vorsitzender`, `Obmann`, `Stellvertretendes Mitglied`) — translating
    // them would either drop distinctions or invent them. When absent, a
    // neutral placeholder rather than "Ordentliches Mitglied", because the
    // source authoritatively says nothing.
    expect(stripped).toContain("member.role")
    expect(stripped).toContain('t("committees.detail.roleUnspecified")')
  })
})
