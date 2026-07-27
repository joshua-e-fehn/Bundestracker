import type { Locale, TranslationKey } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * A ballot's result as one horizontal stacked bar.
 *
 * ## Why the five positions are not five shades of one colour
 *
 * `yes` and `no` are opposed, `abstain` is a third position, and `absent` is
 * not a position at all — `nichtabgegeben` is "did not vote" where `Enthaltung`
 * is "voted to abstain" (§4.1). convex/schema.ts keeps them as distinct values
 * precisely so they are not collapsed, and a bar that shaded them alike would
 * undo that: it would show a chamber that stayed away as one that abstained.
 * So absence is rendered in the muted surface colour — visibly *not* one of the
 * cast votes — while the three cast positions carry the green/red/gold the
 * vote badges already use. (Gold, not the amber this said before 6d9b255:
 * `--vote-abstain` was retinted to the brand gold's ink tier by that commit,
 * and components/vote-result-badge.tsx now reads the same tokens this does, so
 * the claim that the bar and the badge match is true rather than aspirational.)
 *
 * Party colours are deliberately not used here. lib/parties.ts colours groups;
 * this colours positions, and one ballot's `yes` bar is the same green whoever
 * voted for it. Tinting a result by party would suggest the outcome belonged
 * to a party rather than to the chamber.
 *
 * ## Segments below a pixel
 *
 * A one-vote segment of a 630-seat ballot is 0.16 % — narrower than one device
 * pixel on a phone, so it would round to nothing and a lone dissenter would
 * disappear. `MIN_VISIBLE_PERCENT` floors any non-zero segment at a width that
 * survives rounding; the widths are then normalised so the row still sums to
 * 100 %. The number under the bar is always the true count, so the floor
 * changes what is *drawn*, never what is *said*.
 *
 * A server component: no interactivity, so it renders on both pages without
 * reaching the client bundle.
 */

/** The five positions, in the order they are stacked — cast votes first, in the
 * order a result is read out, with absence last because it is not one. */
const SEGMENTS = [
  { key: "yes", labelKey: "vote.yes", className: "bg-vote-yes" },
  { key: "no", labelKey: "vote.no", className: "bg-vote-no" },
  { key: "abstain", labelKey: "vote.abstain", className: "bg-vote-abstain" },
  { key: "invalid", labelKey: "vote.invalid", className: "bg-vote-invalid" },
  { key: "absent", labelKey: "vote.absent", className: "bg-vote-absent" },
] as const satisfies ReadonlyArray<{ key: string; labelKey: TranslationKey; className: string }>

export type VoteCounts = {
  yes: number
  no: number
  abstain: number
  invalid: number
  absent: number
}

/** Floor for a non-zero segment, as a percentage of the bar. Chosen so a single
 * vote in a 630-seat chamber is still a visible sliver at phone widths. */
const MIN_VISIBLE_PERCENT = 1.2

/**
 * Segment widths that sum to 100, with every non-zero count visible.
 *
 * Exported for its test: the normalisation is the part with an arithmetic
 * failure mode, and a bar whose segments sum to 103 % overflows its container
 * silently rather than throwing.
 */
export function segmentWidths(counts: VoteCounts): Record<keyof VoteCounts, number> {
  const total = SEGMENTS.reduce((sum, segment) => sum + Math.max(0, counts[segment.key]), 0)
  if (total === 0) {
    return { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }
  }

  const raw = SEGMENTS.map((segment) => {
    const count = Math.max(0, counts[segment.key])
    return {
      key: segment.key,
      // A zero stays zero — the floor is for votes that exist and would vanish,
      // not for positions nobody took.
      percent: count === 0 ? 0 : Math.max(MIN_VISIBLE_PERCENT, (count / total) * 100),
    }
  })

  // Flooring pushes the sum above 100, so the surplus comes off the segments
  // proportionally to what they can spare — only those above the floor, so
  // widening a sliver cannot immediately re-hide it.
  const sum = raw.reduce((acc, segment) => acc + segment.percent, 0)
  const surplus = sum - 100
  const shrinkable = raw.filter((segment) => segment.percent > MIN_VISIBLE_PERCENT)
  const headroom = shrinkable.reduce(
    (acc, segment) => acc + (segment.percent - MIN_VISIBLE_PERCENT),
    0,
  )

  const out = { yes: 0, no: 0, abstain: 0, invalid: 0, absent: 0 }
  for (const segment of raw) {
    const spare = segment.percent - MIN_VISIBLE_PERCENT
    const adjusted =
      surplus > 0 && headroom > 0 && spare > 0
        ? segment.percent - surplus * (spare / headroom)
        : segment.percent
    out[segment.key] = adjusted
  }
  return out
}

export function VoteBar({
  counts,
  locale,
  /** Renders the counts and labels under the bar. Off in a dense table row,
   * where the row's own cells already carry the numbers. */
  showLegend = false,
  className,
}: {
  counts: VoteCounts
  locale: Locale
  showLegend?: boolean
  className?: string
}) {
  const widths = segmentWidths(counts)
  const total = SEGMENTS.reduce((sum, segment) => sum + Math.max(0, counts[segment.key]), 0)

  // A ballot with no records loaded is not a ballot where nobody voted, so it
  // renders as an empty track rather than as a bar of absences.
  //
  // `role="img"` carries the label: an `aria-label` on a bare `div` labels
  // nothing, because a generic element exposes no accessible name. The same
  // trap the filter selects in components/rankings-filters.tsx document — it
  // looks correct and satisfies nobody.
  if (total === 0) {
    return (
      <div
        role="img"
        aria-label={t("common.noData", locale)}
        className={cn("h-2 w-full rounded-full bg-muted", className)}
      />
    )
  }

  /** The bar's meaning in words, for a reader who cannot see it. Without this
   * the whole result is conveyed by colour alone. */
  const summary = SEGMENTS.filter((segment) => counts[segment.key] > 0)
    .map((segment) => `${t(segment.labelKey, locale)}: ${counts[segment.key]}`)
    .join(", ")

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={summary}
      >
        {SEGMENTS.map((segment) =>
          counts[segment.key] > 0 ? (
            <div
              key={segment.key}
              className={segment.className}
              style={{ width: `${widths[segment.key]}%` }}
              // Redundant to the group label above for a screen reader, but it
              // is what a mouse user gets on hover.
              title={`${t(segment.labelKey, locale)}: ${counts[segment.key]}`}
            />
          ) : null,
        )}
      </div>

      {showLegend ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {SEGMENTS.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-[2px]", segment.className)}
              />
              <span className="text-muted-foreground">{t(segment.labelKey, locale)}</span>
              <span className="font-medium tabular-nums">{counts[segment.key]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
