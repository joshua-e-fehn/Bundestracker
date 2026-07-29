import { describe, expect, test } from "bun:test"
import { dictionaries, LOCALES } from "./i18n"
import {
  buildArc,
  CHAPTERS,
  centreOutwardDistance,
  DATA_ANCHOR,
  MAX_ARC_SEATS,
  placeholderArc,
  REVEAL_FLOOR,
  revealThreshold,
  STATUTORY_SEATS,
} from "./protokoll"

/**
 * Tests for the narrative homepage's arc and its chapter table.
 *
 * Same premise as lib/seating.test.ts, which these sit beside: this is the part
 * that can be wrong without looking wrong. An arc whose seats are ordered by
 * index rather than by distance from the centre still animates smoothly — it
 * just sweeps the chamber left to right, which reads as the political spectrum
 * filling in from one end. A reveal curve that never reaches 1 leaves the last
 * seats permanently missing, and the picture is a plausible hemicycle either
 * way. Nothing here throws.
 */

/** WP21 as §6.2 reconciles it: 635 mandate rows, 630 sitting at once. */
const WP21 = [
  { fraktion: "CDU/CSU", count: 208 },
  { fraktion: "AfD", count: 152 },
  { fraktion: "SPD", count: 120 },
  { fraktion: "BÜNDNIS 90/DIE GRÜNEN", count: 85 },
  { fraktion: "Die Linke", count: 64 },
  { fraktion: "Fraktionslos", count: 1 },
]

describe("centreOutwardDistance", () => {
  test("the top of the arc is the centre", () => {
    // π/2 is the top in `layoutHemicycle`'s convention — the seat furthest from
    // both ends of the bench, and where the splash's stagger begins.
    expect(centreOutwardDistance(Math.PI / 2)).toBe(0)
  })

  test("both ends are equally far out", () => {
    // The whole reason this is derived from the angle rather than the list
    // index: index 0 and index n-1 are the two ends of the bench, and a stagger
    // over the index treats one as the start and the other as the finish.
    expect(centreOutwardDistance(Math.PI)).toBeCloseTo(1, 10)
    expect(centreOutwardDistance(0)).toBeCloseTo(1, 10)
  })

  test("stays within 0…1 for any angle on the arc", () => {
    for (let step = 0; step <= 100; step++) {
      const distance = centreOutwardDistance((Math.PI * step) / 100)
      expect(distance).toBeGreaterThanOrEqual(0)
      expect(distance).toBeLessThanOrEqual(1)
    }
  })
})

describe("buildArc", () => {
  test("null while the query is in flight, so loading is not an empty chamber", () => {
    expect(buildArc(undefined)).toBeNull()
  })

  test("an empty roster is a real answer, not a missing one", () => {
    const arc = buildArc([])
    expect(arc).not.toBeNull()
    expect(arc?.total).toBe(0)
    expect(arc?.seats).toEqual([])
  })

  test("draws one dot per seat", () => {
    const arc = buildArc(WP21)
    expect(arc?.total).toBe(630)
    expect(arc?.seats).toHaveLength(630)
  })

  test("orders the blocs left to right along the political spectrum", () => {
    const arc = buildArc(WP21)
    expect(arc?.groups.map((group) => group.fraktion)).toEqual([
      "Die Linke",
      "BÜNDNIS 90/DIE GRÜNEN",
      "SPD",
      "CDU/CSU",
      "AfD",
      "Fraktionslos",
    ])
  })

  test("each group's seats are one contiguous wedge", () => {
    // The property that makes the blocs read as wedges rather than as radial
    // bands: `layoutHemicycle` returns positions sorted by angle, so the
    // bloc-ordered fills land on contiguous spans of the arc. Filling row by
    // row instead would give the largest group the inner rows entirely.
    const arc = buildArc(WP21)
    const fills = arc?.seats.map((seat) => seat.fill) ?? []
    const runs = fills.filter((fill, index) => fill !== fills[index - 1])
    expect(runs).toHaveLength(new Set(fills).size)
  })

  test("merges Fraktion spellings rather than drawing a group twice", () => {
    // Production holds both `Fraktionslos` (3) and `fraktionslos` (1) — the
    // exact split that put two grey entries in the home page's legend before
    // `foldFractionSizes` existed. See lib/parties.ts.
    const arc = buildArc([
      { fraktion: "Fraktionslos", count: 3 },
      { fraktion: "fraktionslos", count: 1 },
    ])
    expect(arc?.groups).toHaveLength(1)
    expect(arc?.groups[0].count).toBe(4)
    expect(arc?.total).toBe(4)
  })

  test("caps a pathological roster rather than drawing it", () => {
    const arc = buildArc([{ fraktion: "SPD", count: 5_000 }])
    expect(arc?.total).toBe(MAX_ARC_SEATS)
    expect(arc?.seats).toHaveLength(MAX_ARC_SEATS)
  })

  test("keeps the dots visible at fixture sizes", () => {
    // The cap components/seating-preview.tsx applies for the reason its comment
    // gives: the derived radius is right at 630 seats and renders a 12-seat
    // development fixture as a dozen balloons.
    const small = buildArc([{ fraktion: "SPD", count: 12 }])
    expect(small?.seatRadius).toBeLessThanOrEqual(0.08)
    const full = buildArc(WP21)
    // …and does not bite on a real chamber, which is the point of the cap
    // rather than of a smaller constant.
    expect(full?.seatRadius).toBeLessThan(0.08)
    expect(full?.seatRadius).toBeGreaterThan(0)
  })

  test("the viewBox contains every dot it draws", () => {
    // A box sized from the *uncapped* radius is the bug this guards: it leaves
    // a band of empty space around a small-dotted arc, and the picture floats
    // inside its frame instead of filling it.
    //
    // The tolerance is not slack. The arc's two end seats sit exactly on the
    // box's bottom edge by construction — `height` is `extent + seatRadius` and
    // their `y` is 0 — so the comparison is an equality between two floats
    // reached by different arithmetic, and it lands one ulp out. A whole seat
    // outside the box is 0.019 here, three orders of magnitude above this.
    const epsilon = 1e-9
    const arc = buildArc(WP21)
    if (!arc) throw new Error("expected an arc")
    const { x, y, width, height } = arc.viewBox
    for (const seat of arc.seats) {
      expect(seat.position.x - arc.seatRadius).toBeGreaterThanOrEqual(x - epsilon)
      expect(seat.position.x + arc.seatRadius).toBeLessThanOrEqual(x + width + epsilon)
      expect(seat.position.y - arc.seatRadius).toBeGreaterThanOrEqual(y - epsilon)
      expect(seat.position.y + arc.seatRadius).toBeLessThanOrEqual(y + height + epsilon)
    }
  })
})

describe("placeholderArc", () => {
  test("assembles the statutory chamber before any query resolves", () => {
    const arc = placeholderArc(STATUTORY_SEATS)
    expect(arc.total).toBe(STATUTORY_SEATS)
    expect(arc.seats).toHaveLength(STATUTORY_SEATS)
  })

  test("carries no party colours", () => {
    // A placeholder chamber painted in party colours would be a picture of a
    // Bundestag that does not exist, shown on the page whose premise is that
    // every figure is backed by a record.
    const fills = new Set(placeholderArc(STATUTORY_SEATS).seats.map((seat) => seat.fill))
    expect(fills).toEqual(new Set(["var(--muted-foreground)"]))
    expect(placeholderArc(STATUTORY_SEATS).groups).toEqual([])
  })

  test("matches the real arc's geometry seat for seat", () => {
    // The splash's arc contracts into the mark and the reader lands on Chapter
    // 1's. They are the same picture, so they must be the same numbers — a
    // divergence here is a jump at the handover.
    const placeholder = placeholderArc(630)
    const real = buildArc(WP21)
    if (!real) throw new Error("expected an arc")
    expect(placeholder.seatRadius).toBe(real.seatRadius)
    expect(placeholder.viewBox).toEqual(real.viewBox)
    expect(placeholder.seats.map((seat) => seat.position)).toEqual(
      real.seats.map((seat) => seat.position),
    )
  })
})

describe("revealThreshold", () => {
  test("never opens on an empty chamber", () => {
    // The regression this file exists to hold: the chapter is introduced *by*
    // the hemicycle, so there is no scroll position — including the one the
    // server renders at — where the frame is on screen without one. An empty
    // arc under a six-colour legend reads as a visualisation that failed to
    // load, not as one that is about to fill.
    expect(revealThreshold(0)).toBe(REVEAL_FLOOR)
    expect(revealThreshold(0.05)).toBeGreaterThanOrEqual(REVEAL_FLOOR)
  })

  test("the floor is a substantial chamber, not a token few seats", () => {
    // A handful of dots is the "isolated dots" half of the same report. The
    // floor has to be enough of the bank that the shape is unmistakable.
    const arc = buildArc(WP21)
    if (!arc) throw new Error("expected an arc")
    const drawn = arc.seats.filter((seat) => seat.distance <= revealThreshold(0)).length
    expect(drawn).toBeGreaterThan(arc.total * 0.25)
    // …and still visibly unfinished, or there is nothing left to scroll for.
    expect(drawn).toBeLessThan(arc.total * 0.75)
  })

  test("reaches a full chamber before the pin releases", () => {
    // The failure this catches: a curve that only reaches 1 at progress 1 leaves
    // the outermost seats arriving as the section leaves the screen, so the
    // finished picture is never actually seen. It completes at 70 %, leaving
    // the last 30 % of the travel as a pause on the finished chamber.
    expect(revealThreshold(0.7)).toBe(1)
    expect(revealThreshold(1)).toBe(1)
  })

  test("completes with enough travel left to rest on the result", () => {
    // The other half of "excessive dead scroll": if the fill ran to ~1 the
    // reader would arrive at the finished chamber exactly as it left. Guards
    // the pause without pinning the exact constant.
    expect(revealThreshold(0.85)).toBe(1)
    expect(revealThreshold(0.6)).toBeLessThan(1)
  })

  test("clamps rather than extrapolating past the pin", () => {
    // `useScroll` can report slightly outside 0…1 at the ends of a range, and an
    // unclamped threshold would draw a *smaller* chamber than the floor at
    // -0.01 — a visible backwards step at the top of the chapter.
    expect(revealThreshold(-0.5)).toBe(REVEAL_FLOOR)
    expect(revealThreshold(1.5)).toBe(1)
  })

  test("never goes backwards", () => {
    let previous = -1
    for (let step = 0; step <= 200; step++) {
      const value = revealThreshold(step / 200)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe("CHAPTERS", () => {
  test("five chapters, numbered in order", () => {
    expect(CHAPTERS.map((chapter) => chapter.index)).toEqual([1, 2, 3, 4, 5])
  })

  test("anchors are unique — two chapters sharing one is a link to the wrong place", () => {
    expect(new Set(CHAPTERS.map((chapter) => chapter.anchor)).size).toBe(CHAPTERS.length)
  })

  test("every chapter's strings exist in every locale", () => {
    // The typecheck already enforces that `en` is a complete `Dictionary`; what
    // it cannot see is a `TranslationKey` in this table that no dictionary
    // defines, since `t` falls back rather than failing.
    for (const locale of LOCALES) {
      for (const chapter of CHAPTERS) {
        for (const key of [chapter.numberKey, chapter.titleKey, chapter.standfirstKey]) {
          expect(dictionaries[locale][key], `${locale}.${key}`).toBeTruthy()
        }
      }
    }
  })

  test("the skip link targets a chapter that exists, and one carrying data", () => {
    // Chapter 1 is a picture; a "straight to the data" link that lands on it
    // has skipped nothing. This is the affordance §7 calls the requirement
    // "most likely to be quietly lost".
    const target = CHAPTERS.find((chapter) => chapter.anchor === DATA_ANCHOR)
    expect(target).toBeDefined()
    expect(target?.index).toBeGreaterThan(1)
  })
})
