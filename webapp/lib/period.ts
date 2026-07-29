/**
 * Which Bundestag a page is about — parsed from the URL, carried between pages,
 * and honest about what its sources can answer.
 *
 * Every public query in `convex/` takes a required `wahlperiode`, so the only
 * real question the frontend has ever had is *where that number comes from*.
 * Until now there were two answers and they disagreed:
 *
 *  - `CurrentPeriod` (now components/period-scope.tsx) resolved it from the
 *    data — the newest period on the roster — and offered no way to change it.
 *  - `/search` read `?wp=` and fell back to the `CURRENT_WAHLPERIODE = 21`
 *    constant, which is the only control on the site that ever selected a
 *    historical period.
 *
 * Two answers is one too many, and the cost was measured rather than theorised:
 * WP19 and WP20 are fully ingested and, apart from `/search`, unreachable
 * (`docs/historical-coverage.md`, "What the UI does with a backfilled period —
 * today, nothing"). A profile of an MP who sat only in WP19 404s, because
 * `app/mps/[id]/page.tsx` passed the constant.
 *
 * This module is the one answer. `/search`'s `?wp=` is promoted from a local
 * convention to *the* URL contract, because it already existed, is already
 * shareable, and inventing a second spelling (`/wp/19/mps`, `?period=`) would
 * be the exact failure AGENTS.md names — a second way to do something that
 * already has one.
 *
 * ## The contract
 *
 *  - **Absent `?wp=` means the current period.** `/rankings` is this Bundestag,
 *    not `/rankings?wp=21` — the reason `newestWahlperiode` derives the period
 *    from the roster rather than taking a constant, and it still holds. So the
 *    parameter is *omitted* rather than written when the reader is on the
 *    current period — see `periodHref`. A URL that pinned 21 today would name a
 *    chamber that no longer sits the day WP22 is sworn in, silently and
 *    plausibly.
 *  - **A present `?wp=` is a claim about the period, not a filter.** It scopes
 *    the whole page: the roster, the scores, the feed, the links out of it.
 *  - **Every other parameter survives a period change.** `periodHref` rewrites
 *    one key and keeps the rest, the same rule components/search-page.tsx
 *    already applies to its own filters.
 *
 * ## Why the coverage table lives here and not in a component
 *
 * `docs/historical-coverage.md` records which sources reach which periods, and
 * the distinction it opens with is the one this module exists to keep: *a
 * period with no committee rows is not a parliament whose members sat on no
 * committees.* That fact has to reach five different surfaces — the profile's
 * committee card, the score panel, the seating page, the search filters, the
 * rankings caveats — and a copy per surface is how one of them comes to say
 * "no committees" while the others say "not published".
 *
 * The boundaries are properties of what the Bundestag publishes, so they are
 * constants, not data. They are also *permanent*: no future backfill moves
 * them, which is what separates them from `PeriodAvailability` below.
 */

/**
 * The Wahlperiode the site shows when the URL names none.
 *
 * ⚠ A **fallback**, not the answer. The answer is `mps.getCurrentWahlperiode`,
 * derived from the roster, for the reason `newestWahlperiode` gives: a
 * hardcoded 21 keeps serving the previous Bundestag for months after the next
 * is sworn in, without erroring.
 *
 * This constant survives for the two callers that cannot await a query — the
 * server-side `generateMetadata` of `/mps` and `/mps/[id]`, where a round-trip
 * to Convex would block the document head on an uncached read. Both render text
 * that is already approximate (a German tab title for a bilingual page), and
 * both are corrected by the page body underneath them.
 *
 * Mirrors `CURRENT_ELECTORAL_PERIOD` in pipeline/src/bundestrack/cli.py:32.
 * Re-exported from lib/bundestag.ts, where it used to live, so the two are one
 * declaration rather than two that drift.
 */
export const CURRENT_WAHLPERIODE = 21

/** The URL parameter that carries a period. `/search` minted it; every route
 * now reads the same key, so one spelling is shareable across the site. */
export const PERIOD_PARAM = "wp"

/**
 * The oldest period Bundestrack tracks.
 *
 * `docs/historical-coverage.md` scopes the backfill to WP14–21 — DIP itself
 * reaches further back, but nothing below 14 has ever been fetched, so a URL
 * naming WP3 is a typo rather than a request. Bounding the parse is what keeps
 * `?wp=0` and `?wp=9999` from becoming a query for a Bundestag that has no
 * rows, which renders as an empty page rather than as a bad URL.
 */
export const EARLIEST_TRACKED_WAHLPERIODE = 14

/**
 * The upper bound on a parseable period.
 *
 * Deliberately above `CURRENT_WAHLPERIODE` rather than equal to it: the roster
 * decides what is current (`newestWahlperiode`), and this must not become a
 * second gate that rejects WP22 on the day it is ingested. It is a sanity
 * ceiling on user input, not a statement about what exists.
 */
const LATEST_PARSEABLE_WAHLPERIODE = 99

/**
 * A period read off a URL, or null when the URL names none.
 *
 * Null rather than `CURRENT_WAHLPERIODE` because the two are genuinely
 * different states and the callers need to tell them apart: "the reader asked
 * for the current period" and "the reader asked for nothing" produce the same
 * page but different *links*, and conflating them is what would write `?wp=21`
 * into every href on the site.
 *
 * Rejects anything that is not a whole number inside the tracked range —
 * including `21.5`, `1e2` and `0x15`, all of which `Number()` accepts and none
 * of which names a Bundestag. An unparseable value is treated as absent rather
 * than as an error: a mistyped URL should show the current period, not a 404,
 * because the page it names does exist and the reader is one keystroke from it.
 */
export function parsePeriodParam(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  // `Number()` alone accepts "", " ", "0x15" and "1e2". The pattern is what
  // makes this a *digit string* test rather than a numeric-coercion one.
  if (!/^\d{1,2}$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (parsed < EARLIEST_TRACKED_WAHLPERIODE) return null
  if (parsed > LATEST_PARSEABLE_WAHLPERIODE) return null
  return parsed
}

/**
 * The period a page should render, given what the URL asked for and what the
 * roster says is current.
 *
 * `undefined` while the current period is still resolving — the caller renders
 * a skeleton — and `null` when the roster is empty *and* the URL named nothing,
 * which is a fresh deployment rather than an error.
 *
 * A URL-named period wins even before the current one resolves. That is what
 * lets `/mps?wp=19` render WP19 on its first paint instead of flashing WP21 and
 * then switching, which would be both a visible jump and, on the profile page,
 * a wrong fetch.
 */
export function resolvePeriod(
  requested: number | null,
  current: number | null | undefined,
): number | null | undefined {
  if (requested !== null) return requested
  return current
}

/**
 * A URL for `pathname` at `wahlperiode`, preserving every other parameter.
 *
 * The two rules this encodes, both of them load-bearing:
 *
 *  - **The current period writes no parameter.** Otherwise every link on the
 *    site would carry `?wp=21` and the URLs readers share would pin a chamber
 *    that stops being current at the next election. Passing `current` is how
 *    this function knows which value is the omittable one; passing `null`
 *    (unknown) writes the parameter, which is the safe direction — an explicit
 *    period is never *wrong*, only more verbose.
 *  - **Other parameters survive.** A reader who has filtered `/search?q=klima`
 *    and switches period keeps their query; one on `/rankings` keeps whatever
 *    the page has put in the URL. Rewriting one key rather than rebuilding the
 *    string is the same rule components/search-page.tsx applies to its filters.
 *
 * Takes an iterable of pairs rather than a `URLSearchParams` so a server
 * component's `searchParams` object and a client's `useSearchParams()` can both
 * feed it without either side converting first.
 */
export function periodHref(
  pathname: string,
  wahlperiode: number,
  options?: {
    /** The period that needs no parameter. Omit or pass null to always write one. */
    current?: number | null
    /** Existing parameters to carry over. `wp` in here is replaced, not appended. */
    params?: URLSearchParams | Iterable<[string, string]> | null
  },
): string {
  const next = new URLSearchParams()
  if (options?.params) {
    for (const [key, value] of options.params) {
      if (key === PERIOD_PARAM) continue
      next.append(key, value)
    }
  }
  if (wahlperiode !== options?.current) next.set(PERIOD_PARAM, String(wahlperiode))
  const query = next.toString()
  return query ? `${pathname}?${query}` : pathname
}

/**
 * The same, for a link *out* of a page that is already scoped to a period —
 * an MP row on `/rankings?wp=19` pointing at that MP's WP19 profile.
 *
 * The distinct name is the point. `periodHref` rewrites the period of the page
 * you are on; this carries the page's period to somewhere else, and drops every
 * other parameter because a filter on the source page means nothing on the
 * destination. Two call sites that look alike and differ in exactly that way is
 * how a Fraktion filter ends up in a profile URL.
 *
 * This is what stops period context dropping between list and profile — the
 * failure mode `docs/historical-coverage.md` records as a 404 on a WP19 MP.
 */
export function periodLink(
  pathname: string,
  wahlperiode: number | null | undefined,
  current?: number | null,
): string {
  if (wahlperiode === null || wahlperiode === undefined) return pathname
  return periodHref(pathname, wahlperiode, { current })
}

// --- what each period's sources can answer --------------------------------

/**
 * A source whose reach ends part-way through the periods Bundestrack tracks.
 *
 * Named rather than positional so a caller asks `coverage.committees` instead
 * of indexing a tuple, and so a new boundary is a compile error at every
 * consumer rather than a silently-missing case.
 */
export type PeriodSource = "committees" | "speeches" | "votes" | "portraits" | "seating"

/**
 * How well a source covers a period.
 *
 *  - `full` — the source publishes this period completely.
 *  - `partial` — it publishes some of it, and the gap is structural. WP19's
 *    votes are the case: the sheets begin 2019-09-26, mid-period.
 *  - `none` — it publishes nothing for this period, permanently. Not "not
 *    fetched yet": no backfill will change it.
 *  - `synthetic` — the rows exist but are *generated*, not sourced. Seating is
 *    the only one; §9 of docs/api-research.md records that no machine-readable
 *    seating plan exists for any period, including the current one.
 *
 * The distinction between `none` and an empty table is the whole reason this
 * type exists. They are identical in the database and opposite to a reader.
 */
export type SourceCoverage = "full" | "partial" | "none" | "synthetic"

/**
 * The boundaries, from `docs/historical-coverage.md` §"The coverage
 * boundaries" — each measured against the live sources rather than inferred.
 *
 * Stated as *first period covered* because that is how every one of them is
 * actually shaped: a source either reaches back to a year and stops, or it
 * publishes the current period alone.
 */

/** Protocol XML begins at WP18 (22.10.2013). WP17 and earlier are PDF-only, so
 * speech counts, word counts and the speaking-time proxy do not exist for them
 * — measured 100/100 records carrying `xml_url` for WP18–19 and 0/100 for
 * WP16–17. */
const FIRST_XML_WAHLPERIODE = 18

/** Named-vote XLSX sheets begin **2019-09-26**, i.e. part-way through WP19.
 * Measured by walking the listing to exhaustion (391 of 1 015 entries carry an
 * XLSX); this corrects an earlier §4.1 estimate of "roughly WP17" that was
 * wrong by about seven years. So WP19 is `partial` and WP18 and earlier are
 * `none`. */
const FIRST_VOTE_WAHLPERIODE = 19
const FULL_VOTE_WAHLPERIODE = 20

/**
 * The coverage of one source in one period.
 *
 * A function rather than a table because the answers are ranges, and a table
 * keyed by period would be eight rows restating the same three boundaries —
 * which is exactly how a row comes to disagree with the document it was copied
 * from. `currentWahlperiode` is a parameter for the same reason it is derived
 * everywhere else: committees are published for *the sitting Bundestag*, not
 * for the number 21, and hardcoding 21 here would silently mark WP21 as
 * "committees not published" the day WP22 lands.
 */
export function sourceCoverage(
  source: PeriodSource,
  wahlperiode: number,
  currentWahlperiode: number | null | undefined,
): SourceCoverage {
  switch (source) {
    case "committees":
      // Stammdaten publishes committee membership for the current period alone
      // (§6.3, §6.4) — it is the only machine-readable source in existence, so
      // every closed period has zero committee rows permanently.
      //
      // An unknown current period is treated as "this one is current": the
      // alternative is telling a reader their committees are unpublished
      // because a query has not resolved yet, which is a false claim about the
      // Bundestag rather than a loading state.
      return currentWahlperiode === null || currentWahlperiode === undefined
        ? "full"
        : wahlperiode >= currentWahlperiode
          ? "full"
          : "none"
    case "speeches":
      return wahlperiode >= FIRST_XML_WAHLPERIODE ? "full" : "none"
    case "votes":
      if (wahlperiode >= FULL_VOTE_WAHLPERIODE) return "full"
      if (wahlperiode === FIRST_VOTE_WAHLPERIODE) return "partial"
      return "none"
    case "portraits":
      // The bundestag.de listing serves *sitting* members, so a closed period
      // resolves whatever the name-join still reaches. WP19 measured 635
      // credited portraits, so this is emphatically not `none` — it is thinner
      // than the current period and not measurable in advance.
      return currentWahlperiode === null || currentWahlperiode === undefined
        ? "full"
        : wahlperiode >= currentWahlperiode
          ? "full"
          : "partial"
    case "seating":
      // Every period, including the current one. §9: no machine-readable
      // seating plan exists, so the *distribution* is counted from the roster
      // and every individual seat's position is invented. Historical periods
      // are no worse off here — which is worth saying, because it is the one
      // place where "the same as WP21" is the honest answer.
      return "synthetic"
  }
}

/** Whether a period can answer this source at all. The predicate five
 * components need, so none of them re-derives it from `sourceCoverage`'s
 * four-way return. */
export function sourceUnavailable(
  source: PeriodSource,
  wahlperiode: number,
  currentWahlperiode: number | null | undefined,
): boolean {
  return sourceCoverage(source, wahlperiode, currentWahlperiode) === "none"
}

/**
 * Whether a period is the sitting one.
 *
 * One predicate rather than `wahlperiode === current` at fourteen call sites,
 * because the comparison has a subtlety: `current` may be `undefined` (still
 * resolving) or `null` (nothing ingested), and `21 === undefined` is false —
 * which would make every page announce itself as historical for the duration of
 * one round-trip, flashing a "this is a past Bundestag" banner onto the current
 * one. Unknown is treated as current, so the chrome stays quiet until it knows.
 */
export function isCurrentPeriod(
  wahlperiode: number,
  currentWahlperiode: number | null | undefined,
): boolean {
  if (currentWahlperiode === null || currentWahlperiode === undefined) return true
  return wahlperiode >= currentWahlperiode
}

/**
 * The i18n keys explaining why a source is empty for a period.
 *
 * Keys rather than strings so this module stays free of `useLocale` and can be
 * called from a server component — the same split components/caveat-note.tsx
 * makes, and the reason `PageHeading` takes keys.
 *
 * `null` where there is nothing to explain: a `full` source needs no note, and
 * a note that renders unconditionally is one readers learn to skip.
 */
export const SOURCE_NOTE_KEYS = {
  committees: {
    none: "period.source.committees.none",
    partial: null,
  },
  speeches: {
    none: "period.source.speeches.none",
    partial: null,
  },
  votes: {
    none: "period.source.votes.none",
    partial: "period.source.votes.partial",
  },
  portraits: {
    none: null,
    partial: "period.source.portraits.partial",
  },
  seating: {
    none: null,
    partial: null,
  },
} as const

/**
 * The explanation for a source in a period, or null when none is warranted.
 *
 * Returns a `TranslationKey`-shaped string; the caller resolves it. Typed
 * through `SOURCE_NOTE_KEYS` so a key added to the dictionary without a
 * boundary — or a boundary without a key — fails the typecheck.
 */
export function sourceNoteKey(
  source: PeriodSource,
  wahlperiode: number,
  currentWahlperiode: number | null | undefined,
): (typeof SOURCE_NOTE_KEYS)[PeriodSource][keyof (typeof SOURCE_NOTE_KEYS)[PeriodSource]] {
  const coverage = sourceCoverage(source, wahlperiode, currentWahlperiode)
  if (coverage === "none") return SOURCE_NOTE_KEYS[source].none
  if (coverage === "partial") return SOURCE_NOTE_KEYS[source].partial
  return null
}

// --- what a deployment actually holds -------------------------------------

/**
 * One period the deployment can show, as `periods.listPeriods` answers.
 *
 * Distinct from the coverage table above, and the distinction is the one the
 * acceptance criteria call "not-yet-backfilled versus no data": the boundaries
 * are permanent facts about the Bundestag's publishing, while this is a
 * mutable fact about this Convex deployment on this day. WP18 has no vote data
 * *ever*; WP18 also has no roster *yet*, and only the second is fixable by
 * running a backfill.
 */
export type PeriodAvailability = {
  wahlperiode: number
  /** Mandates on the roster. Zero is impossible here — a period with no roster
   * is not listed at all — so this is a size, not a presence flag. */
  mandates: number
  /** Whether the nightly sweep has written the period-total score row for
   * anyone. False means the period is ingested but unscored, which renders
   * every board empty and is a *different* thing from an inactive chamber. */
  scored: boolean
}

/**
 * Every period a reader could switch to, newest first, with the current one
 * marked.
 *
 * The selector needs three things and this is all three: which periods exist,
 * which is current, and — through `scored` — whether a period that exists can
 * answer the page being looked at.
 */
export type PeriodOptions = {
  periods: readonly PeriodAvailability[]
  current: number | null
}

/**
 * Whether a period is ingested in this deployment.
 *
 * The check that separates *not backfilled* from *not found*. `/mps/bt-0001?wp=18`
 * on a deployment holding WP19–21 is neither a bad link nor an MP with no
 * record — it is a period nobody has run yet, and it deserves a page that says
 * so with a list of the periods that do exist. A 404 there would tell the
 * reader their URL was wrong when it was not.
 */
export function periodIngested(
  wahlperiode: number,
  options: PeriodOptions | undefined,
): boolean | undefined {
  if (options === undefined) return undefined
  return options.periods.some((entry) => entry.wahlperiode === wahlperiode)
}
