import { Badge } from "@/components/ui/badge"
import type { Locale, TranslationKey } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * How one MP voted, as a badge.
 *
 * The five positions are the vote sheets' one-hot columns (§4.1 of
 * docs/api-research.md), and `abstain` and `absent` are kept visually distinct
 * for the same reason `convex/schema.ts` keeps them distinct as values:
 * `Enthaltung` is a vote cast, `nichtabgegeben` is an absence, and colouring
 * them alike would flatter everyone who stayed away.
 *
 * `invalid` shares the neutral grey rather than the red of a `no`: an invalid
 * ballot is a spoiled one, not a rejection.
 */

/** Mirrors the `vote` union in convex/schema.ts. The mapping objects below are
 * `Record<Vote, …>`, so a sixth position added there is a type error here rather
 * than a badge that silently renders unstyled. */
export type Vote = "yes" | "no" | "abstain" | "invalid" | "absent"

const VOTE_LABELS: Record<Vote, TranslationKey> = {
  yes: "vote.yes",
  no: "vote.no",
  abstain: "vote.abstain",
  invalid: "vote.invalid",
  absent: "vote.absent",
}

const VOTE_STYLES: Record<Vote, string> = {
  yes: "border-green-600/30 bg-green-600/15 text-green-700 dark:text-green-300",
  no: "border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300",
  abstain: "border-yellow-500/40 bg-yellow-500/20 text-yellow-800 dark:text-yellow-200",
  invalid: "border-border bg-muted text-muted-foreground",
  absent: "border-border bg-muted text-muted-foreground",
}

export function VoteResultBadge({
  vote,
  locale,
  className,
}: {
  vote: Vote
  locale: Locale
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn(VOTE_STYLES[vote], className)}>
      {t(VOTE_LABELS[vote], locale)}
    </Badge>
  )
}
