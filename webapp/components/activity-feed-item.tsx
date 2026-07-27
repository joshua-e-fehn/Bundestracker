"use client"

import Link from "next/link"
import { EVENT_TYPE_STYLES, EventTypeIcon } from "@/components/event-type-icon"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initials } from "@/lib/format"
import { absoluteDate, relativeDay } from "@/lib/relative-time"
import type { EventType } from "@/lib/taxonomy"
import { cn } from "@/lib/utils"

/**
 * One event in the activity feed.
 *
 * The reference link is the interesting part; see `referenceHref` below.
 */

export type FeedEvent = {
  id: string
  mpInternalId: string
  eventType: EventType
  date: string
  title: string
  description: string | null
  referenceId: string | null
  referenceType: string | null
  name: string
  fraktion: string
  photoUrl: string | null
}

/**
 * Where an event's source record can be read — the "reference link".
 *
 * `referenceType`/`referenceId` point back at the row an event came from, in
 * whatever id space that type names (see `activityEventInput` in
 * convex/schema.ts). Those id spaces are *internal*: a Convex id for a motion,
 * a DIP activity id. None of them is a URL, and Bundestrack has no page for
 * most of them yet.
 *
 * So the link points at the **Bundestag's own document server** rather than at
 * a Bundestrack route, using the reconstruction rules in §8 of
 * docs/api-research.md. That is the better destination on the merits, not a
 * fallback: Bundestrack's premise is that every figure is backed by a Bundestag
 * record (AGENTS.md), and "Zum Nachweis" should reach the record itself.
 *
 * Two shapes are reconstructible and both are verified in the research:
 *
 *  - **Drucksache PDF** — `btd/<wp>/<nr÷100:03d>/<wp><nr:05d>.pdf`. The
 *    Drucksache number is zero-padded to five digits and the directory block is
 *    `number ÷ 100` padded to three. §8 gives `21/7327` →
 *    `btd/21/073/2107327.pdf`.
 *  - **Plenary protocol PDF** — `btp/<wp>/<wp><sitzung:03d>.pdf`, verified
 *    against all 86 WP21 protocols (§5.1).
 *
 * ⚠ **Bundestag-issued papers only.** §5.1 warns that Bundesrat numbering is a
 * bare running number with no `wp/nr` form, so a `split("/")` on one misparses
 * into a plausible wrong URL. The parse below requires both halves to be
 * digits and rejects anything else, which is why this returns null rather than
 * guessing — a link that 404s tells the reader the record is missing, when what
 * is missing is only our ability to address it.
 *
 * Exported so lib tests can pin the arithmetic: an off-by-one in the padding
 * produces a URL that looks entirely correct and 404s, which no typecheck sees.
 */
export function referenceHref(event: FeedEvent): string | null {
  const id = event.referenceId
  if (id === null) return null

  switch (event.referenceType) {
    /** `drucksacheNr`, as `21/7327`. */
    case "drucksache": {
      const match = /^(\d+)\/(\d+)$/.exec(id.trim())
      if (!match) return null
      const wp = Number(match[1])
      const nr = Number(match[2])
      const block = String(Math.floor(nr / 100)).padStart(3, "0")
      const paper = `${wp}${String(nr).padStart(5, "0")}`
      return `https://dserver.bundestag.de/btd/${wp}/${block}/${paper}.pdf`
    }
    /** `<wahlperiode>/<sitzungnr>`, as `21/90`. */
    case "plenarprotokoll": {
      const match = /^(\d+)\/(\d+)$/.exec(id.trim())
      if (!match) return null
      const wp = Number(match[1])
      const sitting = String(Number(match[2])).padStart(3, "0")
      return `https://dserver.bundestag.de/btp/${wp}/${wp}${sitting}.pdf`
    }
    // Every other id space — Convex ids, DIP Vorgang and Aktivität ids — names
    // a row, not a document. There is no public URL to send the reader to, so
    // the row renders without a reference link rather than with a dead one.
    default:
      return null
  }
}

export function ActivityFeedItem({
  event,
  nowMs,
  className,
}: {
  event: FeedEvent
  /**
   * "Now", passed in rather than read here.
   *
   * Two reasons, and the first is a real bug: `Date.now()` in a component body
   * returns a different value on the server and on the client, so React's
   * hydration pass sees "vor 2 Stunden" against "vor 3 Stunden" and warns. The
   * second is that one list should agree with itself — fifty rows each reading
   * the clock can straddle midnight and label two events from the same day
   * differently.
   */
  nowMs: number
  className?: string
}) {
  const { t, locale } = useLocale()
  const href = referenceHref(event)
  const typeLabel = t(EVENT_TYPE_STYLES[event.eventType].labelKey)

  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40",
        className,
      )}
    >
      <EventTypeIcon type={event.eventType} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/mps/${encodeURIComponent(event.mpInternalId)}`}
            className="flex items-center gap-2 font-medium text-sm hover:underline"
          >
            <Avatar className="size-6">
              {event.photoUrl !== null && <AvatarImage src={event.photoUrl} alt="" />}
              <AvatarFallback className="text-[10px]">{initials(event.name)}</AvatarFallback>
            </Avatar>
            {event.name}
          </Link>
          <PartyBadge fraktion={event.fraktion} />
          <span className="text-muted-foreground text-xs">{typeLabel}</span>
          <time
            dateTime={event.date}
            title={absoluteDate(event.date, locale)}
            className="ml-auto shrink-0 text-muted-foreground text-xs"
          >
            {relativeDay(event.date, nowMs, locale)}
          </time>
        </div>

        <p className="text-sm leading-snug">{event.title}</p>

        {event.description !== null && event.description.trim() !== "" && (
          <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
            {event.description}
          </p>
        )}

        {href !== null && (
          // A plain anchor, not next/link: this leaves the app for
          // dserver.bundestag.de, so there is no route to prefetch. `noreferrer`
          // alongside `noopener` so the Bundestag's logs do not receive the
          // reader's Bundestrack page as a referrer.
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-primary text-xs hover:underline"
          >
            {t("feed.reference")}
          </a>
        )}
      </div>
    </article>
  )
}
