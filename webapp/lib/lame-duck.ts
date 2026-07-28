/**
 * The gap between an election and the new Bundestag's first sitting — and what
 * a vote taken inside it is.
 *
 * ## The constitutional fact
 *
 * Art. 39(1) GG: the Bundestag's term ends when the new one convenes, and the
 * new one must convene within thirty days of the election. So there is always a
 * window — up to a month — in which the *old* chamber still holds every power it
 * ever had while the electorate has already replaced it. It sits, it debates,
 * and it can pass laws, including constitutional amendments.
 *
 * A vote in that window is lawful and it is unrepresentative, and those two
 * facts are both worth stating. This module marks them; it does not judge them.
 * The 2025-03-18 Sondervermögen vote is the case that motivates it — the
 * outgoing WP20 Bundestag amending the Basic Law twenty-three days after an
 * election that had already changed the chamber's composition, criticised from
 * opposite ends of it.
 *
 * ## ⚠ Hand-maintained, like `GOVERNING_PARTIES`
 *
 * **Not derivable from any Bundestag dataset.** §9 of docs/api-research.md lists
 * what the sources carry, and neither an election date nor a constitutive sitting
 * date is among them: DIP has no `/wahlperiode` endpoint, the Stammdaten DTD
 * records mandate spans per member rather than the term's own bounds, and a
 * `voteSheets` row carries a date and a sitting number but nothing that says
 * which side of an election it fell on.
 *
 * So this is the same kind of table `GOVERNING_PARTIES` is (lib/seating.ts) and
 * it is kept the same way: a dated map, visibly flagged, keyed by Wahlperiode.
 * `LAME_DUCK_MAINTAINED_AS_OF` is exported so the UI can say when it was last
 * checked, following `inquiry.maintainedAsOf`.
 *
 * A period absent from the map is **not** flagged, rather than being guessed at
 * from a neighbouring period's dates. That is the safe direction: the flag is a
 * claim about a specific ballot, and a wrong one would label a perfectly ordinary
 * vote as taken by a repudiated parliament.
 */

/** The bounds of one electoral term, as calendar dates. */
export type ElectoralTerm = {
  /**
   * When this Bundestag was elected — its own election, not its successor's.
   *
   * Present for completeness and used by nothing here: a ballot is a lame-duck
   * ballot by virtue of falling after the *next* election, so `dissolvedOn`
   * below is what the check reads. Kept because a table of terms that omitted
   * the date each term began at the ballot box would be a table nobody could
   * verify against a published source.
   */
  electedOn: string
  /**
   * The constitutive sitting — when this Bundestag first convened, and the
   * moment its predecessor's term ended (Art. 39(1) GG).
   */
  constitutedOn: string
}

/**
 * German federal terms, by Wahlperiode.
 *
 * ⚠ The numbering is the one this codebase already uses everywhere else: **WP21
 * is the current Bundestag**, elected 2025-02-23 and constituted 2025-03-25.
 * `GOVERNING_PARTIES` in lib/seating.ts says the same (21 → CDU/CSU + SPD, 20 →
 * the Ampel), and convex/seedDev.ts seeds WP21 mandates starting 2025-03-25.
 *
 * Worth stating because it is off by one from the way the periods are sometimes
 * described by year — and getting it wrong would not fail any typecheck. It
 * would move the lame-duck window onto the wrong Bundestag and flag the wrong
 * ballots, which is exactly the failure this comment exists to prevent.
 *
 * WP19 is here for its `constitutedOn` alone: that date closes WP18's window,
 * and a term whose successor is missing from this map can never be checked. The
 * chain is only as long as its links.
 */
export const ELECTORAL_TERMS: Readonly<Record<number, ElectoralTerm>> = {
  // The current Bundestag. Elected early: the Scholz government lost a
  // confidence vote on 2024-12-16 and the Bundestag was dissolved, which is why
  // this election falls in February rather than at the end of a full four-year
  // term.
  21: { electedOn: "2025-02-23", constitutedOn: "2025-03-25" },
  // WP20 (2021–2025) — the Ampel's Bundestag. Its term ran until 2025-03-25,
  // thirty days after its successor was elected, and the ballots it took in
  // that final month are what this module marks.
  20: { electedOn: "2021-09-26", constitutedOn: "2021-10-26" },
  // WP19 (2017–2021). Kept so WP20's own window has a closing date; `backfill
  // --wp 20` is a supported command (AGENTS.md), so that Bundestag's ballots
  // are pages this site can render.
  19: { electedOn: "2017-09-24", constitutedOn: "2017-10-24" },
}

/**
 * When this table was last verified against published sources.
 *
 * Shown to the reader rather than kept as a source comment, the same disclosure
 * `inquiry.maintainedAsOf` makes for the exclusion matrix: a maintained
 * political fact with no date on it cannot be told apart from a stale one.
 */
export const LAME_DUCK_MAINTAINED_AS_OF = "2026-07-28"

/**
 * The window in which the Bundestag of `wahlperiode` was already a lame duck.
 *
 * That is: after its **successor** was elected and before that successor
 * convened. Both ends come from the successor's row, which is what makes the
 * lookup `wahlperiode + 1` rather than `wahlperiode` — the outgoing chamber's
 * own dates say nothing about when it became outgoing.
 *
 * Returns null when the successor is not in the table, which covers the two
 * ordinary cases as well as the missing-data one: the current Bundestag has no
 * successor yet, and a period nobody has maintained has no window rather than a
 * guessed one.
 */
export function lameDuckWindow(
  wahlperiode: number,
): { electedOn: string; constitutedOn: string } | null {
  const successor = ELECTORAL_TERMS[wahlperiode + 1]
  if (successor === undefined) return null
  return { electedOn: successor.electedOn, constitutedOn: successor.constitutedOn }
}

/**
 * Whether a ballot was taken by a parliament its electorate had already
 * replaced.
 *
 * ## The interval, and why both ends are what they are
 *
 * **Open at the start, half-open at the end**: `electedOn < date <
 * constitutedOn`.
 *
 * Election day itself is excluded. The Bundestag does not sit on a Sunday, so
 * in practice nothing lands there — but the term has not turned over at any
 * point during polling either, and a ballot dated that day would be the old
 * chamber acting before the result existed, which is not the thing this flags.
 *
 * The constitutive day is excluded for the opposite and much sharper reason:
 * that is the day the new Bundestag convenes and the old term *ends* (Art. 39(1)
 * GG). A ballot dated 2025-03-25 belongs to the new chamber, and marking it
 * would be precisely backwards — it would put the label on the parliament that
 * had just been elected.
 *
 * ## Dates are compared as strings
 *
 * ISO `YYYY-MM-DD` throughout the schema (convex/schema.ts header), so
 * lexicographic order is chronological and no parsing is needed. That also means
 * no timezone can shift a ballot across a boundary — which a `new Date()`
 * comparison could, and the boundary here is a day wide.
 */
export function isLameDuckVote(date: string, wahlperiode: number): boolean {
  const window = lameDuckWindow(wahlperiode)
  if (window === null) return false
  return date > window.electedOn && date < window.constitutedOn
}
