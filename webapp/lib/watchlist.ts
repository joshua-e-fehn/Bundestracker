import type { TranslationKey } from "@/lib/i18n"

/**
 * What the watchlist says when the list is shorter than the follow list.
 *
 * ## The gap this exists to make visible
 *
 * A follow is stored as an `mps.internalId` and nothing else — no period
 * (convex/schema.ts). `getFollowedMPs` resolves those ids against **one**
 * Wahlperiode and skips anyone with no mandate row in it
 * (convex/userPreferences.ts), which is the right call for the list: a
 * placeholder for someone who left in 2021 would render a gap as a person, and
 * `mpLabel`'s id-as-name fallback exists for surfaces where that *is* wanted.
 *
 * The consequence is that the two counts legitimately disagree. Someone who
 * follows twelve members and sees ten cards is looking at a list that is
 * quietly wrong about how many people they follow — and the wrongness is
 * invisible, because ten cards look exactly like ten follows. This is the
 * codebase's standing position applied to a new surface: a gap is rendered, not
 * hidden (`about.principles.gaps`), the same way an unscored MP shows as "nicht
 * bewertet" rather than as a zero.
 *
 * ## Why it is a module rather than four lines in the component
 *
 * Because the arithmetic has three cases and two of them are wrong in ways a
 * reader would not report. `undefined` — the preference query still in flight —
 * must not be read as zero, or the note would claim every follow is missing for
 * as long as the round-trip takes. And a *negative* difference is not
 * impossible: `findMandate` falls back to `dipPersonId`, so two stored ids can
 * resolve to one mandate row, and a follow list holding both would produce more
 * ids than cards without anyone being absent. Subtracting and rendering would
 * print "-1 gefolgte Personen".
 *
 * Testable here; unreachable in a component that has no DOM under `bun test`.
 */
export type WatchlistGap =
  | { kind: "none" }
  | { kind: "one"; key: TranslationKey }
  | { kind: "many"; key: TranslationKey; count: number }

/**
 * How many followed members this period does not show, as the note to render.
 *
 * Singular and plural are separate *keys* rather than one string with a
 * `{count}` placeholder, following lib/relative-time.ts: German and English
 * happen to split at one here, and that is not a reason to assume the next
 * language will.
 *
 * @param followedIds how many ids the reader's preferences hold, or `undefined`
 *   while that query is in flight
 * @param shown how many cards the watchlist resolved for this period
 */
export function watchlistGap(followedIds: number | undefined, shown: number): WatchlistGap {
  // Not loaded is not zero. Treating it as zero would make the note claim, for
  // the length of a round-trip, that every follow is missing.
  if (followedIds === undefined) return { kind: "none" }
  const missing = followedIds - shown
  // `<= 0` rather than `=== 0`: see the header on why the difference can go
  // negative. Either way there is nothing to report — the list is complete or
  // over-complete, and neither is a gap.
  if (missing <= 0) return { kind: "none" }
  if (missing === 1) return { kind: "one", key: "settings.watchlist.notSittingOne" }
  return { kind: "many", key: "settings.watchlist.notSitting", count: missing }
}
