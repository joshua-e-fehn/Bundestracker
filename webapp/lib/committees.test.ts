import { describe, expect, test } from "bun:test"
import { committeeHref, parseCommitteeParam, summarizeCommittees } from "./committees"

/**
 * The URL contract for `/committees/[id]`.
 *
 * The bug this pins is a class rather than a specific case: a slug scheme
 * that agrees with `foldName`'s folding (drop diacritics, collapse
 * whitespace, lowercase) would map `Ausschuss für Digitales` and a
 * hypothetical `Ausschuss fur Digitales` to the same URL, and the inverse
 * lookup would answer with one of them arbitrarily. `committeeHref` is
 * pinned to `encodeURIComponent` for that reason (see the header of
 * lib/committees.ts) — this test states that pinning, so a refactor to a
 * "prettier" slug fails the check rather than the readers.
 */
describe("committeeHref", () => {
  test("round-trips through decodeURIComponent for the real WP21 names", () => {
    // The names in this list are the ones sampled by the audit against
    // convex/schema.ts:678–682 and the seed fixtures — the shape a live
    // deployment has today. Every one must survive the trip, or the URL is a
    // lossy id.
    const names = [
      "Auswärtiger Ausschuss",
      "Haushaltsausschuss",
      "Rechtsausschuss",
      "Innenausschuss",
      "Ausschuss für Digitales",
      "Ausschuss für Klimaschutz und Energie",
      "Ausschuss für Verkehr",
      "Ausschuss für Gesundheit",
      "Ausschuss für Umwelt und Naturschutz",
      "Ausschuss für Inneres",
    ]
    for (const name of names) {
      const href = committeeHref(name)
      expect(href).toStartWith("/committees/")
      const segment = href.slice("/committees/".length)
      expect(decodeURIComponent(segment)).toBe(name)
    }
  })

  test("encodes characters that would break a naive interpolation", () => {
    // Spaces, umlauts, and a hypothetical forward slash (which no current
    // committee name contains, but which Stammdaten is not curated against —
    // §6.3 of docs/api-research.md notes the field is transcribed verbatim).
    // `encodeURIComponent` treats `/` as reserved and escapes it as `%2F`;
    // Next.js parses that inside a `[slug]` segment as one segment, not two.
    expect(committeeHref("Ausschuss für X")).toBe("/committees/Ausschuss%20f%C3%BCr%20X")
    expect(committeeHref("A/B")).toBe("/committees/A%2FB")
  })

  test("distinguishes names that differ only by diacritics", () => {
    // The failure a `foldName`-style slug would cause. Two names, two URLs;
    // no collapse.
    const a = committeeHref("Ausschuss für Digitales")
    const b = committeeHref("Ausschuss fur Digitales")
    expect(a).not.toBe(b)
  })
})

describe("parseCommitteeParam", () => {
  test("returns null for missing, blank, or control-only input", () => {
    // Absence and whitespace are treated the same as a missing segment — the
    // page renders the "unknown committee" empty state rather than crashing
    // on a query with an empty string. A segment made of ASCII control
    // characters (a stray escape sequence) is the same class of bad input.
    expect(parseCommitteeParam(undefined)).toBeNull()
    expect(parseCommitteeParam(null)).toBeNull()
    expect(parseCommitteeParam("")).toBeNull()
    expect(parseCommitteeParam("   ")).toBeNull()
    expect(parseCommitteeParam("\x00\x01")).toBeNull()
  })

  test("returns the trimmed name for a well-formed segment", () => {
    // A raw ASCII name from the URL segment. Round-trips through both
    // encode+decode (via `committeeHref`) unchanged.
    expect(parseCommitteeParam("Auswaertiger Ausschuss")).toBe("Auswaertiger Ausschuss")
    expect(parseCommitteeParam("  Haushaltsausschuss  ")).toBe("Haushaltsausschuss")
  })

  test("decodes percent-encoded URL segments — the App Router leaves them raw", () => {
    // The regression the browser smoke caught after the rebase: Next 16's
    // App Router `params` hands over the raw segment — no auto-decode —
    // so a page hydrated from `/committees/Ausschuss%20f%C3%BCr%20Digitales`
    // rendered `Ausschuss%20f%C3%BCr%20Digitales` in the `<h1>` while the
    // `<title>` (built via template literal) coerced the same value into
    // the decoded form and disagreed with the body. `app/mps/[id]/page.tsx`
    // already carries `decodeURIComponent(id)` for the same reason; folding
    // the decode into this helper is what stops the next detail route from
    // making the same mistake.
    expect(parseCommitteeParam("Ausschuss%20f%C3%BCr%20Digitales")).toBe(
      "Ausschuss für Digitales",
    )
    expect(parseCommitteeParam("A%2FB")).toBe("A/B")
  })

  test("preserves diacritics — the caller needs the exact source spelling", () => {
    // A pre-decoded segment stays as it is. `foldName`-style normalisation
    // would break the round-trip with `committeeHref` and it would break
    // the Convex query: `getCommitteeMembers` matches `committeeName`
    // verbatim on the index.
    expect(parseCommitteeParam("Ausschuss für Digitales")).toBe("Ausschuss für Digitales")
  })

  test("returns null for a malformed URL escape", () => {
    // `decodeURIComponent("%zz")` throws `URIError`. Rather than let a
    // stray `%` in a mis-typed URL crash the page render, the helper
    // treats it as "not a valid segment" — the caller then renders the
    // "unknown committee" body, which is the honest answer.
    expect(parseCommitteeParam("%zz")).toBeNull()
    expect(parseCommitteeParam("Ausschuss%")).toBeNull()
  })
})

describe("summarizeCommittees", () => {
  test("counts rows per committee and sorts by German collation", () => {
    // The reduction `getCommittees` does inline, pulled here so it can be
    // tested without a Convex handler. The upsert key
    // `(mpInternalId, wahlperiode, committeeName)` guarantees one row per
    // (member, committee), so the count is seats — the language
    // convex/committees.ts uses in its header.
    const rows = [
      { committeeName: "Haushaltsausschuss" },
      { committeeName: "Haushaltsausschuss" },
      { committeeName: "Auswärtiger Ausschuss" },
      { committeeName: "Rechtsausschuss" },
      { committeeName: "Rechtsausschuss" },
      { committeeName: "Rechtsausschuss" },
    ]
    const result = summarizeCommittees(rows)
    // German collation orders `ä` with `a`, so "Auswärtiger" leads
    // "Haushaltsausschuss" leads "Rechtsausschuss".
    expect(result.map((r) => r.committeeName)).toEqual([
      "Auswärtiger Ausschuss",
      "Haushaltsausschuss",
      "Rechtsausschuss",
    ])
    expect(result.map((r) => r.memberCount)).toEqual([1, 2, 3])
  })

  test("returns an empty list for no rows — not a placeholder", () => {
    // The state a closed electoral period is in. No fabricated committees,
    // no "0 seats" row: the caller renders `SourceCoverageNote` above the
    // list, and an empty list is what lets that note stand as the answer.
    expect(summarizeCommittees([])).toEqual([])
  })

  test("does not fold diacritics — different names stay different", () => {
    // The other half of the URL contract above: on the *data* side, two
    // names that a slug would collapse must stay two committees. A user hits
    // `/committees` and sees both, or the list is a lie.
    const rows = [
      { committeeName: "Ausschuss für Digitales" },
      { committeeName: "Ausschuss fur Digitales" },
    ]
    const result = summarizeCommittees(rows)
    expect(result).toHaveLength(2)
  })
})
