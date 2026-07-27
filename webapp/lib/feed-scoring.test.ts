import { describe, expect, test } from "bun:test"
import { type GroupableEvent, groupFeedEvents } from "./feed-grouping"
import { type ScorableEvent, scoreEvent, scoreGroup, sortableScore } from "./feed-scoring"
import { DEFAULT_WEIGHTS } from "./scoring"

/**
 * Tests for the feed's per-event score contribution.
 *
 * Two groups of these carry the weight, and neither is the arithmetic.
 *
 * The first is the **cross-module equivalence** the whole derivation rests on:
 * the pipeline writes `aktivitaetsart` into a feed event's `title`, and
 * `bucketFor` — written against `aktivitaetsart` — is applied to that title
 * here. Nothing in either file references the other, so a pipeline change that
 * put a friendlier label in `title` would leave this module silently bucketing
 * prose into `other` and every Anfrage in the feed would stop showing a score.
 * The typecheck cannot see it; only a test pinning real `aktivitaetsart` values
 * can.
 *
 * The second is the **refusals**. Votes, speeches and committee work carry no
 * per-record score for structural reasons lib/scoring.ts sets out, and the
 * failure mode of getting these wrong is the bad one: a plausible number
 * attached to a record that does not support it. `0` is a measurement and these
 * are not zero, so the assertions below are that they are `unscorable` — not
 * that they are small.
 */

function event(overrides: Partial<ScorableEvent> = {}): ScorableEvent {
  return {
    eventType: "question",
    // The pipeline writes the raw `aktivitaetsart` here — see the module header.
    title: "Kleine Anfrage",
    ...overrides,
  }
}

describe("scoreEvent — the kinds that score per record", () => {
  test("a question scores its component's weight, once", () => {
    // One record, so the count is 1 and the contribution is the bare weight.
    expect(scoreEvent(event())).toEqual({
      kind: "scored",
      component: "questions",
      points: DEFAULT_WEIGHTS.questions,
    })
  })

  test("motions and bills score their own components", () => {
    expect(scoreEvent(event({ eventType: "motion", title: "Antrag" }))).toEqual({
      kind: "scored",
      component: "motions",
      points: DEFAULT_WEIGHTS.motions,
    })
    expect(scoreEvent(event({ eventType: "bill", title: "Gesetzentwurf" }))).toEqual({
      kind: "scored",
      component: "billSponsorships",
      points: DEFAULT_WEIGHTS.billSponsorships,
    })
  })

  test("custom weights reach the contribution", () => {
    // A signed-in reader re-weights their own view; a feed still scoring at the
    // defaults would disagree with every other figure on the page.
    const score = scoreEvent(event(), { ...DEFAULT_WEIGHTS, questions: 99 })
    expect(score).toEqual({ kind: "scored", component: "questions", points: 99 })
  })

  test("a weight of zero scores zero rather than becoming unscorable", () => {
    // Deliberately weighted out is a measurement — the reader set it to zero —
    // and is not the same claim as "cannot be apportioned".
    expect(scoreEvent(event(), { ...DEFAULT_WEIGHTS, questions: 0 })).toEqual({
      kind: "scored",
      component: "questions",
      points: 0,
    })
  })
})

describe("scoreEvent — what must never carry a number", () => {
  test("a vote is a rate, not a per-ballot count", () => {
    // `voteParticipation` is a 0…1 rate scaled by 100. The same ballot is worth
    // 100/40 in a busy month and 100/3 in a quiet one, so no number belongs to
    // the single event.
    expect(scoreEvent(event({ eventType: "vote", title: "Abstimmung" }))).toEqual({
      kind: "unscorable",
      reason: "rate",
    })
  })

  test("a speech is weighted per word, and the count is not on the event", () => {
    // The feed event's description is German prose — "812 Wörter in 3
    // Redebeiträgen" — so parsing a number back out would make the score depend
    // on a sentence's wording.
    expect(scoreEvent(event({ eventType: "speech", title: "90. Sitzung" }))).toEqual({
      kind: "unscorable",
      reason: "perWord",
    })
  })

  test("committee work is a standing count with no dated records", () => {
    expect(scoreEvent(event({ eventType: "committee", title: "Ausschuss" }))).toEqual({
      kind: "unscorable",
      reason: "standing",
    })
  })

  test("a speech never scores, whatever its title looks like", () => {
    // The guard is on the event *type*, not the title. A speech event whose
    // title happens to contain "Rede" must not fall through to the title-based
    // path and pick up the per-word weight as if it were a per-record one.
    for (const title of ["Rede", "Rede (zu Protokoll gegeben)", "Zwischenfrage"]) {
      expect(scoreEvent(event({ eventType: "speech", title })), title).toEqual({
        kind: "unscorable",
        reason: "perWord",
      })
    }
  })
})

describe("scoreEvent — the catch-all, bucketed by its title", () => {
  /**
   * The equivalence this module depends on, pinned against the `aktivitaetsart`
   * values §3.5 documents.
   *
   * `event_type_for` in the pipeline routes recognised kinds to a typed event,
   * so these arrive as `activity` only when its patterns miss — but `bucketFor`
   * still has to agree about what they are, because that is the function the
   * real score uses. If these two ever disagree, the feed reports a different
   * contribution than the score it claims to explain.
   */
  test("recognised activity kinds bucket exactly as the scorer buckets them", () => {
    for (const [title, component] of [
      ["Kleine Anfrage", "questions"],
      ["Große Anfrage", "questions"],
      ["Antrag", "motions"],
      ["Entschließungsantrag", "motions"],
      ["Gesetzentwurf", "billSponsorships"],
      ["Bericht", "reports"],
    ] as const) {
      expect(scoreEvent(event({ eventType: "activity", title })), title).toEqual({
        kind: "scored",
        component,
        points: DEFAULT_WEIGHTS[component],
      })
    }
  })

  test("a spoken intervention buckets with speeches and so carries no per-record score", () => {
    // `bucketFor` sends `Zwischenfrage` to `speeches` — checked before `anfrage`,
    // which it contains as a substring. Reaching this module as an untyped
    // `activity`, it must still refuse a number: the speech weight is per word.
    for (const title of ["Zwischenfrage", "Kurzintervention"]) {
      expect(scoreEvent(event({ eventType: "activity", title })), title).toEqual({
        kind: "unscorable",
        reason: "perWord",
      })
    }
  })

  test("an unrecognised kind is surfaced, not scored as zero", () => {
    // §3.5: `aktivitaetsart` is an open string with no published value list, so
    // this is reachable rather than theoretical. A kind nobody has weighted yet
    // is an unanswered question; rendering it as 0,0 would present it as a
    // measurement. convex/activities.ts counts these for the same reason.
    expect(scoreEvent(event({ eventType: "activity", title: "Etwas ganz Neues" }))).toEqual({
      kind: "unscorable",
      reason: "unrecognised",
    })
  })

  test("bucketing is case-folded, as the scorer's is", () => {
    expect(scoreEvent(event({ eventType: "activity", title: "KLEINE ANFRAGE" }))).toEqual({
      kind: "scored",
      component: "questions",
      points: DEFAULT_WEIGHTS.questions,
    })
  })
})

describe("scoreGroup", () => {
  test("a joint act's total is one member's contribution times the count", () => {
    // The worked example from the task: forty signatories of a Kleine Anfrage,
    // at the default question weight of 3.
    const score = scoreGroup({ eventType: "question", title: "Kleine Anfrage", count: 40 })
    expect(score.total).toBe(120)
    expect(score.count).toBe(40)
    expect(score.per).toEqual({ kind: "scored", component: "questions", points: 3 })
  })

  test("a lone event is a group of one and totals its own contribution", () => {
    expect(scoreGroup({ eventType: "motion", title: "Antrag", count: 1 }).total).toBe(
      DEFAULT_WEIGHTS.motions,
    )
  })

  test("an unscorable row has no total, rather than a total of zero", () => {
    // A ballot signed by nobody and a ballot whose score is a rate are different
    // facts. "0,0 Punkte" on the second states the first.
    const score = scoreGroup({ eventType: "vote", title: "Abstimmung", count: 1 })
    expect(score.total).toBeNull()
    expect(score.per).toEqual({ kind: "unscorable", reason: "rate" })
  })

  test("floating-point drift is rounded away", () => {
    // A weight of 0.1 over three members is 0.30000000000000004 unrounded, which
    // disagrees with the "3 × 0,1" printed beside it.
    const score = scoreGroup(
      { eventType: "question", title: "Kleine Anfrage", count: 3 },
      {
        ...DEFAULT_WEIGHTS,
        questions: 0.1,
      },
    )
    expect(score.total).toBe(0.3)
  })

  test("a zero count totals zero", () => {
    // Not reachable through `groupFeedEvents` — a group is built from at least
    // one event — but the arithmetic should not produce a NaN if it ever is.
    expect(scoreGroup({ eventType: "question", title: "Kleine Anfrage", count: 0 }).total).toBe(0)
  })
})

describe("the invariant scoreGroup depends on", () => {
  /**
   * That every member of a real group scores identically.
   *
   * `scoreGroup` multiplies rather than sums, which is only correct because
   * `groupKey` contains both fields `scoreEvent` reads (`eventType` and
   * `title`). Nothing in either module states that dependency in code, so this
   * runs the *real* grouper and checks it holds — a grouping key that dropped
   * `title` would make the multiplication silently report a wrong total, and
   * this is what would catch it.
   */
  test("every actor in a real group scores the same as the group's own fields", () => {
    const base = {
      eventType: "question" as const,
      date: "2026-07-14",
      title: "Kleine Anfrage",
      description: "Stand der Digitalisierung",
      referenceType: "dipAktivitaet",
      fraktion: "SPD",
      photoUrl: null,
    }
    const events: GroupableEvent[] = [
      { ...base, id: "e1", mpInternalId: "bt-1", referenceId: "akt-1", name: "A" },
      { ...base, id: "e2", mpInternalId: "bt-2", referenceId: "akt-2", name: "B" },
      // A different document, so a second group — the case that would hide a
      // key change if only one group existed.
      { ...base, id: "e3", mpInternalId: "bt-3", referenceId: "akt-3", name: "C", title: "Antrag" },
    ]

    const groups = groupFeedEvents(events)
    expect(groups).toHaveLength(2)

    for (const group of groups) {
      const groupScore = scoreEvent(group)
      for (const actor of group.actors) {
        // Re-score from the originating event rather than from the group, so
        // this compares two independently derived answers.
        const source = events.find((e) => e.mpInternalId === actor.mpInternalId)
        expect(source, actor.mpInternalId).toBeDefined()
        if (source) expect(scoreEvent(source), actor.mpInternalId).toEqual(groupScore)
      }
    }
  })
})

describe("sortableScore", () => {
  test("an unscorable row sorts as zero", () => {
    // Sorting needs a total order and "cannot be apportioned" has to land
    // somewhere. Display must branch on `total === null` instead.
    expect(
      sortableScore({ per: { kind: "unscorable", reason: "rate" }, total: null, count: 1 }),
    ).toBe(0)
  })

  test("a scored row sorts on its total", () => {
    expect(
      sortableScore({
        per: { kind: "scored", component: "questions", points: 3 },
        total: 120,
        count: 40,
      }),
    ).toBe(120)
  })
})
