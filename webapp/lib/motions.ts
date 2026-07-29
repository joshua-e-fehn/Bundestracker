/**
 * The URL contract of `/motions`.
 *
 * Three parameter names, declared once. They live here rather than as literals
 * in components/motion-list.tsx for the reason `ALL` lives beside `FilterSelect`
 * and `PERIOD_PARAM` lives in lib/period.ts: the page reads them, the reset
 * button clears them, and a test asserts them — three places that must agree on
 * one spelling, and two copies of a magic string is how a "reset" stops
 * recognising its own cleared state.
 *
 * They deliberately do **not** collide with `?wp=`, which lib/period.ts owns and
 * which scopes this page like every other. A period is not one of these filters:
 * it is the subject of the page, which is why `reset` in the list component
 * clears these three and keeps that one.
 *
 * Nothing here imports from `convex/` or from React — this is a description of
 * an address, and `convex/motions.ts`'s arguments are named independently
 * because a query argument and a URL key are not the same contract. They happen
 * to mean the same thing today; a rename of one should not silently rename the
 * other.
 */

/** The procedure kind — `?kind=Kleine+Anfrage`. Matched exactly against the
 * values `getMotionFilterOptions` offers, which come from the data rather than
 * from an enum: `vorgangstyp` is an open string with no published value list. */
export const MOTION_KIND_PARAM = "kind"

/** The calendar year — `?year=2026`. A year rather than a month, for the reason
 * `getVoteSheetsPage` gives: a Wahlperiode spans four of them and a month picker
 * would list forty mostly-empty options. */
export const MOTION_YEAR_PARAM = "year"

/**
 * The title search — `?q=asyl`.
 *
 * `q`, matching `/search`, because it is the same gesture on a different corpus
 * and a reader who has learnt one address should be able to guess the other.
 * The two are otherwise unrelated: `/search` searches an index and answers with
 * people, this filters a page of documents by title.
 */
export const MOTION_QUERY_PARAM = "q"

// --- input normalisation --------------------------------------------------
//
// Everything below runs on values that came in through the address bar, so
// each helper's job is the same: turn "something the URL might carry" into
// either "a value the query recognises" or `null` (drop the parameter). The
// alternative — trusting the URL — is what makes `?year=abc` render the
// empty state for a period with matches, because Convex takes `abc-01-01`
// as a lexicographic bound above every stored date and returns nothing.

/** `YYYY` — a four-digit year the query accepts as a date bound. Rejects
 * everything else. */
const YEAR_PATTERN = /^\d{4}$/

/**
 * A URL year, or `null` if it isn't one.
 *
 * The query treats the value as an ISO-date prefix (`${year}-01-01` /
 * `-12-31`), so anything other than four digits sits either lexicographically
 * above every stored date (`abc-…`) or below the first year of the period
 * (`0`-…) and returns an empty page. That empty page then renders the
 * "no matches" state on a period that has matches — a lie by chrome.
 *
 * Normalising here means the *component* never sees a malformed year and
 * therefore never asks the query for one; the year filter reads as
 * "unselected" instead. The query also validates for a defence in depth
 * (an old bookmark, another client), but this is where the URL becomes
 * data.
 */
export function normalizeMotionYear(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  return YEAR_PATTERN.test(raw) ? raw : null
}

/**
 * A URL kind, or `null` if it isn't a filterable one.
 *
 * The empty string is what Radix's `Select` reserves for "no selection", so
 * `?kind=` — reachable by hand-editing the URL or by a bookmark of a
 * filter-then-reset state — must not reach the query as
 * `vorgangstyp: ""`, which would index-select rows whose `vorgangstyp` is
 * literally the empty string (none) and render a "no matches" state that
 * is really "you asked for a value nothing has".
 *
 * Beyond emptiness there is nothing to check: `vorgangstyp` is an open
 * string on DIP and `getMotionFilterOptions` reports which values this
 * period offers. A kind that is not in the dropdown will simply return no
 * rows, which is the truthful answer for that kind.
 */
export function normalizeMotionKind(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed === "" ? null : trimmed
}
