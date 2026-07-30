import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The referrals disclosure's wiring, asserted against the source.
 *
 * Same style as components/vote-explanations-disclosure.test.ts and for the
 * same reason: `bun test` has no DOM in which to click. The browser check is
 * the real verification; these buy the cheap half — the specific wrong
 * versions are caught in CI rather than by a reader.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url).pathname, "utf8")
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const disclosure = stripComments(read("./committee-referrals-disclosure.tsx"))
const motionList = stripComments(read("./motion-list.tsx"))

describe("the disclosure never fetches while collapsed", () => {
  test("useQuery is skipped when the panel is closed", () => {
    // Otherwise a page of 25 motions opens 25 subscriptions on render — the
    // exact bug motion-sponsors' `"skip"` sentinel exists to prevent. This
    // matches the sponsors pattern verbatim.
    expect(disclosure).toMatch(/open\s*&&\s*dipVorgangId\s*!==\s*null\s*\?\s*\{[^}]+\}\s*:\s*"skip"/)
  })

  test("the query is getReferralsByMotion, not something per-MP", () => {
    // A per-MP index does not exist on this table by design — see
    // convex/committeeReferrals.test.ts. Reaching for one from the UI would
    // manufacture the shape the schema refuses to build.
    expect(disclosure).toMatch(/api\.committeeReferrals\.getReferralsByMotion/)
    expect(disclosure).not.toMatch(/mpInternalId/)
  })
})

describe("coverage is read once at the page level, threaded down", () => {
  test("the disclosure never fetches coverage — the page does, through the cheap boolean", () => {
    // A per-row coverage fetch would run the same period-wide read once per
    // motion. Reading it in the caller and passing `hasAnyForPeriod` down
    // is the same shape components/vote-detail.tsx uses for §31.
    //
    // Two family names are excluded here, not one. `hasAnyReferralsForPeriod`
    // is the cheap boolean the UI uses. `getReferralCoverage` is the count
    // form kept for operators — a caller reintroducing *either* here would
    // be a regression, and the caller must stay on the boolean rather than
    // reverting to the count form whose `.collect()` grows with the period.
    expect(disclosure).not.toMatch(/api\.committeeReferrals\.hasAnyReferralsForPeriod/)
    expect(disclosure).not.toMatch(/api\.committeeReferrals\.getReferralCoverage/)
    expect(motionList).toMatch(/api\.committeeReferrals\.hasAnyReferralsForPeriod/)
    expect(motionList).not.toMatch(/api\.committeeReferrals\.getReferralCoverage/)
  })

  test("the empty state branches on hasAnyForPeriod", () => {
    // "Not backfilled" and "no referral for this motion" are different
    // claims and only one is the reader's doing. The disclosure has both
    // sentences and picks between them from the coverage prop.
    expect(disclosure).toMatch(/hasAnyForPeriod\s*===\s*false/)
    expect(disclosure).toMatch(/t\("referrals\.emptyPeriodNotBackfilled"\)/)
    expect(disclosure).toMatch(/t\("referrals\.emptyNoReferral"\)/)
  })
})

describe("the boundary is stated to the reader, not just to the schema", () => {
  test("the caveat is rendered whenever the list is", () => {
    // A referral names a committee and a document, never a person. The
    // reader should not be able to leave the list without having read
    // that; `referrals.caveat` is where the file says so.
    expect(disclosure).toMatch(/t\("referrals\.caveat"\)/)
  })

  test("no branch renders a per-MP name from a referral row", () => {
    // A referral row carries no MP field — see
    // convex/committeeReferrals.test.ts. A UI reading `row.mpInternalId`
    // would be reading from a schema field the schema promised not to
    // have.
    expect(disclosure).not.toMatch(/row\.mpInternalId/)
    expect(disclosure).not.toMatch(/row\.name/)
    expect(disclosure).not.toMatch(/row\.fraktion/)
  })

  test("the three states of leadCommittee stay three states", () => {
    // Null is not false and false is not null. Folding either into a
    // boolean sort or a single label would claim the source had said
    // something it did not; convex/committeeReferrals.test.ts asserts the
    // same rule schema-side.
    expect(disclosure).toMatch(/leadCommittee\s*===\s*true/)
    expect(disclosure).toMatch(/leadCommittee\s*===\s*false/)
  })
})

describe("accessibility contract", () => {
  test("the toggle carries aria-expanded and aria-controls", () => {
    expect(disclosure).toMatch(/aria-expanded=\{open\}/)
    expect(disclosure).toMatch(/aria-controls=\{panelId\}/)
  })

  test("the panel id is derived from the motion's Convex id so rows cannot collide", () => {
    // Keyed on the motion's own Convex id, not the Vorgang id. The Vorgang
    // is nullable and can repeat as `null` across every Drucksache-only row
    // on a page — any fallback sentinel produces
    // `id="committee-referrals-unlinked"` on multiple panels, violating
    // HTML id-uniqueness and making the aria-controls association
    // ambiguous. The failure was measured against a page carrying three
    // such rows before this key choice was fixed.
    expect(disclosure).toMatch(/panelId\s*=\s*`committee-referrals-\$\{motionId\}`/)
  })

  test("the panel stays mounted with its id even while collapsed", () => {
    expect(disclosure).toMatch(/id=\{panelId\}\s+hidden=\{!open\}/)
  })
})

describe("integration with motion-list", () => {
  test("motion-list threads referrals coverage through to every row", () => {
    // A row that fetched coverage itself would be exactly the per-row
    // read the page-level fetch is designed to avoid.
    expect(motionList).toMatch(/hasAnyReferralsForPeriod=\{hasAnyReferrals\}/)
    expect(motionList).toMatch(/CommitteeReferralsDisclosure/)
  })

  test("the row passes both motionId and dipVorgangId to the disclosure", () => {
    // `motionId` for the panel id (collision-safe across Drucksache-only
    // rows), `dipVorgangId` for the actual query. A row missing either
    // would either collide with a sibling's panel or render the wrong
    // linkage arm. See the schema note on `motions`.
    expect(motionList).toMatch(/motionId=\{motion\.id\}/)
    expect(motionList).toMatch(/dipVorgangId=\{motion\.dipVorgangId\}/)
  })
})
