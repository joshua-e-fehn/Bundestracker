"use client"

import { ChevronDown } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { EVENT_TYPE_STYLES, EventTypeIcon } from "@/components/event-type-icon"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { FeedActor, FeedGroup } from "@/lib/feed-grouping"
import type { GroupScore, UnscorableReason } from "@/lib/feed-scoring"
import { formatScore, initials } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"
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
 * The score above which a row is shown at full strength.
 *
 * ⚠ A presentation threshold, not a claim about the data. The task asks for
 * "higher total score = more prominent display", and the honest version of that
 * is a *readability* device: a 40-signature Anfrage carries more weight than a
 * lone one, and a feed where every row shouts equally makes that invisible. It
 * is deliberately not a ranking, a grade, or a colour scale — those would
 * present an editorial weighting as a verdict, which lib/scoring.ts is explicit
 * that the score is not.
 *
 * 25 is the default question weight (3) times eight members: a document with
 * enough signatures to be a group act rather than an individual one. Any
 * threshold here is arbitrary; what matters is that it changes only weight and
 * never hides or reorders anything, so a reader who ignores it loses nothing.
 */
const PROMINENT_SCORE = 25

/** Which caveat explains a missing figure. `Record<UnscorableReason, …>` so a
 * reason added to lib/feed-scoring.ts is a compile error here until it is
 * explained — the guard components/score-breakdown.tsx uses for the same
 * reason, and the same editorial rule: a limit is stated beside the figure it
 * qualifies, not under an "about" link. */
const UNSCORABLE_REASON_KEYS: Record<UnscorableReason, TranslationKey> = {
  rate: "feed.score.reason.rate",
  perWord: "feed.score.reason.perWord",
  standing: "feed.score.reason.standing",
  unrecognised: "feed.score.reason.unrecognised",
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
  score,
  nowMs,
  className,
}: {
  group: FeedGroup
  /**
   * What this row contributed to its members' activity scores.
   *
   * Passed in rather than computed here, because the weights are the reader's:
   * a signed-in user re-weights their own view (`userPreferences.customWeights`)
   * and every row must move together when a slider does. Computing per row would
   * also re-derive the same answer for every row in a group of forty — see
   * lib/feed-scoring.ts, where the group's members are identical by
   * construction.
   */
  score: GroupScore
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
  // Derived from the group's own id rather than `useId`: it is already unique
  // and stable across the page merges lib/feed-grouping.ts describes, so the
  // `aria-controls` association survives a later page folding into this group.
  const actorsId = `feed-actors-${group.id}`

  const isJoint = group.actors.length > 1
  const shown = expanded ? group.actors : group.actors.slice(0, VISIBLE_ACTORS)
  const hidden = group.actors.length - shown.length

  // Weight, not visibility: a quiet row is still a whole row. See PROMINENT_SCORE.
  const prominent = score.total !== null && score.total >= PROMINENT_SCORE

  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40",
        // A joint act gets a slightly stronger surface so a row standing for
        // forty members is distinguishable from one standing for one at a
        // glance, before any number is read.
        isJoint && "bg-muted/20",
        prominent && "border-border/80 shadow-xs",
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
            {/* The id sits on the names alone, not on this whole row. The toggle
                below carries `aria-controls={actorsId}`, and a control that is a
                *descendant* of the region it names is a circular reference — the
                region a screen reader is told to look at would contain the
                button that pointed it there. Wrapping only the list keeps the
                two as siblings, which is the association that actually holds.
                `contents` so the wrapper adds no box of its own and the names
                keep wrapping as flex items of the row. */}
            <span id={actorsId} className="contents">
              {shown.map((actor) => (
                <ActorLink
                  key={actor.mpInternalId}
                  actor={actor}
                  compact={isJoint}
                  // The individual contribution, but only once the reader has
                  // opened the list and only on a joint row. Every member scores
                  // the same (lib/feed-scoring.ts), so on a collapsed row it
                  // would be the same figure repeated three times beside the
                  // group total it is already derived from — noise. Expanded, it
                  // answers "and what did each of them get", which is the
                  // question the disclosure was opened to ask.
                  points={
                    expanded && isJoint && score.per.kind === "scored" ? score.per.points : null
                  }
                />
              ))}
            </span>

            {/* A button, not a "+37" label: the names are on the page either
                way, and hiding them behind something unclickable would make the
                count a dead end.

                Two-way, unlike the original one-way expand. That changed when
                the disclosure started carrying a per-member score line as well
                as the names: forty rows of "Anfrage × 3,0" is a wall a reader
                opens once to check the arithmetic and then wants out of the way,
                which is a reason to ask for fewer that names alone did not give
                them. `aria-expanded` and `aria-controls` because this is now a
                genuine disclosure rather than a one-shot reveal. */}
            {(hidden > 0 || expanded) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-muted-foreground text-xs"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                aria-controls={actorsId}
              >
                {expanded ? t("feed.collapseActors") : t("feed.andOthers", { count: hidden })}
                <ChevronDown
                  aria-hidden
                  className={cn("size-3 transition-transform", expanded && "rotate-180")}
                />
              </Button>
            )}

            <span className="text-muted-foreground text-xs">{typeLabel}</span>
          </div>

          {/* Score and timestamp share the corner, score first: it is the
              thing this row is being differentiated by, and the date is
              already implied by the row's position in a chronological feed. */}
          <div className="flex shrink-0 items-center gap-2">
            <ScoreBadge score={score} prominent={prominent} />
            <time
              dateTime={group.date}
              title={absoluteDate(group.date, locale)}
              className="text-muted-foreground text-xs"
            >
              {relativeDay(group.date, nowMs, locale)}
            </time>
          </div>
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
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <FraktionCluster actors={group.actors} />
              <span className="font-medium text-muted-foreground text-xs">
                {t("feed.jointCount", { count: group.actors.length })}
              </span>
              {/* The arithmetic behind the badge, so the figure can be checked
                  rather than trusted. One multiplication is honest here only
                  because every member of a group scores identically — the
                  grouping key contains both fields the score reads. See
                  lib/feed-scoring.ts. */}
              {score.per.kind === "scored" && (
                <span className="text-[0.7rem] text-muted-foreground tabular-nums">
                  {t("feed.score.perMember", {
                    count: group.actors.length,
                    points: formatScore(score.per.points, locale),
                  })}
                </span>
              )}
            </div>
            <p className="text-[0.7rem] text-muted-foreground leading-relaxed">
              {t("feed.jointNote")}
            </p>
          </div>
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
 * What the row contributed to its members' scores — or why it contributed
 * nothing apportionable.
 *
 * Two shapes rather than one with a fallback string, because they are two
 * different claims. A figure says "this much"; the muted form says the score
 * exists but does not divide into per-record parts, and names which of
 * lib/scoring.ts's three structural limits applies. Rendering the second as
 * "0,0" would state the first, which is the failure this whole module is
 * arranged to avoid.
 *
 * The tooltip carries the reason rather than a caveat box: nine of these can
 * appear in one screen of feed, and nine boxes would bury the entries they
 * annotate. The text is the same editorial register components/caveat-note.tsx
 * uses — a limit stated beside the figure it qualifies.
 */
function ScoreBadge({ score, prominent }: { score: GroupScore; prominent: boolean }) {
  const { t, locale } = useLocale()

  if (score.total === null) {
    const reason = score.per.kind === "unscorable" ? score.per.reason : "unrecognised"
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A real `<button type="button">` rather than a `<span tabIndex={0}>`.
              There is nothing to activate, but the explanation has to be
              reachable without a pointer, and putting a non-interactive element
              in the tab order announces it as unlabelled and un-actionable.
              A button carries the focus and the accessible name for free;
              `cursor-help` and the dotted underline mark it as annotated rather
              than clickable. */}
          <button
            type="button"
            className="cursor-help rounded-sm text-[0.7rem] text-muted-foreground/80 underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t("feed.score.unscorable")}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[18rem]">
          {t(UNSCORABLE_REASON_KEYS[reason])}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span
      // `tabular-nums` so a column of these does not jitter as digits change.
      // The prominent form is heavier text on a stronger surface, never a
      // different hue: a colour scale would grade parliamentary work, and the
      // score is explicitly not a verdict (lib/scoring.ts).
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[0.7rem] tabular-nums",
        prominent
          ? "bg-primary/10 font-semibold text-foreground"
          : "bg-muted font-medium text-muted-foreground",
      )}
      title={t("feed.score.label")}
    >
      {t("feed.score.total", { points: formatScore(score.total, locale) })}
    </span>
  )
}

/**
 * The Fraktionen behind a joint act, each named once.
 *
 * Groups rather than faces, and that is the point: a Kleine Anfrage's forty
 * signatories are usually one Fraktion, so forty portraits would be forty
 * repetitions of one fact, while "SPD · GRÜNE" says the thing a reader actually
 * wants from a glance — whether this was one group's act or a cross-party one.
 * The task asks for a "stacked avatar or party-badge cluster"; this is the
 * badge-cluster arm, chosen because the avatars are already on the row above.
 *
 * Sorted by how many members each group contributed, so the largest reads
 * first. That is a statement about *this document* — a count the data supports —
 * and not about seniority, which DIP does not publish and which
 * lib/feed-grouping.ts refuses to imply for individuals. Ties break on the name
 * so the order is stable rather than dependent on ingestion order.
 */
function FraktionCluster({ actors }: { actors: readonly FeedActor[] }) {
  const counts = new Map<string, number>()
  for (const actor of actors) {
    if (actor.fraktion === "") continue
    counts.set(actor.fraktion, (counts.get(actor.fraktion) ?? 0) + 1)
  }

  const ranked = [...counts.entries()].sort(
    ([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB, "de"),
  )
  if (ranked.length === 0) return null

  // Three, matching VISIBLE_ACTORS above: the same "how much fits on a row"
  // budget, and a cluster wider than the names it summarises would defeat the
  // purpose. A cross-party act with more than three groups is rare enough that
  // the remainder counts rather than wraps.
  const shown = ranked.slice(0, VISIBLE_ACTORS)
  const rest = ranked.length - shown.length

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map(([fraktion, count]) => (
        <span key={fraktion} className="flex items-center gap-0.5">
          <PartyBadge fraktion={fraktion} />
          {/* The per-group count only where it distinguishes something. On a
              single-group act it would restate the total already beside it. */}
          {ranked.length > 1 && (
            <span className="text-[0.65rem] text-muted-foreground tabular-nums">{count}</span>
          )}
        </span>
      ))}
      {rest > 0 && <span className="text-[0.65rem] text-muted-foreground">+{rest}</span>}
    </span>
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
function ActorLink({
  actor,
  compact,
  points,
}: {
  actor: FeedActor
  compact: boolean
  /** This member's own contribution, or null to omit it. See the call site for
   * why it is only ever passed on an expanded joint row. */
  points: number | null
}) {
  const { t, locale } = useLocale()

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
      {points !== null && (
        <span className="text-[0.7rem] text-muted-foreground tabular-nums">
          {t("feed.score.total", { points: formatScore(points, locale) })}
        </span>
      )}
    </span>
  )
}
