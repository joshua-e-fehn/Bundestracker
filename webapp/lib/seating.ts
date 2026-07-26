/**
 * The hemicycle's geometry, and the two political conventions it renders.
 *
 * ## ⚠ These are not real seats
 *
 * §9 of docs/api-research.md is definitive: **no official machine-readable seat
 * assignment exists**. It is absent from the DIP OpenAPI spec, the MdB-Stammdaten
 * DTD, the plenary protocol XML and its DTD, the bundestag.de plenary pages and
 * Wikidata. The Bundestag publishes a seating plan only as a rendered graphic per
 * sitting.
 *
 * What *is* derivable is the **distribution** — how many seats each Fraktion
 * holds — by counting the roster (`mps.getFractionSizes`). So this module places
 * right-sized blocs on a standard parliament arc in the conventional political
 * order. Which arc position a named MP occupies is arbitrary; the *shape* and the
 * *bloc sizes* are the real information. convex/seating.ts carries the same
 * warning where the rows are written, and the page states it to the reader.
 *
 * ## Why the geometry is here and not in the component
 *
 * Same reason lib/heatmap.ts exists: this is the part that can be wrong without
 * looking wrong. An arc with a rounding bug still renders as a plausible
 * hemicycle — it just quietly seats 628 of 630 MPs, or overlaps two seats into
 * one dot. A test catches that; an eye does not.
 *
 * It is also the part that must agree in **two processes**. `generateSeating`
 * (convex/seating.ts) assigns MPs to slots server-side and stores `(row, column)`;
 * the map component recomputes the coordinates client-side. Both call
 * `layoutHemicycle`, so they cannot disagree — see the note on `layoutHemicycle`
 * for why passing the seat count is what makes that guarantee hold.
 */

import type { TranslationKey } from "./i18n"
import { type PartyKey, partyColor, partyFor } from "./parties"

// --- political conventions ------------------------------------------------

/**
 * Left-to-right order of the blocs, by political spectrum.
 *
 * A real convention rather than a property of the data: parliaments seat groups
 * along a left-right axis, and a hemicycle ordered alphabetically or by size
 * would be unreadable as a political picture. This is the order the Bundestag
 * itself uses.
 *
 * Keyed by `PartyKey` rather than by the raw `fraktion` string, which is the
 * correction this module makes to the list it replaces. The sources spell one
 * group several ways — the long Stammdaten legal form, DIP's
 * `BÜNDNIS 90/DIE GRÜNEN`, the vote sheets' `BÜ90/GR`, and §5.2's
 * `'BÜNDNIS\xa090/ DIE GRÜNEN'` with a non-breaking space — so a list of literal
 * strings silently drops any group spelled the other way to the far edge of the
 * chamber. `partyFor` already folds all of those onto one key (lib/parties.ts);
 * routing through it means the arc inherits that matching instead of restating a
 * weaker version of it.
 *
 * `fraktionslos` sits at the right-hand edge rather than being left out: an MP
 * with no group still holds a seat. `unknown` follows it, so a Fraktion this
 * codebase does not recognise appears at the edge in a neutral colour — visible,
 * and a prompt to add it — rather than being dropped from the chamber.
 */
export const SEATING_ORDER: readonly PartyKey[] = [
  "linke",
  "gruene",
  "spd",
  "fdp",
  "cdu-csu",
  "afd",
  "fraktionslos",
  "unknown",
]

/** Where a Fraktion sits on the left-right axis. Unrecognised groups sort last,
 * next to `unknown`, rather than to position 0 — a `-1` from `indexOf` would put
 * every unknown group on the far left, which is a political claim about it. */
export function seatingRank(fraktion: string | null | undefined): number {
  const index = SEATING_ORDER.indexOf(partyFor(fraktion).key)
  return index === -1 ? SEATING_ORDER.length : index
}

/**
 * Which groups formed the government, per Wahlperiode.
 *
 * ⚠ **Not derivable from any Bundestag dataset.** Nothing the pipeline ingests
 * records who governs — §9 lists what the sources carry, and a coalition is not
 * among it. This is a hand-maintained political fact, which is exactly why it is
 * a dated map rather than a flag on the Fraktion: the same group governs in one
 * period and opposes in the next, and a boolean would silently restate this
 * period's politics for every historical page.
 *
 * A period absent from this map yields `unknown` rather than `opposition`, so
 * `backfill --wp 19` renders a chamber in neutral colours with the mode's caveat
 * shown, instead of confidently colouring the whole Bundestag as opposition.
 */
export const GOVERNING_PARTIES: Readonly<Record<number, readonly PartyKey[]>> = {
  // WP21 (2025–): CDU/CSU and SPD.
  21: ["cdu-csu", "spd"],
  // WP20 (2021–2025): the "Ampel" — SPD, Grüne, FDP. Kept because
  // `backfill --wp 20` is a supported command (AGENTS.md), so that Bundestag is
  // a page this site can render.
  20: ["spd", "gruene", "fdp"],
}

export type CoalitionRole = "government" | "opposition" | "unknown"

/** Whether a Fraktion governed in a given period. `unknown` for a period whose
 * coalition is not recorded above — see the warning there. */
export function coalitionRole(
  fraktion: string | null | undefined,
  wahlperiode: number,
): CoalitionRole {
  const governing = GOVERNING_PARTIES[wahlperiode]
  if (governing === undefined) return "unknown"
  return governing.includes(partyFor(fraktion).key) ? "government" : "opposition"
}

// --- arc geometry ---------------------------------------------------------

/** One seat's place on the arc. `row` counts outward from the podium (0 is the
 * innermost, shortest row) and `column` counts left to right within that row —
 * the two fields convex/seating.ts stores. `x`/`y` are the drawing coordinates,
 * derived, and never stored. */
export type SeatPosition = {
  row: number
  column: number
  /** Radians, π at the left-hand end of the arc through to 0 at the right. */
  angle: number
  x: number
  y: number
}

export type HemicycleLayout = {
  rows: number
  positions: SeatPosition[]
  /** Radius of one seat dot, in the same units as `x`/`y`. Derived from the
   * tightest spacing in the whole arc so no two seats can overlap. */
  seatRadius: number
  /** An SVG `viewBox` that contains the arc with room for the seat dots. */
  viewBox: { x: number; y: number; width: number; height: number }
}

export type HemicycleOptions = {
  /** Radius of the innermost row, with the outermost fixed at 1. Sets how deep
   * the bank of seats is: nearer 1 is a thin ring, nearer 0 a filled fan. */
  innerRatio?: number
  /** Overrides the derived row count. For a caller that wants a specific
   * chamber shape rather than the balanced default. */
  rows?: number
}

/** The default depth of the bank. 0.4 leaves a hole at the podium roughly the
 * size of the well of the chamber, which is what makes the shape read as a
 * parliament rather than as a filled pie. */
const DEFAULT_INNER_RATIO = 0.4

/**
 * How many concentric rows to use for `seatCount` seats.
 *
 * Chosen so the gap *between* rows matches the gap *along* a row, which is what
 * makes the seats look evenly distributed rather than smeared into arcs or
 * stacked into spokes. Solving those two spacings for equality gives
 *
 *     rows = sqrt( 2·n·(1 − i₀) / (π·(1 + i₀)) )
 *
 * where `i₀` is `innerRatio`. For a 630-seat Bundestag at the default depth that
 * is 13 rows — an outer row of about 69 seats and an inner one of about 27.
 *
 * Clamped to at least one row, and never more rows than seats: `distributeSeats`
 * guarantees every row holds at least one seat, which is only satisfiable while
 * `rows ≤ seatCount`.
 */
export function hemicycleRowCount(seatCount: number, innerRatio = DEFAULT_INNER_RATIO): number {
  if (seatCount <= 0) return 0
  const ideal = Math.sqrt((2 * seatCount * (1 - innerRatio)) / (Math.PI * (1 + innerRatio)))
  return Math.max(1, Math.min(seatCount, Math.round(ideal)))
}

/**
 * Splits `seatCount` seats across rows in proportion to each row's radius.
 *
 * Proportional to radius, not equal per row, because a longer arc holds more
 * seats at the same spacing — that proportionality is what keeps the spacing
 * uniform and is the assumption `hemicycleRowCount` solves against.
 *
 * Largest-remainder rather than plain rounding: rounding each row independently
 * loses or gains seats, and a hemicycle that seats 629 of 630 MPs is a bug that
 * looks like a rendering artefact. The total returned here is exactly
 * `seatCount`.
 */
export function distributeSeats(seatCount: number, radii: readonly number[]): number[] {
  const rowCount = radii.length
  if (rowCount === 0 || seatCount <= 0) return new Array(rowCount).fill(0)

  const total = radii.reduce((sum, radius) => sum + radius, 0)
  const exact = radii.map((radius) => (seatCount * radius) / total)
  // Every row holds at least one seat: an empty row inside the bank would read
  // as a gangway that is not there. Always satisfiable — see `hemicycleRowCount`.
  const counts = exact.map((value) => Math.max(1, Math.floor(value)))

  let assigned = counts.reduce((sum, count) => sum + count, 0)

  // Hand out what rounding down left over, to the rows that lost the most.
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let step = 0; assigned < seatCount; step++) {
    counts[byRemainder[step % rowCount].index]++
    assigned++
  }

  // The `max(1, …)` above can overshoot when a row's exact share was below one.
  // Take the excess off the largest rows, where one seat changes the spacing
  // least, and never below the one-seat floor.
  while (assigned > seatCount) {
    let largest = -1
    for (let index = 0; index < rowCount; index++) {
      if (counts[index] > 1 && (largest === -1 || counts[index] > counts[largest])) largest = index
    }
    if (largest === -1) break
    counts[largest]--
    assigned--
  }

  return counts
}

/**
 * The full arc for `seatCount` seats.
 *
 * ## The returned order is the seating order
 *
 * `positions` comes back sorted **by angle, left to right** — not row by row.
 * That ordering is the whole reason the blocs read as wedges: assigning MPs to
 * `positions[0…n]` in political order gives each Fraktion a contiguous slice of
 * the arc spanning every row, which is how a parliament seats its groups.
 *
 * Filling row by row instead — the obvious loop — produces radial bands: the
 * largest group takes the innermost rows entirely and the smallest is left as an
 * outer ring. That renders as a plausible hemicycle and is a different claim
 * about the chamber, which is the failure this ordering exists to avoid.
 *
 * ## Why the caller passes the seat count
 *
 * This function is deterministic in `(seatCount, options)` alone, which is what
 * lets the server and the browser compute the same arc without sharing state.
 * `generateSeating` lays out *n* MPs and stores each one's `(row, column)`; the
 * map component receives *n* seat rows and lays out *n* again, then matches on
 * that pair. The two agree by construction — and stay agreeing when the roster
 * changes, because until the generator re-runs the database still holds the old
 * *n* and the client still lays out the old *n*.
 */
export function layoutHemicycle(
  seatCount: number,
  options: HemicycleOptions = {},
): HemicycleLayout {
  const innerRatio = options.innerRatio ?? DEFAULT_INNER_RATIO
  const rows = options.rows ?? hemicycleRowCount(seatCount, innerRatio)

  if (seatCount <= 0 || rows <= 0) {
    return { rows: 0, positions: [], seatRadius: 0, viewBox: { x: -1, y: -1, width: 2, height: 1 } }
  }

  // Outermost row is always radius 1, so the arc's size does not depend on how
  // many rows it happens to need — a chamber of 630 and one of 90 render at the
  // same scale, and only the density differs.
  const radii = Array.from({ length: rows }, (_, row) =>
    rows === 1 ? 1 : innerRatio + ((1 - innerRatio) * row) / (rows - 1),
  )
  const counts = distributeSeats(seatCount, radii)

  const positions: SeatPosition[] = []
  for (const [row, count] of counts.entries()) {
    const radius = radii[row]
    for (let column = 0; column < count; column++) {
      // Ends aligned: every row starts at π and finishes at 0, so the left and
      // right edges of the bank are radial lines rather than a ragged stagger.
      // A one-seat row goes to the top of the arc, which is the only place on it
      // that is not an edge.
      const angle = count === 1 ? Math.PI / 2 : Math.PI * (1 - column / (count - 1))
      positions.push({
        row,
        column,
        angle,
        x: radius * Math.cos(angle),
        // Negated: SVG's y grows downward, so this puts the arc above the
        // origin and leaves the flat side — the podium — along the bottom.
        y: -radius * Math.sin(angle),
      })
    }
  }

  // Left to right. The row tie-break only bites at the two ends, where the
  // aligned rows share an angle exactly; inner-first is arbitrary but fixed, so
  // the arc does not reshuffle between renders.
  positions.sort((a, b) => b.angle - a.angle || a.row - b.row)

  const seatRadius = deriveSeatRadius(radii, counts, innerRatio, rows)
  const extent = 1 + seatRadius
  return {
    rows,
    positions,
    seatRadius,
    viewBox: { x: -extent, y: -extent, width: 2 * extent, height: extent + seatRadius },
  }
}

/**
 * How big to draw one seat.
 *
 * The tightest spacing anywhere in the arc bounds it — whichever is smaller, the
 * gap between rows or the gap between neighbours along the busiest row. Taking
 * the minimum over the whole arc rather than per row is what keeps the dots one
 * size: seats that grew with their row would make the outer rows read as more
 * important.
 *
 * `SEAT_FILL` under 0.5 is what leaves the gap. At exactly 0.5 the dots touch,
 * and a solid band of colour loses the one thing the diagram is counting.
 */
const SEAT_FILL = 0.42

function deriveSeatRadius(
  radii: readonly number[],
  counts: readonly number[],
  innerRatio: number,
  rows: number,
): number {
  const radialGap = rows === 1 ? 1 - innerRatio : (1 - innerRatio) / (rows - 1)

  let tightest = radialGap
  for (const [row, count] of counts.entries()) {
    if (count < 2) continue
    // Chord between neighbours, not arc length: the dots are round, so what
    // must not overlap is the straight-line distance between their centres.
    const chord = 2 * radii[row] * Math.sin(Math.PI / (2 * (count - 1)))
    if (chord < tightest) tightest = chord
  }
  return tightest * SEAT_FILL
}

// --- colour modes ---------------------------------------------------------

/**
 * The five ways to colour the chamber, as data.
 *
 * A table rather than five branches, in the same spirit as `LEADERBOARDS` in
 * lib/leaderboards.ts: the modes differ in three things — which value they read,
 * whether that value is categorical or continuous, and which caveat they carry —
 * and are otherwise identical. Five branches is how the caveat ends up on four
 * of them.
 *
 * Three of the five carry a caveat, and they are the three where a colour could
 * be read as a finding the data does not support:
 *
 *  - **coalition** — who governs is in no Bundestag dataset at all (see
 *    `GOVERNING_PARTIES`).
 *  - **attendance** — §4.4: named ballots are the exception, so a pale seat is
 *    mostly a statement about which votes get recorded, not about the MP.
 *  - **committee** — §6.4: membership is published for the current period only,
 *    so a historical chamber is uniformly zero.
 *
 * `party` and `activity` have none, and that is `undefined` rather than an empty
 * string so a forgotten caveat is visibly absent.
 */
export type SeatingColorMode = "party" | "coalition" | "activity" | "attendance" | "committee"

export type SeatingMode = {
  id: SeatingColorMode
  labelKey: TranslationKey
  /**
   * `categorical` colours by group membership and needs a key-per-value legend;
   * `continuous` colours by magnitude and needs a ramp with a low/high axis.
   * The legend reads this rather than switching on `id`, so a new mode gets the
   * right legend by declaring its kind.
   */
  scale: "categorical" | "continuous"
  caveatKey?: TranslationKey
}

export const SEATING_MODES: readonly SeatingMode[] = [
  { id: "party", labelKey: "seating.mode.party", scale: "categorical" },
  {
    id: "coalition",
    labelKey: "seating.mode.coalition",
    scale: "categorical",
    caveatKey: "seating.coalitionCaveat",
  },
  { id: "activity", labelKey: "seating.mode.activity", scale: "continuous" },
  {
    id: "attendance",
    labelKey: "seating.mode.attendance",
    scale: "continuous",
    caveatKey: "seating.attendanceCaveat",
  },
  {
    id: "committee",
    labelKey: "seating.mode.committee",
    scale: "continuous",
    caveatKey: "seating.committeeCaveat",
  },
]

/** The mode the page opens on. Party colours are the one view that needs no
 * caveat and no ramp to read. */
export const DEFAULT_SEATING_MODE: SeatingColorMode = "party"

export function seatingMode(id: string): SeatingMode | undefined {
  return SEATING_MODES.find((mode) => mode.id === id)
}

export function isSeatingColorMode(value: string): value is SeatingColorMode {
  return SEATING_MODES.some((mode) => mode.id === value)
}

/**
 * How many shades a continuous mode uses, matching the heatmap's ramp.
 *
 * Five, and for `heatmapLevel`'s reason (lib/heatmap.ts): the eye stops reading
 * a sequential ramp as ordered past about five steps. Sharing the count also
 * means the seating map and the contribution graph read as one system.
 */
export const SEATING_LEVELS = 5

/**
 * Buckets a continuous value into `0…SEATING_LEVELS-1`, or null for "no data".
 *
 * **Null is not zero, and this is the function that keeps them apart.** An MP
 * the nightly sweep has not scored yet and an MP who did nothing are different
 * claims; returning 0 for the first would put them in the same shade and assert
 * the second. The map renders null in a distinct neutral, and the legend names
 * it — the same decision `getMPsWithScores` makes for its sortable column.
 *
 * Scaled against the chamber's own maximum rather than an absolute range. Unlike
 * the per-MP heatmap the comparison here *is* between people, and all of them
 * are on screen at once, so the busiest MP defines the top of the ramp.
 */
export function seatingLevel(value: number | null | undefined, max: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  if (max <= 0) return 0
  const ratio = Math.max(0, Math.min(1, value / max))
  // `ceil` on a half-open scale, so only an exact zero lands in the bottom
  // bucket and any positive value is visibly above it.
  if (ratio === 0) return 0
  return Math.min(SEATING_LEVELS - 1, Math.ceil(ratio * (SEATING_LEVELS - 1)))
}

/**
 * The colour ramp for a continuous mode, indexed by `seatingLevel`.
 *
 * `--chart-*` rather than party colours or a bespoke gradient: those tokens are
 * already a sequential monochrome ramp defined for both themes in
 * app/globals.css, and a mode that colours by *magnitude* must not reuse hues
 * that mean *party* three modes away. Index 0 is the bottom of the scale — a real
 * zero — and is deliberately distinct from `NO_DATA_COLOR` below.
 */
const RAMP = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

/**
 * The shade for a seat whose value is unknown.
 *
 * Not the bottom of the ramp, which is the whole point: "the nightly sweep has
 * not scored this MP" and "this MP scored zero" are different claims, and
 * `--muted` is visibly outside the sequential scale rather than at its foot. The
 * legend names it, so a reader can tell which they are looking at. Same
 * reasoning as `--party-unknown` in lib/parties.ts — an unknown value renders as
 * unknown instead of borrowing a meaning it has not earned.
 */
export const NO_DATA_COLOR = "var(--muted)"

/** Coalition colours. Government reads as the primary accent and opposition as a
 * neutral outline; `unknown` shares `NO_DATA_COLOR`, because an unrecorded
 * coalition is missing data and not a third bloc. */
const COALITION_COLORS: Record<CoalitionRole, string> = {
  government: "var(--chart-4)",
  opposition: "var(--chart-2)",
  unknown: NO_DATA_COLOR,
}

/** Everything about one seat that any colour mode might read. Deliberately the
 * shape `seating.getSeatingWithMPs` returns per row, minus the parts only the
 * tooltip needs, so the page passes rows straight through. */
export type SeatColorInput = {
  fraktion: string | null | undefined
  totalScore: number | null | undefined
  voteParticipationRate: number | null | undefined
  committeeCount: number | null | undefined
}

/** The maxima a continuous mode scales against, computed once over the chamber
 * rather than per seat. */
export type SeatingMaxima = { score: number; committees: number }

/**
 * The chamber-wide maxima the ramp scales against.
 *
 * Computed from the seats actually on screen, so the busiest MP defines the top
 * of the scale — see `seatingLevel`. Attendance is absent because it is already
 * a 0…1 share and so has a fixed ceiling of 1: scaling a rate against the
 * chamber's best attender would make a 90 % turnout look poor next to a 95 % one.
 */
export function seatingMaxima(seats: readonly SeatColorInput[]): SeatingMaxima {
  let score = 0
  let committees = 0
  for (const seat of seats) {
    if (typeof seat.totalScore === "number" && seat.totalScore > score) score = seat.totalScore
    if (typeof seat.committeeCount === "number" && seat.committeeCount > committees) {
      committees = seat.committeeCount
    }
  }
  return { score, committees }
}

/**
 * The fill for one seat under one mode.
 *
 * One function for all five modes, called by both the map and the legend, so a
 * colour cannot mean one thing on a dot and another in the key beside it. Every
 * mode's "no data" answer routes through `NO_DATA_COLOR`, which is what keeps the
 * unknown-versus-zero distinction from having to be re-remembered per mode.
 */
export function seatColor(
  seat: SeatColorInput,
  mode: SeatingColorMode,
  wahlperiode: number,
  maxima: SeatingMaxima,
): string {
  switch (mode) {
    case "party":
      // Delegates to lib/parties.ts, which already folds every spelling of a
      // group onto one colour and renders an unrecognised one as neutral.
      return partyColor(seat.fraktion)
    case "coalition":
      return COALITION_COLORS[coalitionRole(seat.fraktion, wahlperiode)]
    case "activity":
      return rampColor(seatingLevel(seat.totalScore, maxima.score))
    case "attendance":
      // Against a fixed ceiling of 1, not the chamber's best — see
      // `seatingMaxima`.
      return rampColor(seatingLevel(seat.voteParticipationRate, 1))
    case "committee":
      return rampColor(seatingLevel(seat.committeeCount, maxima.committees))
  }
}

/** A ramp index, or the no-data shade for null. Kept private so every caller
 * goes through `seatColor` and inherits the same null handling. */
function rampColor(level: number | null): string {
  return level === null ? NO_DATA_COLOR : RAMP[Math.max(0, Math.min(RAMP.length - 1, level))]
}

/** The ramp as a list, for the legend's low-to-high strip. A copy, so a caller
 * cannot mutate the module's ramp. */
export function seatingRamp(): string[] {
  return [...RAMP]
}
