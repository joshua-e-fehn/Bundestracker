import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * A Fraktion, as a coloured badge.
 *
 * The colours are each group's own, which is the only reason a political
 * palette is defensible here: they identify, they do not rank. Nothing in
 * Bundestrack colours a *number* by party — a leaderboard tinted by group would
 * suggest the ranking had something to do with it.
 *
 * ## Matching a group name
 *
 * `mps.fraktion` holds the short form the vote sheets and DIP use (`CDU/CSU`,
 * not Stammdaten's spelled-out version); the pipeline maps between them before
 * writing, per §6.4 of docs/api-research.md. So the keys below are that short
 * form — but the lookup normalises anyway, for two documented reasons:
 *
 *  - §4.2: party labels in the protocol XML carry **non-breaking spaces** —
 *    `'BÜNDNIS\xa090/ DIE GRÜNEN'`. A `\xa0` reaching this component would miss
 *    the key and render as an unstyled group, which looks like a data gap.
 *  - The same source spells the Greens with and without the space after the
 *    slash.
 *
 * An unmatched group gets the neutral style rather than no badge. A group this
 * file has never heard of is still a real group — a new Fraktion, or a period
 * before one of these existed — and should read as unstyled, not as absent.
 */

type PartyStyle = {
  /** Badge classes. Each pairs a tinted background with a foreground that
   * clears 4.5:1 against it in both themes — the CDU's black and the FDP's
   * yellow are the two that need the dark-mode override to stay legible. */
  className: string
}

export const PARTY_STYLES: Record<string, PartyStyle> = {
  "CDU/CSU": {
    className: "bg-neutral-900/10 text-neutral-900 dark:bg-neutral-100/15 dark:text-neutral-100",
  },
  SPD: { className: "bg-red-500/15 text-red-700 dark:text-red-300" },
  "BÜNDNIS 90/DIE GRÜNEN": {
    className: "bg-green-500/15 text-green-700 dark:text-green-300",
  },
  FDP: { className: "bg-yellow-400/20 text-yellow-800 dark:text-yellow-200" },
  AfD: { className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  "Die Linke": { className: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300" },
  Fraktionslos: { className: "bg-muted text-muted-foreground" },
}

const NEUTRAL: PartyStyle = { className: "bg-muted text-muted-foreground" }

/**
 * Collapses the spelling differences §4.2 documents, so one group is one key.
 *
 * The non-breaking space is written as `\u00a0`, not as a literal: an actual
 * U+00A0 in source is invisible in every editor and every diff, so the one line
 * defending against an invisible character would itself be unreviewable.
 */
function normalise(fraktion: string): string {
  return fraktion
    .replace(/\u00a0/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
}

export function partyStyle(fraktion: string): PartyStyle {
  return PARTY_STYLES[normalise(fraktion)] ?? NEUTRAL
}

/**
 * The badge.
 *
 * An empty `fraktion` renders nothing rather than an empty badge. That is the
 * `mpLabel` fallback arriving here — an MP missing from the roster gets `""` for
 * their group — and a blank chip would read as "no group", which is a claim
 * (`Fraktionslos`) rather than the absence of one.
 */
export function PartyBadge({ fraktion, className }: { fraktion: string; className?: string }) {
  if (fraktion.trim() === "") return null
  return (
    <Badge
      variant="secondary"
      className={cn("border-transparent font-medium", partyStyle(fraktion).className, className)}
    >
      {fraktion}
    </Badge>
  )
}
