import { describe, expect, test } from "bun:test"
import { dictionaries, LOCALES } from "./i18n"
import {
  ballotKey,
  isOwnResourceVote,
  OWN_RESOURCE_TOPIC_KEYS,
  OWN_RESOURCE_TOPICS,
  OWN_RESOURCE_VOTES,
  OWN_RESOURCE_VOTES_AS_OF,
  ownResourcePeriods,
  ownResourceVote,
} from "./own-resources-votes"

/**
 * The curated list is the one thing on this site that is not derived from a
 * query, so it is the one thing no ingest can correct.
 *
 * A duplicated entry renders the same ballot twice and looks like two votes on
 * the same subject. A rationale key with a typo renders as a raw
 * `{votes.ownResources.…}` on a page whose whole claim is that it explains its
 * own selection. A stale review date is invisible by construction. None of
 * these throws, and none of them looks like a defect on screen — which is
 * exactly the class of bug this file exists to catch.
 *
 * What is deliberately *not* asserted here: that a ballot exists in the corpus.
 * That is a property of the deployment rather than of this module, and
 * `getVoteSheetsByKey` already omits what it cannot find. Asserting it would
 * make a local test depend on a live database.
 */

describe("OWN_RESOURCE_VOTES", () => {
  test("names each ballot at most once", () => {
    // Two entries with the same natural key would render the same division
    // twice — which on a page about self-interest reads as two separate votes
    // on the chamber's own money.
    const keys = OWN_RESOURCE_VOTES.map(ballotKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("every entry carries a topic from the declared vocabulary", () => {
    for (const entry of OWN_RESOURCE_VOTES) {
      expect(OWN_RESOURCE_TOPICS).toContain(entry.topic)
    }
  })

  test("every rationale key resolves in both languages", () => {
    // The failure this prevents is specific: an unresolved key renders as the
    // key itself, so a page whose entire premise is that it explains its own
    // selection would print `votes.ownResources.rationale.…` where the reason
    // should be. `t()` falls back to German, so English is the side that fails
    // quietly — hence both locales, not just the default.
    for (const entry of OWN_RESOURCE_VOTES) {
      for (const locale of LOCALES) {
        const value = dictionaries[locale][entry.rationaleKey]
        expect(value).toBeString()
        expect(value.trim()).not.toBe("")
      }
    }
  })

  test("every topic label resolves in both languages", () => {
    for (const topic of OWN_RESOURCE_TOPICS) {
      for (const locale of LOCALES) {
        const value = dictionaries[locale][OWN_RESOURCE_TOPIC_KEYS[topic]]
        expect(value).toBeString()
        expect(value.trim()).not.toBe("")
      }
    }
  })

  test("gives each ballot its own rationale", () => {
    // A shared sentence across entries would be a topic label repeated, and the
    // grounds are the part a reader is meant to be able to disagree with
    // specifically. See the module header.
    const rationales = OWN_RESOURCE_VOTES.map((entry) => entry.rationaleKey)
    expect(new Set(rationales).size).toBe(rationales.length)
  })

  test("carries only whole, positive natural keys", () => {
    // `(wahlperiode, sitzungnr, abstimmnr)` indexes an integer triple (§4.1). A
    // float or a zero would match nothing and the ballot would silently vanish
    // from the collection rather than error.
    for (const entry of OWN_RESOURCE_VOTES) {
      for (const part of [entry.wahlperiode, entry.sitzungnr, entry.abstimmnr]) {
        expect(Number.isInteger(part)).toBe(true)
        expect(part).toBeGreaterThan(0)
      }
    }
  })

  test("names no ballot the seeder invented", () => {
    // Regression, 2026-07-29. Entry #1 was `(21, 91, 2)` "Antrag zur Reform des
    // Wahlrechts" — a ballot `scripts/seed-local.ts` fabricated, which reached
    // production when that script was once run against it and survived the
    // cleanup because convex/purgeSeed.ts then deleted the seeder's records by
    // walking its mandates and left `voteSheets` alone. The curated entry passed
    // every check in this file and rendered a tally of 6/3/1 that no MP cast, as
    // the first card on a page about self-interest.
    //
    // The purge covers the sheets now (`isSyntheticVoteSheet`), so that corpus
    // can no longer hold this row — but this assertion is not about the corpus.
    // It holds the curation rule directly, which is what has to survive a
    // deployment that gets seeded again.
    //
    // The two seeded keys are `(21, 90, 1)` and `(21, 91, 2)`
    // (`sitzungnr: 90 + index`). The first has since been overwritten in place
    // by the real ballot the pipeline loaded for that key, so it is excluded by
    // name rather than by rule — which is the point of asserting the pair
    // rather than the survivor: this file cannot see the corpus, so the only
    // thing it can hold is "do not curate a key a seeder ever wrote".
    const seeded = [
      { wahlperiode: 21, sitzungnr: 90, abstimmnr: 1 },
      { wahlperiode: 21, sitzungnr: 91, abstimmnr: 2 },
    ]
    for (const key of seeded) {
      expect(
        ownResourceVote(key),
        `${key.wahlperiode}/${key.sitzungnr}/${key.abstimmnr}`,
      ).toBeNull()
    }
  })

  test("stays within the query's read budget", () => {
    // `getVoteSheetsByKey` throws above MAX_BALLOT_KEYS rather than truncating,
    // so an over-long list takes the page down instead of shortening it. That
    // is the right behaviour there and this is where it gets caught first.
    expect(OWN_RESOURCE_VOTES.length).toBeLessThanOrEqual(60)
  })

  test("records a review date in YYYY-MM form", () => {
    // Printed on the page, so a reader can tell a list that is behind from a
    // list that is wrong. Zero-padded because an unpadded month sorts above
    // every real date in its year — the trap lib/taxonomy.ts documents for
    // `previousMonth`.
    expect(OWN_RESOURCE_VOTES_AS_OF).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
  })
})

describe("ownResourceVote", () => {
  test("finds an entry by its natural key", () => {
    const first = OWN_RESOURCE_VOTES[0]
    expect(
      ownResourceVote({
        wahlperiode: first.wahlperiode,
        sitzungnr: first.sitzungnr,
        abstimmnr: first.abstimmnr,
      }),
    ).toEqual(first)
  })

  test("does not match across the parts of the key", () => {
    // The natural key is a triple and every part means something different. A
    // lookup that matched on the sitting alone would attach one ballot's
    // rationale to a different division held the same day — and sitting 90 of
    // WP21 held eight of them.
    const first = OWN_RESOURCE_VOTES[0]
    expect(
      ownResourceVote({
        wahlperiode: first.wahlperiode,
        sitzungnr: first.sitzungnr,
        abstimmnr: first.abstimmnr + 1,
      }),
    ).toBeNull()
  })

  test("returns null for a ballot outside the collection", () => {
    expect(ownResourceVote({ wahlperiode: 21, sitzungnr: 1, abstimmnr: 1 })).toBeNull()
    expect(isOwnResourceVote({ wahlperiode: 21, sitzungnr: 1, abstimmnr: 1 })).toBe(false)
  })

  test("does not confuse the same sitting number across periods", () => {
    // Sitting numbers restart each Wahlperiode, so `(sitzungnr, abstimmnr)`
    // alone is not unique across the corpus — WP20's sitting 92 and a future
    // WP21 sitting 92 are different divisions entirely.
    const wp20 = OWN_RESOURCE_VOTES.find((entry) => entry.wahlperiode === 20)
    if (!wp20) throw new Error("fixture expects at least one WP20 entry")
    expect(
      ownResourceVote({
        wahlperiode: 21,
        sitzungnr: wp20.sitzungnr,
        abstimmnr: wp20.abstimmnr,
      }),
    ).toBeNull()
  })
})

describe("ownResourcePeriods", () => {
  test("lists each period once, newest first", () => {
    const periods = ownResourcePeriods()
    expect(new Set(periods).size).toBe(periods.length)
    expect(periods).toEqual([...periods].sort((a, b) => b - a))
  })

  test("covers every period the list draws on", () => {
    // Derived rather than restated precisely so an entry from a new period
    // cannot leave a caller fetching the wrong ones.
    for (const entry of OWN_RESOURCE_VOTES) {
      expect(ownResourcePeriods()).toContain(entry.wahlperiode)
    }
  })

  test("spans more than the current period", () => {
    // Not a stylistic assertion. The clearest entries — the Parteiengesetz
    // amendment and the Stiftungsfinanzierungsgesetz — are WP20's, and a
    // collection accidentally scoped to WP21 would render nearly empty. An
    // empty page about the Bundestag's own resources is exactly what a reader
    // would misread as a finding, so the cross-period span is load-bearing.
    expect(ownResourcePeriods().length).toBeGreaterThan(1)
  })
})
