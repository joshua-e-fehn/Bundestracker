"use client"

import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"
import { type PeriodSource, sourceNoteKey } from "@/lib/period"

/**
 * Why a source is empty for this period — beside the emptiness, or nothing.
 *
 * `docs/historical-coverage.md` opens with the distinction this component
 * exists to keep: *a period with no committee rows is not a parliament whose
 * members sat on no committees.* Those two are identical in the database and
 * opposite to a reader, and the only thing that separates them on screen is a
 * sentence next to the zero.
 *
 * Six surfaces need that sentence — the profile's committee card and its score
 * panel, the recent-records vote list, `/votes`, `/parties`, `/rankings` — and
 * a copy per surface is how one of them comes to say "no committees" while the
 * others say "not published". `lib/period.ts` decides *whether* a note is
 * warranted and *which*; this renders it in the box the site already uses for
 * structural limits.
 *
 * ## It renders nothing far more often than it renders something
 *
 * On the current period almost every source is `full`, and a note that appeared
 * anyway would be one readers learn to skip — which would cost exactly the
 * cases it exists for. `sourceNoteKey` returns null for `full`, for `synthetic`
 * (seating is constructed in every period including this one, so its note is
 * not a *historical* caveat and `components/seating-notice.tsx` carries it
 * unconditionally already), and for a `partial` source with nothing worth
 * saying.
 *
 * ## Why `CaveatNote` and not a plain paragraph
 *
 * Because it is one. components/caveat-note.tsx states the editorial rule: a
 * caveat is a case where a low number means "not published" rather than "did
 * not happen", and it renders in a recognisable box so a reader who has learnt
 * the shape finds the same shape everywhere it applies. This is that case, on
 * the periods where it bites hardest.
 */
export function SourceCoverageNote({
  source,
  wahlperiode,
  current,
  className,
}: {
  source: PeriodSource
  wahlperiode: number
  /** The sitting period. `undefined` while it resolves, and unknown is treated
   * as "this period is current" — see `sourceCoverage`, which will not tell a
   * reader their committees are unpublished because a query is in flight. */
  current: number | null | undefined
  className?: string
}) {
  const { t } = useLocale()
  const key = sourceNoteKey(source, wahlperiode, current)
  if (key === null) return null
  // The keys come from `SOURCE_NOTE_KEYS`, whose values are literal types; the
  // assertion narrows them to the dictionary's key union, which is what makes a
  // key added to one and not the other a typecheck failure rather than a
  // rendered raw string.
  return <CaveatNote className={className}>{t(key as TranslationKey)}</CaveatNote>
}
