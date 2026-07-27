import type { TranslationKey } from "./i18n"
import type { RankingMetric } from "./taxonomy"

/**
 * The nine leaderboards, as data.
 *
 * A table rather than nine components, because they differ in four things —
 * which query answers them, which column ranks, which extra columns show, and
 * which caveat applies — and everything else about them is identical. Nine
 * components is how the caveat ends up on eight of them.
 *
 * The three `kind`s are not cosmetic; they are the three query shapes
 * convex/rankings.ts exposes, and they exist because two of these boards are
 * not columns. See that module's header.
 */

/** A column in a leaderboard table. */
export type BoardColumn = {
  /** Which field of the row to read. Constrained to the metrics the query
   * returns, so a column naming a field that is not there is a type error. */
  field: RankingMetric | "change" | "previousScore" | "dissents" | "ballotsCast" | "dissentRate"
  labelKey: TranslationKey
  /** How to render the number. `rate` is a 0…1 share shown as a percentage;
   * `delta` carries an explicit sign, because "+12" and "12" say different
   * things on a board about change. */
  format: "integer" | "rate" | "score" | "delta"
  /** Whether the table head offers this column as a sort. False for the two
   * derived boards, whose ordering is the board's definition rather than a
   * column preference — see `kind` below. */
  sortable: boolean
}

export type Leaderboard = {
  id: string
  labelKey: TranslationKey
  descriptionKey: TranslationKey
  /**
   * Which query answers this board.
   *
   *  - `metric` — `getMetricRankings`, ranking one stored column.
   *  - `rising` — `getRisingRankings`, differencing two months.
   *  - `crossParty` — `getCrossPartyRankings`, computed from ballots.
   */
  kind: "metric" | "rising" | "crossParty"
  /** The ranked column, for a `metric` board. */
  metric?: RankingMetric
  /** Columns shown before the activity score, ranked one first. */
  columns: BoardColumn[]
  /**
   * The structural limit on what this board's number means, if it has one.
   *
   * These are limits of the sources, not gaps to be filled later
   * (docs/api-research.md §4.4, §5.2, §6.4), so they render beside the board
   * rather than under an "about" link. A board with no caveat has none —
   * `undefined`, not an empty string, so a forgotten one is visibly absent.
   */
  caveatKey?: TranslationKey
}

export const LEADERBOARDS: Leaderboard[] = [
  {
    id: "most-active",
    labelKey: "rankings.board.mostActive",
    descriptionKey: "rankings.board.mostActive.desc",
    kind: "metric",
    metric: "totalScore",
    columns: [],
  },
  {
    id: "speeches",
    labelKey: "rankings.board.speeches",
    descriptionKey: "rankings.board.speeches.desc",
    kind: "metric",
    metric: "speechCount",
    // The word count sits beside the segment count deliberately: §5.2's finding
    // is that the two disagree about who spoke most, and showing only the
    // ranked one would hide the disagreement rather than surface it.
    columns: [
      {
        field: "speechCount",
        labelKey: "rankings.column.speeches",
        format: "integer",
        sortable: true,
      },
      {
        field: "speechWordCount",
        labelKey: "rankings.column.words",
        format: "integer",
        sortable: true,
      },
    ],
    caveatKey: "rankings.caveat.speechCount",
  },
  {
    id: "motions",
    labelKey: "rankings.board.motions",
    descriptionKey: "rankings.board.motions.desc",
    kind: "metric",
    metric: "motionCount",
    columns: [
      {
        field: "motionCount",
        labelKey: "rankings.column.motions",
        format: "integer",
        sortable: true,
      },
    ],
  },
  {
    id: "questions",
    labelKey: "rankings.board.questions",
    descriptionKey: "rankings.board.questions.desc",
    kind: "metric",
    metric: "questionCount",
    columns: [
      {
        field: "questionCount",
        labelKey: "rankings.column.questions",
        format: "integer",
        sortable: true,
      },
    ],
  },
  {
    id: "vote-participation",
    labelKey: "rankings.board.voteParticipation",
    descriptionKey: "rankings.board.voteParticipation.desc",
    kind: "metric",
    metric: "voteParticipationRate",
    columns: [
      {
        field: "voteParticipationRate",
        labelKey: "rankings.column.participation",
        format: "rate",
        sortable: true,
      },
    ],
    caveatKey: "rankings.caveat.namedVotesOnly",
  },
  {
    id: "cross-party",
    labelKey: "rankings.board.crossParty",
    descriptionKey: "rankings.board.crossParty.desc",
    kind: "crossParty",
    // Not sortable: the board *is* its ordering, and the denominator
    // (`ballotsCast`) is context for the count rather than a ranking of its own.
    columns: [
      {
        field: "dissents",
        labelKey: "rankings.column.dissent",
        format: "integer",
        sortable: false,
      },
      {
        field: "ballotsCast",
        labelKey: "rankings.column.ballots",
        format: "integer",
        sortable: false,
      },
      // The rate, now that there is a period-wide denominator worth dividing by.
      // It was omitted while the board covered 20 ballots, where every member's
      // denominator was nearly the same number and the rate said nothing the
      // count did not. Over a whole period they diverge — a member who joined
      // mid-period has half the ballots — and the count alone would rank a
      // four-year backbencher above a more frequent dissenter who arrived late.
      //
      // Still not the ranked column: the board is "most dissent", and ranking by
      // rate would put a member with 1 of 20 above one with 30 of 700.
      {
        field: "dissentRate",
        labelKey: "rankings.column.dissentRate",
        format: "rate",
        sortable: false,
      },
    ],
    caveatKey: "rankings.caveat.crossParty",
  },
  {
    id: "committees",
    labelKey: "rankings.board.committees",
    descriptionKey: "rankings.board.committees.desc",
    kind: "metric",
    metric: "committeeCount",
    columns: [
      {
        field: "committeeCount",
        labelKey: "rankings.column.committees",
        format: "integer",
        sortable: true,
      },
    ],
    caveatKey: "rankings.caveat.committeesCurrentOnly",
  },
  {
    id: "bills",
    labelKey: "rankings.board.bills",
    descriptionKey: "rankings.board.bills.desc",
    kind: "metric",
    metric: "billSponsorshipCount",
    columns: [
      {
        field: "billSponsorshipCount",
        labelKey: "rankings.column.bills",
        format: "integer",
        sortable: true,
      },
    ],
  },
  {
    id: "rising",
    labelKey: "rankings.board.rising",
    descriptionKey: "rankings.board.rising.desc",
    kind: "rising",
    columns: [
      { field: "change", labelKey: "rankings.column.change", format: "delta", sortable: false },
      {
        field: "previousScore",
        labelKey: "rankings.column.previous",
        format: "score",
        sortable: false,
      },
    ],
    caveatKey: "rankings.caveat.rising",
  },
]

export function boardById(id: string): Leaderboard | undefined {
  return LEADERBOARDS.find((board) => board.id === id)
}

/** The default board — the one the page opens on and the one an unknown tab id
 * falls back to. */
export const DEFAULT_BOARD_ID = "most-active"
