import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The sitting-detail component's wiring, asserted against the source.
 *
 * `bun test` has no DOM, no React renderer and no Convex client, so there is
 * nothing here to click. Same trade-off as
 * components/vote-explanations-disclosure.test.ts: text assertions catch the
 * *specific* wrong versions that would look correct, and the browser check is
 * the real verification.
 *
 * Each test below names a wrong version of the file it guards.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url).pathname, "utf8")
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const detail = stripComments(read("./sitting-detail.tsx"))
const voteDetail = stripComments(read("./vote-detail.tsx"))

describe("the sitting page reads exactly the two truthful queries", () => {
  test("speeches come from getSpeechesBySitting, sorted in document order there", () => {
    // Delegating the sort is what keeps it truthful — the query index scans
    // the speech table and orders by `speechIndex` (§5.2). A client-side
    // reorder here would risk drifting from that contract.
    expect(detail).toMatch(/api\.speeches\.getSpeechesBySitting/)
  })

  test("ballots come from getVoteSheetsBySitting, not from a period-wide query", () => {
    // `getVoteSheets` would return the whole period and let the client filter,
    // which is the bug the sitting-scoped query exists to prevent — a WP19
    // sitting page would fetch every WP19 ballot before showing a handful.
    expect(detail).toMatch(/api\.votes\.getVoteSheetsBySitting/)
    expect(detail).not.toMatch(/api\.votes\.getVoteSheets\b/)
  })
})

describe("no procedural claim is made that the sources do not carry", () => {
  // Every one of these labels would be a lie the moment it rendered — the
  // Bundestag does not publish any of it as a field. Grep-tested from the
  // outside because a future edit could accidentally add one; the whole
  // point of the component is that it does not.
  test("no sitting duration, attendance rate, or agenda-total label", () => {
    for (const forbidden of [
      "duration",
      "Dauer",
      "sittingDuration",
      "attendance",
      "Anwesenheit",
      "attendanceRate",
      "agendaCount",
      "quorumMet",
      "presenceRate",
    ]) {
      // Case-sensitive: the forbidden words are labels, not identifiers we
      // control the casing of. A label sneaking in as "Anwesenheit" is the
      // shape this catches.
      expect(detail).not.toContain(forbidden)
    }
  })

  test("word count is per-segment only, taken from the row rather than summed", () => {
    // Summing `wordCount` across the sitting would be a real-looking figure
    // that means nothing — a segment count including Zwischenfragen is not a
    // "total sitting words". `mp.wordCount` renders per row, matching the
    // profile's speech panel.
    expect(detail).toMatch(/row\.speech\.wordCount/)
    // A sum would look like `.reduce(` over speeches.
    expect(detail).not.toMatch(/speeches\.reduce/)
  })
})

describe("the four states are distinct and each has its own wording", () => {
  test("loading is decided by both queries being undefined", () => {
    // A loading rule that watched only speeches would flash "no ballots" for
    // the fraction of a second the ballots query was still in flight — a
    // false positive claim about a sitting.
    expect(detail).toMatch(
      /const loading = speeches === undefined \|\| sheets === undefined/,
    )
  })

  test("the empty state fires only when BOTH lists are empty", () => {
    // A page-empty check on either list alone would suppress the populated
    // half of a sitting that had one but not the other — WP19's early
    // sittings had speeches without XLSX ballots, and later sittings can
    // hold ballots the protocol XML has not yet parsed.
    expect(detail).toMatch(/speeches\.length === 0 && sheets\.length === 0/)
  })

  test("each empty branch has its own i18n key rather than sharing one", () => {
    // Two empty states, two sentences. A shared "empty" key would fold the
    // period-not-loaded case into a ballot-nothing-happened claim — the
    // failure the ballot-detail disclosure's tests also guard.
    expect(detail).toMatch(/t\("sitting\.emptyTitle"/)
    expect(detail).toMatch(/t\("sitting\.noSpeeches"\)/)
    expect(detail).toMatch(/t\("sitting\.noBallots"\)/)
  })

  test("SourceCoverageNote renders in each empty state so a source boundary is honest", () => {
    // WP17 and earlier have no speech source at all; WP18 has no ballot
    // source. The empty states must say so — a bare "no speeches" over WP17
    // reads as a claim about the sitting when it is a claim about the
    // corpus. Delegated to `SourceCoverageNote`, which every other empty
    // state on the site uses.
    expect(detail).toMatch(/SourceCoverageNote/)
    expect(detail).toMatch(/source="speeches"/)
    expect(detail).toMatch(/source="votes"/)
  })
})

describe("outbound links inherit the sitting's own Wahlperiode", () => {
  test("MP links go through useMPHref, not a bare string", () => {
    // The provider carries the page's period into the link. A hand-built
    // `/mps/${id}` would drop the period and land a WP19 sitting's speaker
    // link on the sitting speaker's WP21 profile.
    expect(detail).toMatch(/useMPHref\(\)/)
    expect(detail).toMatch(/mpHref\(row\.speech\.mpInternalId\)/)
  })

  test("ballot links go through usePeriodHref, and encode the sheet id", () => {
    // The sheet id is opaque Convex text; `encodeURIComponent` is defensive
    // rather than load-bearing today (ids do not contain reserved chars),
    // but the pattern matches every other outbound link on the site.
    expect(detail).toMatch(/usePeriodHref\(\)/)
    expect(detail).toMatch(/periodHref\(`\/votes\/\$\{encodeURIComponent\(sheet\.id\)\}`\)/)
  })
})

describe("the protocol PDF is always reachable", () => {
  test("the header renders it unconditionally", () => {
    // The URL is deterministic (`protocolPdfUrl` in lib/bundestag.ts) and
    // belongs to bundestag.de — it works whether or not we hold any rows for
    // the sitting. That is the load-bearing property: the empty state has
    // to offer *some* source, and this one is available for every period.
    expect(detail).toMatch(/protocolPdfUrl\(wahlperiode, sitzungnr\)/)
    expect(detail).toMatch(/t\("sitting\.openProtocol"\)/)
  })
})

describe("the vote-detail sitting label links to the sitting page", () => {
  test("vote-detail wraps t('votes.sitting') in a Link to /sittings/{wp}/{sitzungnr}", () => {
    // The one edge on `/votes/[id]` that names the sitting — until this
    // branch, it was a plain span. `periodLink` scopes the URL to the
    // ballot's own period so a WP19 vote's sitting link goes to WP19's
    // sitting page.
    expect(voteDetail).toMatch(
      /periodLink\(\s*`\/sittings\/\$\{sheet\.wahlperiode\}\/\$\{sheet\.sitzungnr\}`/,
    )
    expect(voteDetail).toMatch(/t\("votes\.sitting"/)
  })
})
