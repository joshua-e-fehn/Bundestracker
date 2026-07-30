import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The §31 disclosure's wiring, asserted against the source.
 *
 * ## Why these are text assertions
 *
 * `bun test` has no DOM, no React renderer and no Convex client, so there is
 * nothing here in which to click a button and watch a subscription open. Same
 * reasoning as components/follow-button.test.ts and components/sidebar-account.test.ts.
 * The browser check is the real verification; these buy the cheap half — the
 * specific wrong versions of this component are caught in CI rather than by a
 * reader discovering their reads are running when the disclosure is closed.
 *
 * Each test below names a version that would look correct and be wrong.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url).pathname, "utf8")

/** Comments stripped: every property below is *discussed* in the prose of the
 * file it guards, so a search over the raw text would pass on the explanation
 * alone. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const disclosure = stripComments(read("./vote-explanations-disclosure.tsx"))
const voteDetail = stripComments(read("./vote-detail.tsx"))

describe("the disclosure never fetches while collapsed", () => {
  test("useQuery is skipped when the panel is closed", () => {
    // The failure this pins is a subscription opening on every ballot in the
    // period as soon as the page renders — the exact bug motion-sponsors
    // and its `"skip"` sentinel exist to avoid. Convex reads the string as a
    // sentinel; any other truthy expression fetches.
    expect(disclosure).toMatch(/open\s*&&\s*dipVorgangId\s*!==\s*null\s*\?\s*\{[^}]+\}\s*:\s*"skip"/)
  })

  test("the query goes through getExplanationsByMotion, not an eager list read", () => {
    // A component that read `getVoteSheetsPage` for its own copy of the ballot
    // list would defeat the point of the coverage query passed down from the
    // caller. The one honest read for a per-ballot disclosure is the one
    // convex/voteExplanations.ts exposes.
    expect(disclosure).toMatch(/api\.voteExplanations\.getExplanationsByMotion/)
  })
})

describe("the three empty states are three different sentences", () => {
  test("unlinked, none filed, and not-backfilled each have their own key", () => {
    // A shared key would fold two claims into one, which is exactly the
    // failure convex/voteExplanations.ts's coverage query exists to prevent —
    // an unbackfilled period is not a Vorgang with no declaration.
    expect(disclosure).toMatch(/t\("voteExplanations\.unlinked"\)/)
    expect(disclosure).toMatch(/t\("voteExplanations\.emptyNoneFiled"\)/)
    expect(disclosure).toMatch(/t\("voteExplanations\.emptyPeriodNotBackfilled"\)/)
  })

  test("coverage decides between the last two arms — read from the prop, not fetched here", () => {
    // The coverage query is called *once at the caller's level* and threaded
    // in as `hasAnyForPeriod`. A per-row `useQuery(api.voteExplanations.getExplanationCoverage, …)`
    // inside this file would multiply into as many reads as there are
    // ballots on the page. Grep for the coverage query name being absent from
    // this file; the caller has it.
    expect(disclosure).not.toMatch(/api\.voteExplanations\.getExplanationCoverage/)
    expect(voteDetail).toMatch(/api\.voteExplanations\.getExplanationCoverage/)
  })
})

describe("no branch generates or paraphrases a reason", () => {
  test("neither summary, paraphrase, nor rationale is composed from the data", () => {
    // The whole feature turns on this. `voteExplanationInput` has no field
    // that could hold prose (convex/voteExplanations.test.ts asserts that
    // schema-side), and this component must not synthesise one either. The
    // only rendered strings from a row are its published fields — name,
    // fraktion, date, protocol number, source link — passed through, not
    // rewritten. A file that named any of these forbidden columns would be
    // reading from a schema field the schema promised not to have.
    for (const forbidden of [
      "row.reason",
      "row.summary",
      "row.explanation",
      "row.rationale",
      "row.text",
      "row.body",
    ]) {
      expect(disclosure).not.toContain(forbidden)
    }
  })

  test("the source link points to the protocol, not to generated content", () => {
    // The caveat repeats it and the link honours it: the words live in the
    // PDF. `sourceUrl` is the only route to them.
    expect(disclosure).toMatch(/href=\{row\.sourceUrl\}/)
    expect(disclosure).toMatch(/t\("voteExplanations\.caveat"\)/)
  })
})

describe("accessibility contract", () => {
  test("the toggle carries aria-expanded and aria-controls", () => {
    // The pair components/activity-feed-item.tsx names as load-bearing:
    // `aria-expanded` without `aria-controls` leaves a screen reader hearing
    // "expanded" with no way to know what.
    expect(disclosure).toMatch(/aria-expanded=\{open\}/)
    expect(disclosure).toMatch(/aria-controls=\{panelId\}/)
  })

  test("the panel id is derived from the ballot's Convex id so multi-row pages cannot collide", () => {
    // Keyed on the ballot's own Convex id, not the Vorgang id. The Vorgang
    // is nullable, and a fallback sentinel (`unlinked`) would collide across
    // every unlinked ballot on a page that ever renders more than one
    // disclosure. Same class of defect this test would have caught on
    // committee-referrals-disclosure — it did not, once, and the /motions
    // list had three `id="committee-referrals-unlinked"` copies until the
    // key was moved to the row's stable Convex id.
    expect(disclosure).toMatch(/panelId\s*=\s*`vote-explanations-\$\{ballotId\}`/)
  })

  test("the panel is always mounted so aria-controls always resolves", () => {
    // A conditionally-mounted panel gives `aria-controls` an id that
    // resolves to nothing while collapsed, which reads worse to a screen
    // reader than no association at all. `hidden` while closed removes it
    // from layout while keeping the id.
    expect(disclosure).toMatch(/id=\{panelId\}\s+hidden=\{!open\}/)
  })
})

describe("the section variant lives on the detail page", () => {
  test("vote-detail.tsx renders it as a section, closed by default", () => {
    // The section form is exactly what the detail page needs — a labelled
    // region beside the breakdown and records sections. The row form would
    // put it beside the outcome badge, which is wrong for a page whose
    // subject *is* the ballot.
    expect(voteDetail).toMatch(/VoteExplanationsDisclosure/)
    expect(voteDetail).toMatch(/variant="section"/)
  })

  test("the detail page threads the ballot's Wahlperiode and id through", () => {
    // `sheet.wahlperiode` rather than a `?wp=` from the URL — the ballot's
    // own period, so a WP19 ballot opened by a reader on the current period
    // still asks the right coverage query. `sheet.id` rather than the
    // Vorgang id — see the panel-id test above for the collision that key
    // choice prevents. `PeriodProvider` uses the same field for the same
    // reason at line 132 of vote-detail.tsx.
    expect(voteDetail).toMatch(/wahlperiode=\{sheet\.wahlperiode\}/)
    expect(voteDetail).toMatch(/dipVorgangId=\{sheet\.dipVorgangId\}/)
    expect(voteDetail).toMatch(/ballotId=\{sheet\.id\}/)
  })
})
