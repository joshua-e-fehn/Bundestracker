import { bucketFor, DEFAULT_WEIGHTS, type ScoreComponent, type ScoreWeights } from "./scoring"
import type { EventType } from "./taxonomy"

/**
 * What one feed entry contributed to its member's activity score.
 *
 * ## There is no stored per-event score, and that is not an oversight
 *
 * `activityEvents` carries eight fields (convex/schema.ts) and none of them is a
 * score. The scores live in `activityScores`, one row per (MP, Wahlperiode,
 * month), and `convex/activityScores.ts` computes them from the **source**
 * tables rather than from the feed — deliberately, and it says why: "the feed is
 * derived and may lag, and a score built on derived data would compound any gap
 * in it."
 *
 * So this module does not read a score. It re-derives the *one term* an event
 * contributes, from the same inputs the real computation uses, and refuses to
 * produce a number where that term does not exist. The alternative — showing a
 * plausible figure for every row — would be a claim about parliamentary work
 * that the sources do not make, which is the one thing this project's premise
 * rules out (AGENTS.md).
 *
 * ## Why an activity's contribution is recoverable at all
 *
 * `activityTallies` in convex/activities.ts buckets an MP's activities with
 * `bucketFor(row.aktivitaetsart)`, and the score is that tally times the
 * bucket's weight. The feed does not store `aktivitaetsart` — but the pipeline
 * sets a DIP activity event's **`title` to exactly that string**:
 *
 *     "title": clean_text(aktivitaet.aktivitaetsart) or aktivitaet.aktivitaetsart
 *     — `activity_event_payloads`, pipeline/src/bundestrack/pipeline/transform.py
 *
 * `clean_text` only collapses whitespace, so the value that reaches `title` is
 * the value `bucketFor` was written to match. Bucketing the title is therefore
 * reading the same field the scorer reads, not guessing from a label.
 *
 * That equivalence is load-bearing and invisible from either file alone, so
 * lib/feed-scoring.test.ts pins it with the kinds §3.5 actually documents.
 *
 * ## The three kinds that carry no per-record score, and why
 *
 * Each is a *structural* limit of the scoring model — lib/scoring.ts names all
 * three — rather than a field nobody has populated yet:
 *
 *  - **Votes.** `voteParticipation` is a 0…1 *rate* scaled by 100, not a count.
 *    One ballot's contribution depends on how many ballots were held in the
 *    window: the same vote is worth 100/40 in a busy month and 100/3 in a quiet
 *    one. There is no number that belongs to the single event.
 *  - **Speeches.** Weighted per *word* (0.01 each), and the word count lives in
 *    the `speeches` table. The feed event's `description` is German prose —
 *    `"812 Wörter in 3 Redebeiträgen"` — assembled by `speech_event_payloads`.
 *    Parsing an integer back out of a display string would make the score depend
 *    on a sentence's wording, and it would silently yield nothing the day that
 *    sentence is translated.
 *  - **Committee work.** `committeeCount` is a standing count of seats held, not
 *    a record of events, and the pipeline emits no committee feed payloads at
 *    all. Nothing dated contributes it.
 *
 * `null` rather than `0` for all three. Zero is a *measurement* — "this
 * contributed nothing" — and every one of these contributed something the feed
 * cannot apportion. The UI must render the difference, which is why this is a
 * union rather than a number with a sentinel.
 */

/**
 * An event's contribution, or the reason it has none.
 *
 * `component` travels with `points` so a caller can name what was counted
 * ("Anfrage × 3,0") instead of showing a bare figure, and so the weight a
 * re-weighting reader moved is traceable to the row it changed.
 */
export type EventScore =
  | { kind: "scored"; component: ScoreComponent; points: number }
  | { kind: "unscorable"; reason: UnscorableReason }

/**
 * Why a kind carries no per-record contribution. Each maps to a caveat string,
 * so the row says which limit applies rather than a generic dash — the same
 * rule components/caveat-note.tsx follows for the figures these limits qualify.
 */
export type UnscorableReason =
  /** A rate over ballots, not a per-ballot count. */
  | "rate"
  /** Weighted per word; the count is not on the event. */
  | "perWord"
  /** A standing count with no dated records. */
  | "standing"
  /** An activity kind `bucketFor` does not recognise — `other`. Counted and
   * surfaced rather than dropped, exactly as convex/activities.ts does. */
  | "unrecognised"

/** The minimum an event needs to be scored. Structural rather than importing a
 * component's type, so this module stays free of React and testable on its own —
 * the split lib/feed-grouping.ts and lib/scoring.ts already use. */
export type ScorableEvent = {
  eventType: EventType
  title: string
}

/**
 * Which score component an event type contributes to, before its title is read.
 *
 * `Record<EventType, …>` so an event type added to lib/taxonomy.ts is a compile
 * error here until someone decides what it scores — the same guard
 * `SCORE_COMPONENT_LABELS` uses in components/score-breakdown.tsx. A new kind
 * silently scoring nothing is precisely the failure `bucketFor`'s `other` exists
 * to prevent.
 *
 * `activity` maps to null because it is the pipeline's catch-all: `event_type_for`
 * returns it for any `aktivitaetsart` its patterns miss, so the *title* is the
 * only thing that can classify it, and `bucketFor` is what does that below.
 */
const COMPONENT_BY_EVENT_TYPE: Record<EventType, ScoreComponent | UnscorableReason | null> = {
  motion: "motions",
  question: "questions",
  bill: "billSponsorships",
  speech: "perWord",
  vote: "rate",
  committee: "standing",
  activity: null,
}

/** The reasons, as a set, so the union above stays the single declaration of
 * them. A reason added there without being listed here would make `scoreEvent`
 * treat it as a score component and index `weights` with it — so the `satisfies`
 * makes that a compile error rather than an `undefined` reaching the page. */
const UNSCORABLE_REASONS = new Set([
  "rate",
  "perWord",
  "standing",
  "unrecognised",
] satisfies UnscorableReason[])

function isReason(value: ScoreComponent | UnscorableReason): value is UnscorableReason {
  return (UNSCORABLE_REASONS as ReadonlySet<string>).has(value)
}

/**
 * What one event contributed, under `weights`.
 *
 * Pure, and weight-taking rather than weight-assuming: a signed-in reader
 * re-weights their own view from `userPreferences.customWeights`, and a feed
 * that kept scoring at the defaults while the sliders moved would disagree with
 * every other figure on the site. Same reason `rescore` exists in lib/scoring.ts.
 *
 * The per-record count is always 1 — this is one record. What varies is the
 * weight, which is the whole of what the score does with a count of one.
 */
export function scoreEvent(
  event: ScorableEvent,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): EventScore {
  // A typed event kind scores as its kind. The title is only consulted for the
  // `activity` catch-all, where it is the sole classifier — reading it for a
  // kind the pipeline already routed would let a title override a decision
  // `event_type_for` made from the same string.
  const mapped = COMPONENT_BY_EVENT_TYPE[event.eventType] ?? componentFromTitle(event.title)

  return isReason(mapped)
    ? { kind: "unscorable", reason: mapped }
    : { kind: "scored", component: mapped, points: weights[mapped] }
}

/**
 * The score bucket for a catch-all activity, from the `aktivitaetsart` its title
 * holds — or the reason that bucket carries no per-record contribution.
 *
 * ⚠ The `speeches` arm is the subtle one, and it is why this returns a union
 * rather than a bare component. `bucketFor` sends `Zwischenfrage` and
 * `Kurzintervention` to `speeches` — a spoken intervention is speech, and §5.2
 * counts the intervener's own words. But the `speeches` weight is **per word**
 * (0.01), so treating one of these as a record and multiplying by it would score
 * a whole intervention as if it were a single spoken word. The event-type guard
 * above never sees these: the pipeline's `event_type_for` has its own
 * `zwischenfrage` pattern, but a kind its patterns miss arrives here as
 * `activity` and reaches this function instead.
 *
 * `other` returns `unrecognised` for the same family of reasons: an activity
 * kind scoring nothing is information ("a kind nobody has weighted yet"), and
 * rendering it as 0,0 would present an unanswered question as a measurement.
 * §3.5 makes it reachable — `aktivitaetsart` is an open string with no published
 * value list.
 */
function componentFromTitle(title: string): ScoreComponent | UnscorableReason {
  const bucket = bucketFor(title)
  switch (bucket) {
    case "other":
      return "unrecognised"
    // Per word, not per record — see the warning above.
    case "speeches":
      return "perWord"
    // A rate and a standing count. Unreachable from a `bucketFor` on a real
    // `aktivitaetsart` (it buckets neither), but listed rather than defaulted so
    // that the four per-record components below are named exhaustively and a
    // component added to lib/scoring.ts fails the typecheck here.
    case "voteParticipation":
      return "rate"
    case "committees":
      return "standing"
    case "motions":
    case "questions":
    case "reports":
    case "billSponsorships":
      return bucket
  }
}

/**
 * A grouped row's contribution: one member's, and the group's.
 *
 * ## Every member of a group scores the same, by construction
 *
 * This is what keeps the type this simple, and it is not a coincidence worth
 * relying on silently. `groupKey` in lib/feed-grouping.ts is
 * `[eventType, date, title, description]`, and `scoreEvent` reads
 * `eventType` and `title` — **both of them inside that key**. Two events cannot
 * be in one group and score differently; if they scored differently they would
 * have different keys and be different rows.
 *
 * So there is no partial coverage to report and no sum to take: a group either
 * scores, in which case all N members contribute `per` each, or it does not, in
 * which case none of them do. That is why `total` is a multiplication rather
 * than a fold, and why the UI can honestly print "40 × 3,0" as the arithmetic
 * behind its figure.
 *
 * If the grouping key ever stops containing `title` or `eventType`, this stops
 * being true and the sum has to come back. lib/feed-scoring.test.ts pins the
 * invariant against the real `groupFeedEvents` so that change fails a test
 * rather than quietly reporting a wrong total.
 */
export type GroupScore = {
  /** What one member contributed — the same for every member. */
  per: EventScore
  /**
   * The group's contribution: `per × count`, or null where a member's own
   * contribution is not apportionable.
   *
   * Null rather than 0 for the same reason `EventScore` is a union: a ballot
   * signed by nobody and a ballot whose score is a rate are different facts, and
   * a row showing "0,0 Punkte" for the second one states the first.
   */
  total: number | null
  /** How many members the row names. */
  count: number
}

/**
 * A grouped row's score, from the fields its members share.
 *
 * Takes the shared fields rather than the group, so this stays independent of
 * `FeedGroup`'s shape and testable without building one — and so the caller
 * cannot pass a group whose actors disagree, which the header explains cannot
 * happen anyway.
 */
export function scoreGroup(
  row: ScorableEvent & { count: number },
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): GroupScore {
  const per = scoreEvent(row, weights)
  return {
    per,
    total:
      per.kind === "scored"
        ? // Rounded to two places like `computeScore` in lib/scoring.ts, and for
          // the same reason: 0.01 × 3 is 0.030000000000000002 in binary floating
          // point, and a total that disagrees with the arithmetic printed beside
          // it reads as a data error.
          Math.round(per.points * row.count * 100) / 100
        : null,
    count: row.count,
  }
}

/** The figure a row sorts and filters on. Zero for an unscorable row — sorting
 * needs a total order, and "cannot be apportioned" has to land somewhere. The
 * *display* must branch on `total === null` instead, so the two are not
 * conflated where a reader can see them. */
export function sortableScore(score: GroupScore): number {
  return score.total ?? 0
}
