import { Badge } from "@/components/ui/badge"
<<<<<<< HEAD
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
=======
import { partyColor, partyLabel } from "@/lib/parties"
import { cn } from "@/lib/utils"

/**
 * A Fraktion, in its own colour.
 *
 * Everything about which colour and which spelling lives in lib/parties.ts —
 * this is only the rendering. That split matters because the same question
 * ("which party is this string?") is asked by the MP card, the vote list and the
 * activity feed, and the sources spell a group three different ways (§6.4).
 *
 * The colour is applied as a tinted background with a solid foreground rather
 * than as a solid fill: six of these can appear in one list, and six saturated
 * blocks compete with the figures they are meant to annotate. `color-mix` keeps
 * one palette doing both jobs.
 *
 * A server component — no interactivity, so it stays out of the client bundle
 * and can be rendered directly by a server page.
 */
export function PartyBadge({
  fraktion,
  className,
}: {
  /** The Fraktion as stored, in whatever spelling the source used. */
  fraktion: string | null | undefined
  className?: string
}) {
  const color = partyColor(fraktion)

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-transparent font-medium", className)}
      style={{
        // 14 % of the party colour over the card surface: enough to read as
        // that party, light enough to sit under text.
        backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
        color,
      }}
    >
      {/* The dot carries the colour at full strength, so the party stays
          identifiable for a reader who finds the tinted text too subtle. */}
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {partyLabel(fraktion)}
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
    </Badge>
  )
}
