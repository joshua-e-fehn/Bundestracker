import { Badge } from "@/components/ui/badge"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { outcomeKey, outcomeTone } from "@/lib/vote-outcomes"

/**
 * A ballot's published outcome, as a badge.
 *
 * Distinct from `components/vote-result-badge.tsx`, which renders how one *MP*
 * voted — a closed union of five positions. This renders what the *chamber*
 * decided, which is free text: DIP's `beschlusstenor` is a string, not an enum
 * (§3.2 of docs/api-research.md), so there is no set of outcomes to enumerate
 * and no lookup table this could be.
 *
 * ## What is and is not translated
 *
 * The stored value is never rewritten — the /votes result filter groups on it
 * and matches the reader's selection exactly (convex/votes.ts), so translating
 * at ingest would break the dropdown that selects it. The German rendering is
 * never rewritten either: `lib/i18n.ts` holds the Bundestag's own wording byte
 * for byte.
 *
 * An English rendering is offered only where the tenor is one of a handful of
 * exactly-known ones. Everything else keeps its own German words in both
 * locales, because an outcome the sources spell out and this code does not
 * recognise is precisely the one nobody should paraphrase. See
 * `lib/vote-outcomes.ts`, where both rules live and are tested.
 *
 * ## The pending arm
 *
 * A ballot whose outcome has not been published yet stores `""`. That is the
 * common case rather than the exotic one — the outcome comes from DIP's
 * `/vorgangsposition`, a stage later than the vote sheet itself, so a ballot is
 * result-less between the two. It renders as a dashed, uncoloured badge rather
 * than borrowing a `--vote-*` tint: every tinted badge on the page is a decision
 * the chamber took, and reusing the abstain yellow here would read as though it
 * had abstained.
 *
 * A server component, so it renders inside the vote list without shipping JS.
 */
export function VoteOutcomeBadge({
  result,
  locale,
  className,
}: {
  result: string
  locale: Locale
  className?: string
}) {
  const tone = outcomeTone(result)

  if (tone === "pending") {
    return (
      <Badge
        variant="outline"
        className={cn("shrink-0 border-dashed bg-muted/40 text-muted-foreground", className)}
      >
        {t("votes.outcome.pending", locale)}
      </Badge>
    )
  }

  const color =
    tone === "passed" ? "var(--vote-yes)" : tone === "rejected" ? "var(--vote-no)" : null
  const key = outcomeKey(result)
  // German prints the source wording; English prints it too unless the tenor is
  // one of the known ones. See the header.
  const label = locale === "en" && key !== null ? t(key, locale) : result

  return (
    <Badge
      variant="outline"
      className={cn("max-w-[14rem] shrink-0 justify-start truncate", className)}
      style={
        color === null
          ? undefined
          : {
              // The same 14 % tint `PartyBadge` uses, so the two badge families
              // sit at one weight in a row that carries both.
              backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
              color,
              borderColor: "transparent",
            }
      }
      // The cell truncates; the full tenor stays reachable on hover — and in
      // English that hover is also where the official German remains readable.
      title={result}
    >
      {label}
    </Badge>
  )
}
