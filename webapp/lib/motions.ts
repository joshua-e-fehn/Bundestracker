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
