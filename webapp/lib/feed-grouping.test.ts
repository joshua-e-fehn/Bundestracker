import { describe, expect, test } from "bun:test"
import { type GroupableEvent, groupFeedEvents } from "./feed-grouping"

/**
 * Tests for the feed's joint-act grouping.
 *
 * Two of these assertions are load-bearing in a way the others are not, and
 * they are the *negative* ones. Grouping too little shows a redundant row and a
 * reader shrugs; grouping too much destroys a per-member record that §4.4 says
 * is the only individual evidence that exists. So "a ballot never collapses"
 * and "a sitting never collapses" are the cases this file is really for — the
 * happy path is easy to get right and easy to see in a browser.
 */

let counter = 0

function event(overrides: Partial<GroupableEvent> = {}): GroupableEvent {
  counter += 1
  return {
    id: `e${counter}`,
    mpInternalId: `bt-${counter}`,
    eventType: "question",
    date: "2026-07-14",
    title: "Kleine Anfrage",
    description: "Stand der Digitalisierung der Bundesverwaltung",
    // The id space DIP mints per *person per document* — which is exactly why
    // it cannot be the grouping key. See the module header.
    referenceId: `akt-${counter}`,
    referenceType: "dipAktivitaet",
    name: `MP ${counter}`,
    fraktion: "SPD",
    photoUrl: null,
    ...overrides,
  }
}

describe("groupFeedEvents — joint acts", () => {
  test("signatories of one document collapse into one row", () => {
    const groups = groupFeedEvents([event(), event(), event()])
    expect(groups).toHaveLength(1)
    expect(groups[0].actors).toHaveLength(3)
  })

  test("distinct referenceIds do not prevent grouping", () => {
    // The whole reason the key is the document rather than `referenceId`: DIP
    // mints one Aktivität per person, so forty signatories are forty ids. A
    // key on `referenceId` would collapse nothing at all.
    const groups = groupFeedEvents([
      event({ referenceId: "akt-100" }),
      event({ referenceId: "akt-200" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].actors).toHaveLength(2)
  })

  test("a group keeps the position of its first member", () => {
    // The timeline stays the one the query returned rather than being reordered
    // by group size.
    const groups = groupFeedEvents([
      event({ description: "Erste Anfrage" }),
      event({ description: "Zweite Anfrage" }),
      event({ description: "Erste Anfrage" }),
    ])
    expect(groups.map((g) => g.description)).toEqual(["Erste Anfrage", "Zweite Anfrage"])
    expect(groups[0].actors).toHaveLength(2)
  })

  test("different documents stay separate", () => {
    for (const differing of [
      { description: "Ein anderes Thema" },
      { title: "Große Anfrage" },
      { date: "2026-07-15" },
      { eventType: "motion" as const },
    ]) {
      const groups = groupFeedEvents([event(), event(differing)])
      expect(groups, JSON.stringify(differing)).toHaveLength(2)
    }
  })

  test("the same MP twice in one group is counted once", () => {
    // Reachable rather than theoretical: a re-ingested Aktivität with a changed
    // id inserts a second row for the same signature, and a group listing
    // someone twice would make its own "40 Abgeordnete" wrong.
    const groups = groupFeedEvents([
      event({ mpInternalId: "bt-7", referenceId: "akt-1" }),
      event({ mpInternalId: "bt-7", referenceId: "akt-2" }),
      event({ mpInternalId: "bt-8", referenceId: "akt-3" }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].actors.map((a) => a.mpInternalId)).toEqual(["bt-7", "bt-8"])
  })
})

describe("groupFeedEvents — what must never collapse", () => {
  test("a ballot stays one row per member", () => {
    // 630 rows share a `voteSheetKey`, and each one's description is that
    // member's own position. Collapsing them would produce a single "630
    // members voted" entry and destroy the only per-member voting record that
    // exists (§4.4).
    const ballot = { referenceType: "voteSheetKey", referenceId: "21/90/2", eventType: "vote" }
    const groups = groupFeedEvents([
      event({ ...ballot, title: "Abstimmung", description: "yes" } as Partial<GroupableEvent>),
      event({ ...ballot, title: "Abstimmung", description: "no" } as Partial<GroupableEvent>),
      // Same position as the first, so nothing but the reference type keeps
      // these two apart — which is the case that would break if the guard were
      // removed.
      event({ ...ballot, title: "Abstimmung", description: "yes" } as Partial<GroupableEvent>),
    ])
    expect(groups).toHaveLength(3)
  })

  test("speeches in one sitting stay one row per member", () => {
    // Every MP who spoke that day shares the protocol id. They gave separate
    // speeches; they did not jointly give one.
    const sitting = { referenceType: "sitting", referenceId: "21/90", eventType: "speech" }
    const groups = groupFeedEvents([
      event({
        ...sitting,
        title: "90. Sitzung",
        description: "812 Wörter",
      } as Partial<GroupableEvent>),
      event({
        ...sitting,
        title: "90. Sitzung",
        description: "812 Wörter",
      } as Partial<GroupableEvent>),
    ])
    expect(groups).toHaveLength(2)
  })

  test("an unknown reference type is left alone", () => {
    // The default for a type nobody has considered against this question is to
    // not group: a redundant row is recoverable, a destroyed per-member record
    // is not.
    const groups = groupFeedEvents([
      event({ referenceType: "somethingNew", referenceId: "x" }),
      event({ referenceType: "somethingNew", referenceId: "x" }),
    ])
    expect(groups).toHaveLength(2)
  })

  test("an event with no reference type is left alone", () => {
    const groups = groupFeedEvents([
      event({ referenceType: null, referenceId: null }),
      event({ referenceType: null, referenceId: null }),
    ])
    expect(groups).toHaveLength(2)
  })

  test("a joint act with no subject line is left alone", () => {
    // "Kleine Anfrage, 2026-07-14" describes every Kleine Anfrage tabled that
    // day, so grouping on it would merge distinct documents into one row.
    for (const blank of [null, "", "   "]) {
      const groups = groupFeedEvents([event({ description: blank }), event({ description: blank })])
      expect(groups, JSON.stringify(blank)).toHaveLength(2)
    }
  })
})

describe("groupFeedEvents — shape", () => {
  test("an empty feed produces no groups", () => {
    expect(groupFeedEvents([])).toEqual([])
  })

  test("every event reaches exactly one group", () => {
    // The invariant that makes this safe to run over a paginated list: nothing
    // is dropped and nothing is duplicated, whatever the mix of types.
    const events = [
      event(),
      event(),
      event({ description: "Anderes" }),
      event({ referenceType: "voteSheetKey", eventType: "vote" }),
      event({ referenceType: null, referenceId: null }),
    ]
    const groups = groupFeedEvents(events)
    const actorCount = groups.reduce((sum, group) => sum + group.actors.length, 0)
    expect(actorCount).toBe(events.length)
  })

  test("a group's id is its first member's, so React keys stay stable", () => {
    // Stability matters across pages: a synthesised key would change as later
    // pages merge into an existing group and React would remount the row.
    const first = event({ id: "first" })
    const groups = groupFeedEvents([first, event()])
    expect(groups[0].id).toBe("first")
  })

  test("a lone event becomes a group of one", () => {
    // The common case pays nothing for the joint one — the component renders a
    // one-actor group exactly as it rendered a bare event.
    const groups = groupFeedEvents([event({ referenceType: "voteSheetKey" })])
    expect(groups).toHaveLength(1)
    expect(groups[0].actors).toHaveLength(1)
  })
})
