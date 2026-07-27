/**
 * The narrative homepage's shared vocabulary — the arc it draws, the order it
 * draws it in, and the chapters it is made of.
 *
 * ## Why this is a module and not five constants inside the page
 *
 * Two components need the *same* arc from the *same* seat counts: the splash
 * screen (components/home-protokoll/protokoll-splash.tsx) and Chapter 1
 * (components/home-protokoll/chapter-chamber.tsx). The splash's whole idea is
 * that it "becomes the page" — the arc it assembles contracts into the mark and
 * the reader lands on the same arc, drawn at the same scale, in the same
 * left-to-right bloc order. Two builders would drift by a seat radius and the
 * illusion goes with it.
 *
 * It also keeps this file testable, which is the reason lib/seating.ts exists
 * one level down: an arc that seats 629 of 630 MPs still renders as a plausible
 * chamber. Everything here that can be wrong without looking wrong —
 * the expansion of counts into fills, the centre-outward ordering, the reveal
 * fraction — is a pure function with a test beside it.
 *
 * ## What it does *not* own
 *
 * The geometry. `layoutHemicycle` (lib/seating.ts) already returns positions,
 * a seat radius and a viewBox for an arbitrary seat count, and `seatingRank`
 * already orders the blocs along the political axis. Both are reused rather
 * than re-derived — PROTOCOL.md's "never introduce a second way to do something
 * that already exists" is exactly the rule that matters here, since a second
 * hemicycle would be a second answer to the shape of the Bundestag.
 */

import type { TranslationKey } from "./i18n"
import { type FractionSize, foldFractionSizes, partyColor } from "./parties"
import { layoutHemicycle, type SeatPosition, seatingRank } from "./seating"

// --- the arc --------------------------------------------------------------

/**
 * Cap on the dots drawn.
 *
 * The real chamber is 630 and every one of them fits; this only bounds a
 * pathological roster from turning a hero thumbnail — or an animated entrance
 * where each node also carries a transition — into a thousand-node SVG.
 *
 * It matches `MAX_PAGE` in convex/lib/ingest.ts, which is 700 for the same
 * reason: the roster is 630 seats and 635 mandates (§6.2), so anything above
 * that is not a Bundestag.
 */
export const MAX_ARC_SEATS = 700

/**
 * The largest a seat dot may be drawn, matching the cap
 * components/seating-preview.tsx applies for the reason its comment gives at
 * length: `seatRadius` is derived from the tightest spacing in the arc, which
 * is right at 630 seats (0.019 of the unit radius) and far too generous at the
 * low end, so a 12-seat development fixture renders as a dozen balloons rather
 * than as a chamber.
 *
 * Every roster from about 90 seats up is unaffected.
 */
const MAX_SEAT_RADIUS = 0.08

/** One drawable seat: where it sits, and which group's colour it carries. */
export type ArcSeat = {
  position: SeatPosition
  fill: string
  /** How far this seat is from the middle of the arc, 0 at the centre and 1 at
   * either end. The splash and Chapter 1 both stagger on it — see
   * `centreOutwardDistance`. */
  distance: number
}

export type Arc = {
  seats: ArcSeat[]
  seatRadius: number
  viewBox: { x: number; y: number; width: number; height: number }
  /** Seats actually drawn, after the cap. Not necessarily the roster's size. */
  total: number
  /** Group sizes, folded onto one entry per party and in political order — what
   * the chapter's legend reads. */
  groups: FractionSize[]
}

/**
 * How far a seat is from the centre of the arc, as 0…1.
 *
 * The splash fades seats in "from the centre outward" (§6, Concept L1), and the
 * centre of a hemicycle is the *top* of the arc rather than the middle of the
 * seat list — `layoutHemicycle` returns positions sorted left to right, so
 * index order runs along the bench and not out from the middle. Using the index
 * would sweep the chamber left-to-right, which is a different animation and,
 * worse, one that reads as the political spectrum filling in from the Linke.
 *
 * Derived from the angle rather than from the index for that reason: π/2 is the
 * top of the arc in `layoutHemicycle`'s convention, and the two ends are π and
 * 0. So the distance is how far the seat's angle is from π/2, normalised by the
 * π/2 that is the furthest it can be.
 */
export function centreOutwardDistance(angle: number): number {
  return Math.min(1, Math.abs(angle - Math.PI / 2) / (Math.PI / 2))
}

/**
 * Lays out `fills.length` seats and gives each one its colour.
 *
 * The whole arc except *where the colours came from*, which is the only thing
 * `buildArc` and `placeholderArc` differ in — one reads a roster, the other
 * paints a neutral placeholder — and everything else about them was identical
 * down to the `extent` arithmetic. Two copies is how the splash's arc and the
 * chapter's come to differ by a seat radius, which is exactly the drift the
 * module header says must not happen.
 *
 * The two decisions it makes:
 *
 *  - **The radius is capped.** `layoutHemicycle` derives it from the tightest
 *    spacing in the arc, which is right at 630 seats (0.019 of the unit radius)
 *    and far too generous at the low end — a 12-seat development fixture would
 *    render as a dozen balloons. Capping rather than forcing the row count
 *    keeps the geometry `/seating` draws; overriding `rows` was tried and is
 *    worse, since short rows put their seats at the arc's extreme angles and a
 *    small chamber scatters into corners instead of reading as a bank.
 *  - **The viewBox is recomputed from the capped radius**, not taken from the
 *    layout, which sized its own box for the *uncapped* dots. Using that one
 *    leaves a band of empty space around a small-dotted arc and floats the
 *    picture inside its frame.
 */
function arcFrom(fills: readonly string[], groups: FractionSize[]): Arc {
  const layout = layoutHemicycle(fills.length)
  const seatRadius = Math.min(layout.seatRadius, MAX_SEAT_RADIUS)
  const extent = 1 + seatRadius

  return {
    seats: layout.positions.map((position, index) => ({
      position,
      fill: fills[index],
      distance: centreOutwardDistance(position.angle),
    })),
    seatRadius,
    viewBox: { x: -extent, y: -extent, width: 2 * extent, height: extent + seatRadius },
    total: fills.length,
    groups,
  }
}

/**
 * Expands Fraktion counts into a drawable arc.
 *
 * Counts fold onto one entry per party (`foldFractionSizes`, which is what
 * stops production's two spellings of "Fraktionslos" reading as two groups),
 * sort into political order (`seatingRank`), and then become one fill per seat.
 * `layoutHemicycle` returns `positions` sorted left to right, so index *i* of
 * the arc is index *i* of the bloc-ordered fills — the property that makes the
 * wedges read as wedges, where filling row by row would give the largest group
 * the inner rows entirely and turn the blocs into radial bands.
 *
 * Returns null for `undefined` input — Convex still loading — rather than an
 * empty arc, so a caller can tell "no answer yet" from "an empty chamber".
 */
export function buildArc(fractionSizes: ReadonlyArray<FractionSize> | undefined): Arc | null {
  if (fractionSizes === undefined) return null

  const groups = foldFractionSizes(fractionSizes).sort(
    (a, b) =>
      seatingRank(a.fraktion) - seatingRank(b.fraktion) ||
      a.fraktion.localeCompare(b.fraktion, "de"),
  )

  const fills: string[] = []
  for (const { fraktion, count } of groups) {
    const seats = Math.max(0, Math.min(count, MAX_ARC_SEATS - fills.length))
    for (let seat = 0; seat < seats; seat++) fills.push(partyColor(fraktion))
  }

  return arcFrom(fills, groups)
}

/**
 * A synthetic arc of `seatCount` neutral seats, for the frame before the roster
 * arrives.
 *
 * The splash cannot wait for `getFractionSizes` — it is on screen while that
 * query is still in flight, which is the entire point of overlapping the two
 * (§6: the splash must "never block data fetching"). So it assembles the shape
 * from the statutory seat count in a neutral colour, and the real colours flush
 * through only if the counts land in time.
 *
 * Neutral rather than a guessed distribution, and that is a claim about honesty
 * rather than about taste: a placeholder chamber painted in party colours would
 * be a picture of a Bundestag that does not exist, shown for 900 ms on the page
 * whose whole premise is that every figure is backed by a record.
 */
export function placeholderArc(seatCount: number): Arc {
  return arcFrom(new Array(Math.max(0, seatCount)).fill(PLACEHOLDER_FILL), [])
}

/** The placeholder's one colour — see `placeholderArc` for why it is a neutral
 * and not a party palette. Named so the test asserts against the constant
 * rather than against a repeated literal. */
export const PLACEHOLDER_FILL = "var(--muted-foreground)"

/**
 * The statutory size of the Bundestag, and the number the splash counts.
 *
 * 630 rather than the 635 mandate rows WP21 holds: §6.2 reconciles the two —
 * 635 mandates minus 5 departures is 630 sitting at once, which is the seat
 * count the Wahlrechtsreform fixes and the number a reader recognises. It is a
 * constant because the splash runs before any query resolves and therefore
 * cannot read it from the data; the *chapter* underneath shows the real roster,
 * so a period whose roster differs is stated correctly the moment the query
 * lands.
 */
export const STATUTORY_SEATS = 630

// --- the reveal ------------------------------------------------------------

/**
 * How much of the arc is drawn at scroll `progress`, as a seat count.
 *
 * The seats are revealed by *distance from the centre* rather than by index
 * (see `centreOutwardDistance`), so this returns a threshold on that distance
 * and not a slice of the list. A caller shows every seat whose `distance` is
 * under the threshold.
 *
 * `revealFraction` is deliberately not linear in progress. The first fifth of
 * the pin is spent reading the chapter's sentence, so the arc holds at a token
 * few seats; the last fifth is spent looking at a finished chamber before the
 * pin releases. In between it fills. Encoded here rather than as an `ease` on a
 * `useTransform` because the *shape* is the editorial decision — an ease is how
 * fast, this is when it starts and when it is done.
 */
export function revealThreshold(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  if (clamped <= 0.12) return 0
  if (clamped >= 0.82) return 1
  return (clamped - 0.12) / 0.7
}

// --- the chapters ----------------------------------------------------------

/**
 * The five chapters, as data.
 *
 * A table rather than five inline headers, in the same spirit as `LEADERBOARDS`
 * (lib/leaderboards.ts) and `SEATING_MODES` (lib/seating.ts): the chapters
 * differ in their number, their heading, their standfirst and their anchor, and
 * are otherwise identical. Five copies is how one of them loses its number, or
 * how the skip-link's target and the section's own `id` drift apart — the
 * anchor is written once here and read by both.
 *
 * The `question` each answers is not decoration. Concept A's arc is a sequence
 * of questions a first-time reader actually has (what is this / why does it
 * exist / what does it measure / who / what now), and stating them in the type
 * is what keeps a future sixth chapter from being added because it looked
 * empty on the right-hand side.
 */
export type Chapter = {
  /** Printed as the chapter number, and used to build the DOM ids. */
  index: number
  /** The fragment this chapter is reachable at. `id` on the `<section>`, target
   * of the progress rail's marks. */
  anchor: string
  numberKey: TranslationKey
  titleKey: TranslationKey
  standfirstKey: TranslationKey
}

export const CHAPTERS: readonly Chapter[] = [
  {
    index: 1,
    anchor: "kapitel-1",
    numberKey: "protokoll.chapter1Number",
    titleKey: "protokoll.chapter1Title",
    standfirstKey: "protokoll.chapter1Standfirst",
  },
  {
    index: 2,
    anchor: "kapitel-2",
    numberKey: "protokoll.chapter2Number",
    titleKey: "protokoll.chapter2Title",
    standfirstKey: "protokoll.chapter2Standfirst",
  },
  {
    index: 3,
    anchor: "kapitel-3",
    numberKey: "protokoll.chapter3Number",
    titleKey: "protokoll.chapter3Title",
    standfirstKey: "protokoll.chapter3Standfirst",
  },
  {
    index: 4,
    anchor: "kapitel-4",
    numberKey: "protokoll.chapter4Number",
    titleKey: "protokoll.chapter4Title",
    standfirstKey: "protokoll.chapter4Standfirst",
  },
  {
    index: 5,
    anchor: "kapitel-5",
    numberKey: "protokoll.chapter5Number",
    titleKey: "protokoll.chapter5Title",
    standfirstKey: "protokoll.chapter5Standfirst",
  },
]

/** The chapter the "straight to the data" link jumps past the story to. Chapter
 * 2 is the first one carrying figures — Chapter 1 is a picture. */
export const DATA_ANCHOR = CHAPTERS[1].anchor
