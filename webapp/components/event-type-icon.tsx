import {
  Activity,
  CheckCircle2,
  FileSignature,
  FileText,
  HelpCircle,
  Mic,
  Users,
} from "lucide-react"
import type { TranslationKey } from "@/lib/i18n"
import type { EventType } from "@/lib/taxonomy"
import { cn } from "@/lib/utils"

/**
 * The icon and colour for one kind of feed event.
 *
 * A module rather than a `switch` inside the feed item, because three places
 * need the same mapping — the feed row, the filter chips, and the type legend —
 * and three copies is how a chip ends up with a different icon from the rows it
 * selects.
 *
 * Colours are deliberately *not* the party palette. A feed row already carries
 * a Fraktion badge, and reusing red or green for an event kind next to it would
 * read as a second political signal.
 *
 * ## Why every kind is now one gold rather than six hues
 *
 * These used to be six unrelated Tailwind hues — sky, violet, emerald, amber,
 * rose, teal — which is what the header above described as "a hue per kind,
 * chosen only to be distinguishable from each other". Two things were wrong
 * with that once the brand palette landed. The colours were outside it
 * entirely, so a feed row carried six hues the rest of the site never uses. And
 * the emerald and the rose were close enough to `--vote-yes` and `--vote-no`
 * that a "vote" event and a "bill" event read as an approval and a rejection
 * — a political signal from a column that is only naming a document type.
 *
 * So the kind is carried by the *icon*, which is already distinct per kind and
 * survives greyscale, and the tint is one brand gold throughout. That is a
 * deliberate trade: six hues do distinguish faster at a glance, but they were
 * distinguishing something that the glyph beside them already says, at the cost
 * of the two false readings above. `activity` keeps the plain muted surface,
 * because it is the catch-all bucket rather than a kind of record.
 */

type EventTypeStyle = {
  Icon: typeof FileText
  /** Foreground and background classes, dark-mode aware. */
  className: string
  /** The dictionary key for this kind's label. Typed `TranslationKey`, so a
   * kind added to `EVENT_TYPES` without an `event.*` string fails the
   * typecheck here rather than rendering a raw key on the page. */
  labelKey: TranslationKey
}

/** The shared tint. One constant rather than six copies of the same string, so
 * the six kinds cannot drift apart again. `text-gold` is the ink tier — these
 * are 14–18 px glyphs, which is exactly the hairline case app/globals.css says
 * the fill tier is too light for. */
const BRAND_TINT = "text-gold bg-gold/10"

export const EVENT_TYPE_STYLES: Record<EventType, EventTypeStyle> = {
  motion: { Icon: FileText, className: BRAND_TINT, labelKey: "event.motion" },
  speech: { Icon: Mic, className: BRAND_TINT, labelKey: "event.speech" },
  vote: { Icon: CheckCircle2, className: BRAND_TINT, labelKey: "event.vote" },
  question: { Icon: HelpCircle, className: BRAND_TINT, labelKey: "event.question" },
  bill: { Icon: FileSignature, className: BRAND_TINT, labelKey: "event.bill" },
  committee: { Icon: Users, className: BRAND_TINT, labelKey: "event.committee" },
  activity: {
    Icon: Activity,
    className: "text-muted-foreground bg-muted",
    labelKey: "event.activity",
  },
}

/**
 * The icon for an event kind, in a tinted square.
 *
 * `aria-hidden`, with no label of its own: every caller renders the kind's name
 * as text beside it, so announcing the icon too would read the same word twice.
 * A caller using this *without* adjacent text has to pass its own label.
 */
export function EventTypeIcon({
  type,
  className,
  size = "default",
}: {
  type: EventType
  className?: string
  size?: "default" | "sm"
}) {
  const { Icon, className: tint } = EVENT_TYPE_STYLES[type]
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        size === "sm" ? "size-6" : "size-9",
        tint,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4.5"} />
    </span>
  )
}
