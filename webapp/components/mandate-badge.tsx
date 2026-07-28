import { Badge } from "@/components/ui/badge"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { MANDATE_LABEL_KEYS, type MandateType, mandateType } from "@/lib/taxonomy"
import { cn } from "@/lib/utils"

/**
 * How a member won their seat: constituency (Direktwahl) or state list
 * (Landesliste).
 *
 * The figure was already stored, already filterable on the roster and already a
 * row in the profile's Biografie card — and invisible everywhere a member is
 * merely *listed*, which is most of the site. This is that field promoted to
 * something a reader can see without opening a profile.
 *
 * ## Why this one marks the majority, where `DissentBadge` does not
 *
 * That badge renders nothing below its threshold on the explicit grounds that
 * "a mark on the majority is not information — it is furniture". The rule is
 * right and this is not the same case. Dissent is a *deviation* from an
 * unmarked norm, so the absence of the badge is itself the common reading. A
 * mandate type is a **partition**: every seated member has one, 276 against 359
 * in WP21, and neither side is the default. Marking only direct mandates would
 * make "no badge" mean both "list MP" and "not ingested", which is precisely
 * the collapse `mandateType` returns null to avoid.
 *
 * So both values render, and the third case — null — renders nothing. Unknown
 * is not a mandate type and must not be drawn as one.
 *
 * ## Muted, not coloured
 *
 * No party colour and no `vote-*` token. Every surface this appears on already
 * carries a `PartyBadge` beside it, and a second saturated pill next to a name
 * competes with the one that carries the group. More to the point, a colour
 * would editorialise: this badge states a route into parliament, and the two
 * routes are equally legitimate under §6 of the Bundeswahlgesetz. `outline`
 * over `bg-muted` is the site's neutral, and the single-letter compact form
 * borrows `DissentBadge`'s trick of keeping the word in the accessible name.
 *
 * A server component: the tooltip is the native `title` and the locale arrives
 * as a prop, so nothing here reaches the client bundle. Same construction as
 * `DissentBadge` and `RebelVoteBadge`, and the same reason.
 */

/**
 * The compact form's glyph, per type.
 *
 * The *word* is not here — it comes from `MANDATE_LABEL_KEYS` in
 * lib/taxonomy.ts, which points at the strings the roster's mandate filter
 * already used. Restating them would give the badge and the filter that selects
 * on it two vocabularies for one field.
 *
 * The letter is the initial of the German term in **both** languages, because
 * it abbreviates a *stored value* (`Direktwahl`/`Landesliste`), not the
 * translated label. A reader seeing "D" beside a name and "Direct mandate" in
 * the tooltip learns the mapping once; a "D" that silently became an "L"
 * between languages would make the compact badge unreadable against the German
 * source every figure on this site is checked against.
 */
const MANDATE_LETTERS = {
  Direktwahl: "D",
  Landesliste: "L",
} as const satisfies Record<MandateType, string>

export function MandateBadge({
  electionMethod,
  locale,
  /** Renders the initial without the word — for a card row where a full badge
   * would crowd the name it belongs to. The label stays in the accessible name
   * and in the tooltip, so this is a visual compaction rather than a loss of
   * meaning. Same contract as `DissentBadge`'s `compact`. */
  compact = false,
  className,
}: {
  /** `mps.electionMethod`, raw. Narrowed here rather than by the caller so the
   * six surfaces that render this cannot disagree about what an unrecognised
   * spelling means. */
  electionMethod: string | null | undefined
  locale: Locale
  compact?: boolean
  className?: string
}) {
  const type = mandateType(electionMethod)
  // Unknown renders nothing. Not a "?" pill: a marker for absent data on a
  // field this reliable would appear on a handful of rows and read as a
  // property of those members rather than of the ingest.
  if (type === null) return null

  const label = t(MANDATE_LABEL_KEYS[type], locale)
  const letter = MANDATE_LETTERS[type]

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium text-muted-foreground",
        compact && "gap-0 px-1.5 tabular-nums",
        className,
      )}
      // The full label even in the compact form — the letter alone is a
      // convention a reader has no way to look up from the page it appears on.
      title={label}
    >
      {compact ? (
        <>
          <span aria-hidden>{letter}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        label
      )}
    </Badge>
  )
}
