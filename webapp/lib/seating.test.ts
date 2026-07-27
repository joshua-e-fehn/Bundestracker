import { describe, expect, test } from "bun:test"
import { partyColor } from "./parties"
import {
  buildFractionArc,
  coalitionRole,
  distributeSeats,
  expandFractionSeats,
  hemicycleRowCount,
  hemicycleViewBox,
  isSeatingColorMode,
  layoutHemicycle,
  MAX_DECORATIVE_SEAT_RADIUS,
  orderFractionSizes,
  SEATING_LEVELS,
  SEATING_MODES,
  SEATING_ORDER,
  seatingLevel,
  seatingRank,
} from "./seating"

/**
 * Tests for the hemicycle's geometry.
 *
 * Same premise as lib/heatmap.test.ts: this is the part that can be wrong
 * without looking wrong. An arc that seats 629 of 630 MPs, or that overlaps two
 * dots into one, or that fills row by row and turns the blocs into radial bands
 * instead of wedges — every one of those still renders as a plausible chamber.
 * None throws. That is what these are for.
 *
 * The seat *count* is the one part of this diagram that is real data (§9: the
 * distribution is derivable, the assignment is not), so losing a seat to
 * rounding is the one bug here that would misstate the Bundestag rather than
 * merely look wrong.
 */

/** WP21 as §9 counts it: CDU/CSU 209, AfD 152, SPD 122, Grüne 88, Linke 67,
 * fraktionslos 3 — the 630 statutory seats plus the mid-period overhang §6.2
 * reconciles to 635. */
const WP21_SEATS = 630

describe("seatingRank", () => {
  test("orders the blocs left to right along the political spectrum", () => {
    const order = ["Die Linke", "BÜNDNIS 90/DIE GRÜNEN", "SPD", "FDP", "CDU/CSU", "AfD"]
    const ranks = order.map(seatingRank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    // And they are actually distinct — a mapping that collapsed every group to
    // one rank would also pass a sortedness check.
    expect(new Set(ranks).size).toBe(order.length)
  })

  test("recognises a Fraktion however the source spells it", () => {
    // The reason this routes through `partyFor` rather than matching literals.
    // All four spellings occur in the wild: the long Stammdaten legal form
    // (§6.4), DIP's form, the vote sheets' short form, and §5.2's protocol XML
    // with a non-breaking space and a stray space after the slash. A literal
    // list recognises one of these and exiles the rest to the chamber's edge.
    const greens = [
      "BÜNDNIS 90/DIE GRÜNEN",
      "BÜ90/GR",
      "BÜNDNIS40/ DIE GRÜNEN".replace("40", "90"),
      "Fraktion BÜNDNIS 90/DIE GRÜNEN",
    ]
    const ranks = greens.map(seatingRank)
    expect(new Set(ranks).size).toBe(1)
    expect(ranks[0]).toBe(SEATING_ORDER.indexOf("gruene"))

    const union = ["CDU/CSU", "Fraktion der Christlich Demokratischen Union/Christlich - Sozialen"]
    expect(new Set(union.map(seatingRank)).size).toBe(1)
  })

  test("an unrecognised group sits at the edge, not on the far left", () => {
    // `indexOf` returning -1 would seat every unfamiliar group at position 0 —
    // the far left — which is a political claim about a group this codebase
    // simply does not know. It belongs at the edge with `fraktionslos`.
    expect(seatingRank("Neue Partei 2029")).toBeGreaterThanOrEqual(
      seatingRank("BÜNDNIS 90/DIE GRÜNEN"),
    )
    expect(seatingRank(null)).toBeGreaterThanOrEqual(seatingRank("CDU/CSU"))
  })

  test("fraktionslos sits at the edge rather than being dropped", () => {
    // An MP with no group still holds a seat.
    expect(SEATING_ORDER).toContain("fraktionslos")
    expect(seatingRank("Fraktionslos")).toBeGreaterThan(seatingRank("AfD"))
  })
})

describe("coalitionRole", () => {
  test("splits WP21 into the governing coalition and the rest", () => {
    expect(coalitionRole("CDU/CSU", 21)).toBe("government")
    expect(coalitionRole("SPD", 21)).toBe("government")
    expect(coalitionRole("AfD", 21)).toBe("opposition")
    expect(coalitionRole("BÜNDNIS 90/DIE GRÜNEN", 21)).toBe("opposition")
    expect(coalitionRole("Die Linke", 21)).toBe("opposition")
  })

  test("reads the coalition of the period asked for, not of today", () => {
    // The whole reason this is a dated map rather than a flag on the Fraktion.
    // The Greens and the FDP governed in WP20 and oppose in WP21; a boolean
    // would restate this period's politics on every historical page.
    expect(coalitionRole("BÜNDNIS 90/DIE GRÜNEN", 20)).toBe("government")
    expect(coalitionRole("FDP", 20)).toBe("government")
    expect(coalitionRole("CDU/CSU", 20)).toBe("opposition")
  })

  test("an unrecorded period is unknown, not opposition", () => {
    // `backfill --wp 19` is a supported command. Defaulting to "opposition"
    // would colour an entire Bundestag as out of government, confidently and
    // wrongly, with nothing on screen to say the data was never there.
    expect(coalitionRole("CDU/CSU", 19)).toBe("unknown")
    expect(coalitionRole("SPD", 99)).toBe("unknown")
  })
})

describe("distributeSeats", () => {
  test("assigns exactly the seats it was given", () => {
    // The bug this function exists to prevent. Rounding each row independently
    // loses or gains seats, and a chamber that seats 629 of 630 MPs looks like
    // a rendering artefact rather than a miscount.
    for (const count of [1, 2, 7, 88, 152, 209, 630, 635, 736]) {
      const radii = Array.from({ length: hemicycleRowCount(count) }, (_, row) => 0.4 + row * 0.05)
      const seats = distributeSeats(count, radii)
      expect(seats.reduce((sum, n) => sum + n, 0)).toBe(count)
    }
  })

  test("gives longer rows more seats", () => {
    // Proportionality to radius is what keeps the spacing even — it is the
    // assumption `hemicycleRowCount` solves against, so if it breaks the seats
    // smear along the outer rows and bunch on the inner ones.
    const seats = distributeSeats(WP21_SEATS, [0.4, 0.6, 0.8, 1])
    expect(seats).toEqual([...seats].sort((a, b) => a - b))
    expect(seats[3]).toBeGreaterThan(seats[0])
  })

  test("never leaves a row empty", () => {
    // A gap inside the bank reads as a gangway that is not there.
    const seats = distributeSeats(5, [0.4, 0.55, 0.7, 0.85, 1])
    expect(seats.every((n) => n >= 1)).toBe(true)
    expect(seats.reduce((sum, n) => sum + n, 0)).toBe(5)
  })

  test("handles degenerate inputs without inventing seats", () => {
    expect(distributeSeats(0, [0.4, 1])).toEqual([0, 0])
    expect(distributeSeats(10, [])).toEqual([])
    expect(distributeSeats(-5, [1])).toEqual([0])
  })
})

describe("hemicycleRowCount", () => {
  test("picks a row count that reads as a parliament for a real chamber", () => {
    // Balanced so the gap between rows matches the gap along a row. Too few and
    // the seats smear into arcs; too many and they stack into spokes.
    const rows = hemicycleRowCount(WP21_SEATS)
    expect(rows).toBeGreaterThanOrEqual(10)
    expect(rows).toBeLessThanOrEqual(16)
  })

  test("never needs more rows than there are seats", () => {
    // `distributeSeats` guarantees every row holds at least one seat, which is
    // only satisfiable while rows <= seats.
    for (const count of [1, 2, 3, 5]) {
      expect(hemicycleRowCount(count)).toBeLessThanOrEqual(count)
      expect(hemicycleRowCount(count)).toBeGreaterThanOrEqual(1)
    }
    expect(hemicycleRowCount(0)).toBe(0)
  })
})

describe("layoutHemicycle", () => {
  test("places every seat exactly once", () => {
    const layout = layoutHemicycle(WP21_SEATS)
    expect(layout.positions).toHaveLength(WP21_SEATS)
    // `(row, column)` is what convex/seating.ts stores and what the component
    // matches on, so a duplicate pair would silently stack two MPs on one dot
    // and leave a hole elsewhere.
    const keys = new Set(layout.positions.map((seat) => `${seat.row}-${seat.column}`))
    expect(keys.size).toBe(WP21_SEATS)
  })

  test("returns seats left to right so blocs render as wedges", () => {
    // The ordering *is* the seating convention. Filling row by row instead —
    // the obvious loop — gives the largest group the inner rows and the
    // smallest an outer ring: a plausible-looking hemicycle making a different
    // claim about the chamber.
    const layout = layoutHemicycle(WP21_SEATS)
    const angles = layout.positions.map((seat) => seat.angle)
    expect(angles).toEqual([...angles].sort((a, b) => b - a))

    // A contiguous slice of that order therefore spans many rows, not one.
    const firstBloc = layout.positions.slice(0, 67) // Die Linke, §9
    expect(new Set(firstBloc.map((seat) => seat.row)).size).toBeGreaterThan(1)
  })

  test("puts the first seat on the left and the last on the right", () => {
    const layout = layoutHemicycle(WP21_SEATS)
    const first = layout.positions[0]
    const last = layout.positions[layout.positions.length - 1]
    expect(first.x).toBeLessThan(0)
    expect(last.x).toBeGreaterThan(0)
    // Both ends sit on the podium line, which is what makes the bank's edges
    // radial rather than ragged.
    expect(first.y).toBeCloseTo(0, 6)
    expect(last.y).toBeCloseTo(0, 6)
  })

  test("draws the arc above the podium", () => {
    // SVG's y grows downward, so an un-negated sine would render the chamber
    // upside down — still a hemicycle, just the wrong one.
    const layout = layoutHemicycle(WP21_SEATS)
    expect(layout.positions.every((seat) => seat.y <= 1e-9)).toBe(true)
  })

  test("no two seats overlap", () => {
    // The seat radius is derived from the tightest spacing in the arc. If that
    // derivation is wrong the dots merge into a solid band and the diagram
    // stops counting anything.
    const layout = layoutHemicycle(WP21_SEATS)
    const minimum = Math.min(
      ...layout.positions.slice(1).map((seat, index) => {
        const previous = layout.positions[index]
        return Math.hypot(seat.x - previous.x, seat.y - previous.y)
      }),
    )
    expect(minimum).toBeGreaterThan(2 * layout.seatRadius * 0.99)
    expect(layout.seatRadius).toBeGreaterThan(0)
  })

  test("the viewBox contains every seat dot", () => {
    // A seat clipped at the edge of the frame is an MP the reader cannot click.
    const layout = layoutHemicycle(WP21_SEATS)
    const { x, y, width, height } = layout.viewBox
    for (const seat of layout.positions) {
      expect(seat.x - layout.seatRadius).toBeGreaterThanOrEqual(x - 1e-9)
      expect(seat.x + layout.seatRadius).toBeLessThanOrEqual(x + width + 1e-9)
      expect(seat.y - layout.seatRadius).toBeGreaterThanOrEqual(y - 1e-9)
      expect(seat.y + layout.seatRadius).toBeLessThanOrEqual(y + height + 1e-9)
    }
  })

  test("is deterministic, so the server and the browser agree", () => {
    // The guarantee the whole two-process design rests on: `generateSeating`
    // lays out n seats and stores (row, column); the component lays out n again
    // and matches. Same input, same arc — or MPs move between page loads.
    const a = layoutHemicycle(WP21_SEATS)
    const b = layoutHemicycle(WP21_SEATS)
    expect(a.positions).toEqual(b.positions)
    expect(a.seatRadius).toBe(b.seatRadius)
  })

  test("renders a small chamber and a large one at the same scale", () => {
    // Only the density should differ — the outermost row is always radius 1, so
    // a committee-sized arc does not render as a giant one.
    const small = layoutHemicycle(90)
    const large = layoutHemicycle(WP21_SEATS)
    expect(large.seatRadius).toBeLessThan(small.seatRadius)
    expect(Math.abs(small.viewBox.width - large.viewBox.width)).toBeLessThan(0.4)
  })

  test("seats the roster in the arc order the client redraws", () => {
    // The contract convex/seating.ts depends on: it walks the roster in
    // political order through `positions` and stores each seat's (row, column),
    // then the component lays out the same count and matches on that pair. If
    // the two disagreed, MPs would move between page loads.
    const layout = layoutHemicycle(WP21_SEATS)
    const blocSizes = [67, 88, 122, 209, 152] // Linke, Grüne, SPD, CDU/CSU, AfD
    let offset = 0
    const centres: number[] = []
    for (const size of blocSizes) {
      const bloc = layout.positions.slice(offset, offset + size)
      centres.push(bloc.reduce((sum, seat) => sum + seat.x, 0) / size)
      offset += size
    }
    // Consecutive blocs march left to right across the chamber — the property
    // that makes them read as wedges rather than as bands.
    expect(centres).toEqual([...centres].sort((a, b) => a - b))
  })

  test("handles the empty and single-seat chambers", () => {
    const empty = layoutHemicycle(0)
    expect(empty.positions).toHaveLength(0)
    expect(empty.rows).toBe(0)
    // A zero-width viewBox makes the SVG vanish or throw; an empty chamber
    // should render as an empty frame.
    expect(empty.viewBox.width).toBeGreaterThan(0)
    expect(empty.viewBox.height).toBeGreaterThan(0)

    const one = layoutHemicycle(1)
    expect(one.positions).toHaveLength(1)
    // The only spot on the arc that is not an edge.
    expect(one.positions[0].angle).toBeCloseTo(Math.PI / 2, 6)
  })
})

describe("seatingLevel", () => {
  test("keeps 'not scored' apart from 'scored zero'", () => {
    // The distinction this function exists to preserve. An MP the nightly sweep
    // has not reached and an MP who did nothing are different claims; returning
    // 0 for the first would render them in the same shade and assert the
    // second. The map draws null in a neutral the legend names.
    expect(seatingLevel(null, 100)).toBeNull()
    expect(seatingLevel(undefined, 100)).toBeNull()
    expect(seatingLevel(0, 100)).toBe(0)
  })

  test("any activity is visibly above none", () => {
    // Same premise as heatmapLevel: one recorded action must not render
    // identically to zero, or the ramp stops distinguishing the thing it is for.
    expect(seatingLevel(1, 1000)).toBeGreaterThan(0)
    expect(seatingLevel(0.0001, 1000)).toBeGreaterThan(0)
  })

  test("the busiest MP sets the top of the ramp", () => {
    expect(seatingLevel(100, 100)).toBe(SEATING_LEVELS - 1)
    expect(seatingLevel(50, 100)).toBeLessThan(SEATING_LEVELS - 1)
  })

  test("stays inside the ramp for degenerate input", () => {
    // A NaN would index the colour array at `undefined` and render unstyled;
    // an out-of-range value would index past its end.
    expect(seatingLevel(Number.NaN, 100)).toBeNull()
    expect(seatingLevel(5, 0)).toBe(0)
    expect(seatingLevel(500, 100)).toBe(SEATING_LEVELS - 1)
    expect(seatingLevel(-5, 100)).toBe(0)
  })
})

describe("SEATING_MODES", () => {
  test("carries a caveat on exactly the modes whose colours could mislead", () => {
    // Coalition membership is in no Bundestag dataset; named ballots are the
    // exception rather than the rule (§4.4); committee data is current-period
    // only (§6.4). Party and activity read as what they are.
    const withCaveat = SEATING_MODES.filter((mode) => mode.caveatKey !== undefined).map((m) => m.id)
    expect(withCaveat.sort()).toEqual(["attendance", "coalition", "committee"])
  })

  test("every mode is selectable and declares a legend kind", () => {
    for (const mode of SEATING_MODES) {
      expect(isSeatingColorMode(mode.id)).toBe(true)
      expect(["categorical", "continuous"]).toContain(mode.scale)
    }
    expect(isSeatingColorMode("rainbow")).toBe(false)
    // A stale mode in a URL or in localStorage must not select nothing.
    expect(new Set(SEATING_MODES.map((m) => m.id)).size).toBe(SEATING_MODES.length)
  })
})

/**
 * The arc built from bloc sizes — the picture the home page and the narrative
 * chamber both draw.
 *
 * Same premise as the geometry above: every way this can be wrong still renders
 * a plausible hemicycle. A fold that does not happen splits one Fraktion into
 * two wedges at opposite ends of the chamber; an expansion that walks the groups
 * in the wrong order paints the blocs in the wrong places; a cap applied to the
 * radius but not to the box floats the arc inside a band of empty space. None of
 * them throws, and all three were live inside a component before this moved.
 */
describe("orderFractionSizes", () => {
  test("merges a group's spellings before placing it", () => {
    // Production holds both `Fraktionslos` (3) and `fraktionslos` (1) as
    // separate rows of `getFractionSizes` — the case that put two entries in
    // the home page's legend where /seating showed the merged 4.
    const ordered = orderFractionSizes([
      { fraktion: "Fraktionslos", count: 3 },
      { fraktion: "SPD", count: 122 },
      { fraktion: "fraktionslos", count: 1 },
    ])
    expect(ordered).toHaveLength(2)
    expect(
      ordered.find((entry) => seatingRank(entry.fraktion) === SEATING_ORDER.indexOf("spd"))?.count,
    ).toBe(122)
    expect(
      ordered.find((entry) => seatingRank(entry.fraktion) === SEATING_ORDER.indexOf("fraktionslos"))
        ?.count,
    ).toBe(4)
  })

  test("orders the blocs left to right rather than by size", () => {
    // The query returns largest-first; the arc needs political order. Sorting
    // by neither — or by size only — is a different claim about the chamber.
    const ordered = orderFractionSizes([
      { fraktion: "CDU/CSU", count: 209 },
      { fraktion: "Die Linke", count: 67 },
      { fraktion: "SPD", count: 122 },
    ])
    expect(ordered.map((entry) => entry.fraktion)).toEqual(["Die Linke", "SPD", "CDU/CSU"])
  })

  test("two unrecognised groups become one bloc rather than two", () => {
    // Both fold to `unknown`, which is `foldFractionSizes`' documented rule and
    // the reason the sort needs no tie-break: after the fold there is one entry
    // per `SEATING_ORDER` rank, so no two can compare equal. The merged entry
    // wears the first spelling seen, and `partyLabel` renders both as neutral.
    const ordered = orderFractionSizes([
      { fraktion: "Zukunftspartei", count: 2 },
      { fraktion: "Ampelrest", count: 5 },
    ])
    expect(ordered).toEqual([{ fraktion: "Zukunftspartei", count: 7 }])
  })

  test("no two blocs share a position on the arc", () => {
    // The invariant the missing tie-break rests on, stated rather than implied:
    // if the fold ever stopped being per-party, two entries would compare equal
    // and their order would depend on the query's — which is by size, and
    // therefore changes as MPs change group.
    const ranks = orderFractionSizes([
      { fraktion: "CDU/CSU", count: 209 },
      { fraktion: "AfD", count: 152 },
      { fraktion: "SPD", count: 122 },
      { fraktion: "BÜ90/GR", count: 85 },
      { fraktion: "Fraktion BÜNDNIS 90/DIE GRÜNEN", count: 3 },
      { fraktion: "Die Linke", count: 64 },
      { fraktion: "Fraktionslos", count: 3 },
      { fraktion: "fraktionslos", count: 1 },
    ]).map((entry) => seatingRank(entry.fraktion))
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})

describe("expandFractionSeats", () => {
  test("gives each bloc a contiguous run of seats", () => {
    // Contiguity is what makes the blocs read as wedges once these are paired
    // with `positions` — interleaving them would render a plausible chamber
    // that is speckled rather than divided.
    const fills = expandFractionSeats(
      orderFractionSizes([
        { fraktion: "SPD", count: 3 },
        { fraktion: "CDU/CSU", count: 2 },
      ]),
      700,
    )
    expect(fills).toEqual([
      partyColor("SPD"),
      partyColor("SPD"),
      partyColor("SPD"),
      partyColor("CDU/CSU"),
      partyColor("CDU/CSU"),
    ])
  })

  test("seats exactly the sum of the counts", () => {
    // The seat count is the one part of this diagram that is real data (§9), so
    // an off-by-one here misstates the Bundestag rather than merely looking odd.
    const sizes = [
      { fraktion: "CDU/CSU", count: 209 },
      { fraktion: "AfD", count: 152 },
      { fraktion: "SPD", count: 122 },
      { fraktion: "BÜNDNIS 90/DIE GRÜNEN", count: 85 },
      { fraktion: "Die Linke", count: 64 },
    ]
    expect(expandFractionSeats(orderFractionSizes(sizes), 700)).toHaveLength(632)
  })

  test("truncates at the cap rather than overrunning it", () => {
    const fills = expandFractionSeats([{ fraktion: "SPD", count: 5000 }], 700)
    expect(fills).toHaveLength(700)
  })

  test("a group past the cap contributes nothing rather than a negative run", () => {
    // `maxSeats - fills.length` goes negative once the cap is reached, which a
    // bare `Math.min` would turn into a `for` bound that skips — but the
    // `Math.max(0, …)` is what makes that true rather than incidental.
    const fills = expandFractionSeats(
      [
        { fraktion: "SPD", count: 12 },
        { fraktion: "CDU/CSU", count: 12 },
      ],
      10,
    )
    expect(fills).toHaveLength(10)
    expect(fills.every((fill) => fill === partyColor("SPD"))).toBe(true)
  })
})

describe("buildFractionArc", () => {
  test("still loading is null, not an empty chamber", () => {
    // `undefined` in, `null` out: an empty arc and a pending query look alike on
    // screen and mean opposite things.
    expect(buildFractionArc(undefined, 700)).toBeNull()
    expect(buildFractionArc([], 700)?.total).toBe(0)
  })

  test("pairs each seat with its bloc's colour, left to right", () => {
    // The property `layoutHemicycle` documents and this function relies on:
    // `positions` is sorted by angle, so index i of the arc is index i of the
    // bloc-ordered fills. Filling row by row instead produces radial bands.
    const arc = buildFractionArc(
      [
        { fraktion: "CDU/CSU", count: 40 },
        { fraktion: "Die Linke", count: 40 },
      ],
      700,
    )
    if (arc === null) throw new Error("arc should have been built")
    expect(arc.total).toBe(80)
    // Left-hand end of the arc is the Linke wedge, right-hand end CDU/CSU.
    expect(arc.seats[0].fill).toBe(partyColor("Die Linke"))
    expect(arc.seats.at(-1)?.fill).toBe(partyColor("CDU/CSU"))
    // And each is one unbroken run rather than a speckle.
    const changes = arc.seats.filter(
      (seat, index) => index > 0 && seat.fill !== arc.seats[index - 1].fill,
    )
    expect(changes).toHaveLength(1)
  })

  test("caps the dot size on a small fixture and leaves the real chamber alone", () => {
    const fixture = buildFractionArc([{ fraktion: "SPD", count: 12 }], 700)
    expect(fixture?.seatRadius).toBe(MAX_DECORATIVE_SEAT_RADIUS)

    // 630 seats sit an order of magnitude below the cap, so the real Bundestag
    // renders at the density `layoutHemicycle` computed.
    const chamber = buildFractionArc([{ fraktion: "SPD", count: 630 }], 700)
    expect(chamber?.seatRadius).toBe(layoutHemicycle(630).seatRadius)
    expect(chamber?.seatRadius).toBeLessThan(MAX_DECORATIVE_SEAT_RADIUS)
  })

  test("the box fits the dots it is drawn with", () => {
    // The failure this prevents is silent: a box sized for uncapped dots leaves
    // a band of empty space around a small-dotted arc and floats the picture.
    const arc = buildFractionArc([{ fraktion: "SPD", count: 12 }], 700)
    if (arc === null) throw new Error("arc should have been built")
    expect(arc.viewBox).toEqual(hemicycleViewBox(arc.seatRadius))
    for (const { position } of arc.seats) {
      expect(position.x - arc.seatRadius).toBeGreaterThanOrEqual(arc.viewBox.x - 1e-9)
      expect(position.x + arc.seatRadius).toBeLessThanOrEqual(
        arc.viewBox.x + arc.viewBox.width + 1e-9,
      )
      expect(position.y - arc.seatRadius).toBeGreaterThanOrEqual(arc.viewBox.y - 1e-9)
      expect(position.y + arc.seatRadius).toBeLessThanOrEqual(
        arc.viewBox.y + arc.viewBox.height + 1e-9,
      )
    }
  })

  test("returns the folded groups the legend keys on", () => {
    // Returned alongside the seats so a caller gets one answer to "which groups,
    // in what order" — folding a second time at the call site is how the legend
    // and the dots came to disagree in the first place.
    const arc = buildFractionArc(
      [
        { fraktion: "Fraktionslos", count: 3 },
        { fraktion: "fraktionslos", count: 1 },
      ],
      700,
    )
    expect(arc?.groups).toHaveLength(1)
    expect(arc?.groups[0].count).toBe(4)
    expect(arc?.total).toBe(4)
  })
})
