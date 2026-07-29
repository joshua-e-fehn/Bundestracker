import { describe, expect, test } from "bun:test"
import { dictionaries, LOCALES } from "./i18n"
import {
  CURRENT_WAHLPERIODE,
  EARLIEST_TRACKED_WAHLPERIODE,
  isCurrentPeriod,
  PERIOD_PARAM,
  type PeriodSource,
  parsePeriodParam,
  periodHref,
  periodIngested,
  periodLink,
  resolvePeriod,
  SOURCE_NOTE_KEYS,
  sourceCoverage,
  sourceNoteKey,
  sourceUnavailable,
} from "./period"

/**
 * The period module's tests.
 *
 * Two classes of thing are asserted here and they fail differently:
 *
 *  - **The URL contract.** Parsing and building `?wp=`. A defect here is a link
 *    that goes to the wrong Bundestag — which *works*, renders, and is wrong,
 *    so nothing but a test catches it.
 *  - **The coverage boundaries.** Which sources reach which period. A defect
 *    here is a page that presents "never published" as a measured zero, which
 *    is the single failure `docs/historical-coverage.md` was written to prevent
 *    and the one this whole branch is about.
 *
 * The boundary numbers are asserted against the periods either side of each
 * one, not against a restatement of the constant — a test that reads the same
 * constant the code does would pass if both were wrong together.
 */

describe("parsePeriodParam", () => {
  test("reads a period from a digit string", () => {
    expect(parsePeriodParam("21")).toBe(21)
    expect(parsePeriodParam("19")).toBe(19)
    expect(parsePeriodParam(" 20 ")).toBe(20)
  })

  test("an absent parameter is null, not the current period", () => {
    // The distinction the whole href builder rests on: "asked for nothing" and
    // "asked for the current period" render the same page and produce different
    // links. Collapsing them here would write `?wp=21` into every URL.
    expect(parsePeriodParam(null)).toBeNull()
    expect(parsePeriodParam(undefined)).toBeNull()
    expect(parsePeriodParam("")).toBeNull()
    expect(parsePeriodParam("   ")).toBeNull()
  })

  test("rejects everything `Number()` would have accepted", () => {
    // The old `/search` implementation was `Number(params.get("wp"))` guarded by
    // `> 0`, which let all of these through. `21.5` and `1e2` are not
    // Wahlperioden and `0x15` is 21 spelled as a trap.
    expect(parsePeriodParam("21.5")).toBeNull()
    expect(parsePeriodParam("1e2")).toBeNull()
    expect(parsePeriodParam("0x15")).toBeNull()
    expect(parsePeriodParam("-19")).toBeNull()
    expect(parsePeriodParam("wp21")).toBeNull()
    expect(parsePeriodParam("Infinity")).toBeNull()
  })

  test("rejects periods outside the tracked range", () => {
    // Below the range: nothing under WP14 has ever been fetched, so `?wp=3` is a
    // typo rather than a request, and answering it with an empty page would look
    // like a Bundestag that did nothing.
    expect(parsePeriodParam(String(EARLIEST_TRACKED_WAHLPERIODE - 1))).toBeNull()
    expect(parsePeriodParam("0")).toBeNull()
    expect(parsePeriodParam(String(EARLIEST_TRACKED_WAHLPERIODE))).toBe(
      EARLIEST_TRACKED_WAHLPERIODE,
    )
  })

  test("accepts a period above the current one", () => {
    // Deliberately *not* capped at `CURRENT_WAHLPERIODE`. The roster decides
    // what is current; a ceiling here would reject WP22 on the day it is
    // ingested, which is a failure that arrives on the busiest possible day.
    expect(parsePeriodParam(String(CURRENT_WAHLPERIODE + 1))).toBe(CURRENT_WAHLPERIODE + 1)
  })

  test("rejects a three-digit value", () => {
    expect(parsePeriodParam("100")).toBeNull()
    expect(parsePeriodParam("999")).toBeNull()
  })
})

describe("resolvePeriod", () => {
  test("the URL wins, even before the current period resolves", () => {
    // What lets `/mps?wp=19` render WP19 on the first paint rather than
    // flashing WP21 and switching — which on the profile page would also be a
    // wrong fetch, not merely a visible jump.
    expect(resolvePeriod(19, undefined)).toBe(19)
    expect(resolvePeriod(19, 21)).toBe(19)
    expect(resolvePeriod(19, null)).toBe(19)
  })

  test("without a URL period it defers to the roster", () => {
    expect(resolvePeriod(null, 21)).toBe(21)
    expect(resolvePeriod(null, undefined)).toBeUndefined()
    expect(resolvePeriod(null, null)).toBeNull()
  })
})

describe("periodHref", () => {
  test("the current period writes no parameter", () => {
    // The rule that keeps `?wp=21` out of every URL on the site. A pinned 21
    // names the previous chamber for months after WP22 is sworn in.
    expect(periodHref("/rankings", 21, { current: 21 })).toBe("/rankings")
  })

  test("a historical period writes one", () => {
    expect(periodHref("/rankings", 19, { current: 21 })).toBe("/rankings?wp=19")
  })

  test("an unknown current period writes the parameter", () => {
    // The safe direction: an explicit period is never wrong, only verbose,
    // where omitting it on a historical page sends the reader to the current
    // one.
    expect(periodHref("/rankings", 19, { current: null })).toBe("/rankings?wp=19")
    expect(periodHref("/rankings", 21)).toBe("/rankings?wp=21")
  })

  test("other parameters survive a period change", () => {
    // The acceptance criterion, in one assertion: a reader who has filtered a
    // search and switches period keeps their query.
    const params = new URLSearchParams({ q: "klima", fraktion: "SPD" })
    const href = periodHref("/search", 19, { current: 21, params })
    const result = new URL(href, "https://example.invalid")
    expect(result.searchParams.get("q")).toBe("klima")
    expect(result.searchParams.get("fraktion")).toBe("SPD")
    expect(result.searchParams.get(PERIOD_PARAM)).toBe("19")
  })

  test("an existing period parameter is replaced, not appended", () => {
    // Appending would produce `?wp=21&wp=19`, whose meaning depends on which
    // reader parses it — `URLSearchParams.get` takes the first, so the page
    // would keep showing the period the reader just left.
    const params = new URLSearchParams({ wp: "21", q: "klima" })
    const href = periodHref("/search", 19, { current: null, params })
    const result = new URL(href, "https://example.invalid")
    expect(result.searchParams.getAll(PERIOD_PARAM)).toEqual(["19"])
    expect(result.searchParams.get("q")).toBe("klima")
  })

  test("switching back to the current period drops the parameter and keeps the rest", () => {
    const params = new URLSearchParams({ wp: "19", q: "klima" })
    const href = periodHref("/search", 21, { current: 21, params })
    const result = new URL(href, "https://example.invalid")
    expect(result.searchParams.has(PERIOD_PARAM)).toBe(false)
    expect(result.searchParams.get("q")).toBe("klima")
  })

  test("a bare path stays bare when there is nothing to write", () => {
    // No trailing "?" — a URL that differs from the one the reader is on only
    // by punctuation is still a navigation, and it would show up in history.
    expect(periodHref("/mps", 21, { current: 21 })).toBe("/mps")
  })
})

describe("periodLink", () => {
  test("carries a historical period to another page", () => {
    // The failure this exists for: a name on the WP19 rankings opening a WP21
    // profile — or a 404, for someone who left in WP20.
    expect(periodLink("/mps/bt-0001", 19, 21)).toBe("/mps/bt-0001?wp=19")
  })

  test("the current period links bare", () => {
    expect(periodLink("/mps/bt-0001", 21, 21)).toBe("/mps/bt-0001")
  })

  test("no period at all links bare", () => {
    // The default outside a `PeriodProvider` — `/` and `/dashboard` are always
    // the sitting Bundestag and their links should not grow a parameter naming
    // the period they were already going to get.
    expect(periodLink("/mps/bt-0001", null, 21)).toBe("/mps/bt-0001")
    expect(periodLink("/mps/bt-0001", undefined, 21)).toBe("/mps/bt-0001")
  })

  test("drops the source page's own parameters", () => {
    // Unlike `periodHref`, which rewrites the period of the page you are on.
    // A Fraktion filter on the rankings means nothing on a profile, and
    // carrying it there is how one ends up in a URL somebody shares.
    expect(periodLink("/mps/bt-0001", 19, 21)).not.toContain("fraktion")
  })
})

describe("isCurrentPeriod", () => {
  test("an unknown current period reads as current", () => {
    // So a page never flashes "this is a past Bundestag" over the present one
    // for the duration of a round-trip.
    expect(isCurrentPeriod(21, undefined)).toBe(true)
    expect(isCurrentPeriod(19, undefined)).toBe(true)
    expect(isCurrentPeriod(21, null)).toBe(true)
  })

  test("distinguishes the sitting period from a closed one", () => {
    expect(isCurrentPeriod(21, 21)).toBe(true)
    expect(isCurrentPeriod(19, 21)).toBe(false)
    expect(isCurrentPeriod(20, 21)).toBe(false)
  })

  test("a period newer than the roster's is current", () => {
    // The deploy window: a frontend that knows about WP22 pointed at a backend
    // that has not ingested it should not call WP22 historical.
    expect(isCurrentPeriod(22, 21)).toBe(true)
  })
})

describe("sourceCoverage — the boundaries from docs/historical-coverage.md", () => {
  test("committees exist for the sitting period alone", () => {
    // §6.3/§6.4: Stammdaten is the only machine-readable committee source in
    // existence and publishes the current Bundestag only. Every closed period
    // has zero committee rows, permanently.
    expect(sourceCoverage("committees", 21, 21)).toBe("full")
    expect(sourceCoverage("committees", 20, 21)).toBe("none")
    expect(sourceCoverage("committees", 19, 21)).toBe("none")
  })

  test("committees follow the roster's current period, not the number 21", () => {
    // The reason `currentWahlperiode` is a parameter. Hardcoding 21 would mark
    // WP21 as "committees not published" the day WP22 lands — silently, and on
    // the one period that does publish them.
    expect(sourceCoverage("committees", 22, 22)).toBe("full")
    expect(sourceCoverage("committees", 21, 22)).toBe("none")
  })

  test("speeches begin at WP18", () => {
    // Measured: `xml_url` on 100/100 records for WP18–19 and 0/100 for WP16–17.
    expect(sourceCoverage("speeches", 18, 21)).toBe("full")
    expect(sourceCoverage("speeches", 17, 21)).toBe("none")
    expect(sourceCoverage("speeches", 14, 21)).toBe("none")
  })

  test("votes are partial in WP19 and absent before it", () => {
    // The boundary that moved. §4.1 estimated "roughly WP17" by bisection; the
    // measured first sheet is 2019-09-26, part-way through WP19 — wrong by
    // about seven years, and it bites hardest because participation is a
    // *scored* component.
    expect(sourceCoverage("votes", 20, 21)).toBe("full")
    expect(sourceCoverage("votes", 19, 21)).toBe("partial")
    expect(sourceCoverage("votes", 18, 21)).toBe("none")
    expect(sourceCoverage("votes", 14, 21)).toBe("none")
  })

  test("seating is constructed in every period, including the current one", () => {
    // §9: no machine-readable seating plan exists anywhere. So a historical arc
    // is not *more* invented than today's, and the UI says so rather than
    // letting a reader infer the opposite.
    expect(sourceCoverage("seating", 21, 21)).toBe("synthetic")
    expect(sourceCoverage("seating", 19, 21)).toBe("synthetic")
  })

  test("portraits thin out for a closed period rather than vanishing", () => {
    // The bundestag.de listing serves sitting members, but WP19 still resolved
    // 635 credited portraits — so this is `partial`, never `none`.
    expect(sourceCoverage("portraits", 21, 21)).toBe("full")
    expect(sourceCoverage("portraits", 19, 21)).toBe("partial")
  })

  test("an unresolved current period never claims a source is missing", () => {
    // A loading state must not render as a claim about the Bundestag.
    expect(sourceCoverage("committees", 19, undefined)).toBe("full")
    expect(sourceCoverage("portraits", 19, undefined)).toBe("full")
  })
})

describe("sourceUnavailable", () => {
  test("is true only for a permanently absent source", () => {
    expect(sourceUnavailable("committees", 19, 21)).toBe(true)
    expect(sourceUnavailable("votes", 18, 21)).toBe(true)
    // Partial is not unavailable: WP19 has ballots, from 2019-09 onwards.
    expect(sourceUnavailable("votes", 19, 21)).toBe(false)
    expect(sourceUnavailable("seating", 19, 21)).toBe(false)
  })
})

describe("sourceNoteKey", () => {
  const SOURCES: PeriodSource[] = ["committees", "speeches", "votes", "portraits", "seating"]

  test("a full source needs no note", () => {
    // A note that rendered unconditionally is one readers learn to skip, which
    // costs exactly the cases it exists for.
    for (const source of SOURCES) {
      if (source === "seating") continue // synthetic in every period; see below
      expect(sourceNoteKey(source, 21, 21)).toBeNull()
    }
  })

  test("names the right note for each absent source", () => {
    expect(sourceNoteKey("committees", 19, 21)).toBe("period.source.committees.none")
    expect(sourceNoteKey("speeches", 17, 21)).toBe("period.source.speeches.none")
    expect(sourceNoteKey("votes", 18, 21)).toBe("period.source.votes.none")
  })

  test("distinguishes partial from absent", () => {
    // WP19's ballots exist and are incomplete, which is a different sentence
    // from WP18's, where none exist at all.
    expect(sourceNoteKey("votes", 19, 21)).toBe("period.source.votes.partial")
    expect(sourceNoteKey("votes", 18, 21)).toBe("period.source.votes.none")
  })

  test("every note key it can return is in both dictionaries", () => {
    // The parity `lib/i18n.test.ts` asserts over the whole dictionary, narrowed
    // to the keys this module names *indirectly* — they are reached through a
    // lookup table rather than a literal `t("…")` call, so the typecheck that
    // catches a missing key at a call site does not see them.
    // `flatMap` over the literal-typed table yields a union of the key literals
    // and `null`; the filter drops the nulls, and the annotation is what tells
    // TypeScript the result is a `string[]` rather than that narrower union —
    // which `Object.hasOwn` cannot take as a `PropertyKey` while `null` is
    // still in it.
    const keys: string[] = Object.values(SOURCE_NOTE_KEYS)
      .flatMap((entry) => Object.values(entry))
      .filter((key) => key !== null)
    expect(keys.length).toBeGreaterThan(0)
    for (const locale of LOCALES) {
      for (const key of keys) {
        // `Object.hasOwn`, not `toHaveProperty`: the dictionary is a *flat* map
        // whose keys contain literal dots (see the note on `de` in lib/i18n.ts),
        // and `toHaveProperty("period.source.votes.none")` reads that as a path
        // through four nested objects — so it fails on every key here for a
        // reason that has nothing to do with the translation being present.
        expect(Object.hasOwn(dictionaries[locale], key), `${locale} is missing ${key}`).toBe(true)
      }
    }
  })
})

describe("periodIngested", () => {
  const options = {
    periods: [
      { wahlperiode: 21, mandates: 635, scored: true },
      { wahlperiode: 20, mandates: 772, scored: true },
      { wahlperiode: 19, mandates: 750, scored: false },
    ],
    current: 21,
  }

  test("separates not-backfilled from not-found", () => {
    // The distinction the acceptance criteria ask for. `?wp=18` on this
    // deployment is a valid address for a Bundestag that sat; the fix is a
    // pipeline run, not a corrected link, so it must not render as a 404.
    expect(periodIngested(21, options)).toBe(true)
    expect(periodIngested(19, options)).toBe(true)
    expect(periodIngested(18, options)).toBe(false)
    expect(periodIngested(14, options)).toBe(false)
  })

  test("is undefined until the list resolves", () => {
    // So the "not backfilled" message cannot appear before there is a list to
    // check against — which would show it briefly on every period-scoped page.
    expect(periodIngested(19, undefined)).toBeUndefined()
  })

  test("an ingested period can still be unscored", () => {
    // Two independent facts, and the normal state of a fresh backfill: the
    // nightly sweep recomputes the current calendar month, so a closed period
    // stays unscored until `scores --wp N --all-months` runs.
    expect(periodIngested(19, options)).toBe(true)
    expect(options.periods.find((entry) => entry.wahlperiode === 19)?.scored).toBe(false)
  })
})
