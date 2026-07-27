"use client"

import Link from "next/link"
import { useState } from "react"
import { EVENT_TYPE_STYLES, EventTypeIcon } from "@/components/event-type-icon"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { FeedActor, FeedGroup } from "@/lib/feed-grouping"
import { initials } from "@/lib/format"
import { absoluteDate, relativeDay } from "@/lib/relative-time"
import type { EventType } from "@/lib/taxonomy"
import { cn } from "@/lib/utils"

/**
 * One event in the activity feed.
 *
 * The reference link is the interesting part; see `referenceHref` below.
 *
 * Takes a `FeedGroup` rather than a single event, because one row can be one
 * act by several members: a Kleine Anfrage signed by forty produces forty
 * identical rows in the database, and lib/feed-grouping.ts collapses them. A
 * group of one renders exactly as a lone event did — the common case pays
 * nothing for the joint one.
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

/** How many members a joint row names before it starts counting. Three fits one
 * line at the narrowest layout the feed renders at; the rest are behind the
 * "show all" toggle rather than truncated away. */
const VISIBLE_ACTORS = 3

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
 * Takes the reference pair alone rather than a whole event, so it serves both a
 * lone event and a group without either shape having to be built to satisfy it.
 * Exported so lib tests can pin the arithmetic: an off-by-one in the padding
 * produces a URL that looks entirely correct and 404s, which no typecheck sees.
 */
export function referenceHref(event: {
  referenceId: string | null
  referenceType: string | null
}): string | null {
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
  group,
  nowMs,
  className,
}: {
  group: FeedGroup
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
  const [expanded, setExpanded] = useState(false)
  const href = referenceHref(group)
  const typeLabel = t(EVENT_TYPE_STYLES[group.eventType].labelKey)

  const isJoint = group.actors.length > 1
  const shown = expanded ? group.actors : group.actors.slice(0, VISIBLE_ACTORS)
  const hidden = group.actors.length - shown.length

  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40",
        className,
      )}
    >
      <EventTypeIcon type={group.eventType} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* The timestamp sits outside the wrapping name row rather than inside
            it with `ml-auto`. As a flex item among the names it was pushed onto
            a second line as soon as three of them wrapped, which put "gerade
            eben" below the row it belongs to and above the title it does not.
            Out here it keeps its corner however many names precede it. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {shown.map((actor) => (
              <ActorLink key={actor.mpInternalId} actor={actor} compact={isJoint} />
            ))}

            {/* A button, not a "+37" label: the names are on the page either
                way, and hiding them behind something unclickable would make the
                count a dead end. Expanding is the whole interaction — there is
                no collapse, because a reader who asked for the names has no
                reason to ask for fewer. */}
            {hidden > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-muted-foreground text-xs"
                onClick={() => setExpanded(true)}
              >
                {t("feed.andOthers", { count: hidden })}
              </Button>
            )}

            <span className="text-muted-foreground text-xs">{typeLabel}</span>
          </div>

          <time
            dateTime={group.date}
            title={absoluteDate(group.date, locale)}
            className="shrink-0 text-muted-foreground text-xs"
          >
            {relativeDay(group.date, nowMs, locale)}
          </time>
        </div>

        <p className="text-sm leading-snug">{group.title}</p>

        {group.description !== null && group.description.trim() !== "" && (
          <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
            {group.description}
          </p>
        )}

        {/* Says the row is a collapse and that the order means nothing. The
            second half matters more than it looks: a list of names invites the
            reading that the first one led, and DIP publishes no signing order
            at all — see lib/feed-grouping.ts and `motion_sponsor_payloads` in
            the pipeline, which refuses to store a rank for the same reason. */}
        {isJoint && (
          <p className="text-[0.7rem] text-muted-foreground/80 leading-relaxed">
            {t("feed.jointCount", { count: group.actors.length })} — {t("feed.jointNote")}
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

/**
 * One member of a feed row.
 *
 * `compact` drops the group badge when several names share the line. A joint
 * Anfrage is usually one Fraktion's, so forty identical badges would be forty
 * repetitions of one fact — and at three names plus badges the row wraps to two
 * lines before it has said what the document was. The badge stays on the
 * single-actor row, which is where it distinguishes anything.
 */
function ActorLink({ actor, compact }: { actor: FeedActor; compact: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Link
        href={`/mps/${encodeURIComponent(actor.mpInternalId)}`}
        className="flex items-center gap-2 font-medium text-sm hover:underline"
      >
        <Avatar className="size-6">
          {actor.photoUrl !== null && <AvatarImage src={actor.photoUrl} alt="" />}
          <AvatarFallback className="text-[10px]">{initials(actor.name)}</AvatarFallback>
        </Avatar>
        {actor.name}
      </Link>
      {compact ? null : <PartyBadge fraktion={actor.fraktion} />}
    </span>
  )
}
