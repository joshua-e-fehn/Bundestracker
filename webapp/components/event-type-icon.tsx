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
 * read as a second political signal. These are the neutral chart tokens plus a
 * hue per kind, chosen only to be distinguishable from each other.
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

export const EVENT_TYPE_STYLES: Record<EventType, EventTypeStyle> = {
  motion: {
    Icon: FileText,
    className: "text-sky-600 bg-sky-500/10 dark:text-sky-400",
    labelKey: "event.motion",
  },
  speech: {
    Icon: Mic,
    className: "text-violet-600 bg-violet-500/10 dark:text-violet-400",
    labelKey: "event.speech",
  },
  vote: {
    Icon: CheckCircle2,
    className: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
    labelKey: "event.vote",
  },
  question: {
    Icon: HelpCircle,
    className: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
    labelKey: "event.question",
  },
  bill: {
    Icon: FileSignature,
    className: "text-rose-600 bg-rose-500/10 dark:text-rose-400",
    labelKey: "event.bill",
  },
  committee: {
    Icon: Users,
    className: "text-teal-600 bg-teal-500/10 dark:text-teal-400",
    labelKey: "event.committee",
  },
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
