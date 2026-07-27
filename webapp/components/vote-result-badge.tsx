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

/**
 * The five positions' badge styles.
 *
 * Built from the `--vote-*` tokens rather than from Tailwind's palette, which
 * is what makes this badge and the bar in components/vote-bar.tsx the same
 * colour for the same vote — they used to be two independently-chosen greens,
 * and the bar's abstain segment was gold while this one was yellow.
 *
 * The tokens are the *ink* tier: each is solved for 4.5:1 against the page in
 * both themes (see app/globals.css), so using one as the text colour is safe
 * and no `dark:` override is needed — the custom property already differs per
 * theme. That is the whole reason the old `dark:text-green-300` pairs are gone
 * rather than translated: they existed to undo a light-mode choice that the
 * token system makes correctly on both sides.
 *
 * The background is the same 14 % tint `PartyBadge` and `VoteOutcomeBadge` use,
 * so a table row carrying a party badge and a vote badge reads at one weight.
 */
const VOTE_STYLES: Record<Vote, string> = {
  yes: "border-transparent bg-vote-yes/15 text-vote-yes",
  no: "border-transparent bg-vote-no/15 text-vote-no",
  abstain: "border-transparent bg-vote-abstain/15 text-vote-abstain",
  // The two neutrals keep the muted surface rather than taking `--vote-invalid`
  // and `--vote-absent` as text: those two tokens are *bar-segment* colours,
  // deliberately low-contrast so an absence recedes in a stacked bar, and a
  // label painted in them would fail 4.5:1 in both themes. The distinction they
  // encode is carried here by the word on the badge, which is the same
  // information without the contrast cost.
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
