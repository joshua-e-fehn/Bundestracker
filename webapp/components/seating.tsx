"use client"

import { useQuery } from "convex/react"
import { useState } from "react"
import { CaveatNote } from "@/components/caveat-note"
import { ColorModeToggle } from "@/components/color-mode-toggle"
import { useLocale } from "@/components/providers/locale-provider"
import { SeatingLegend } from "@/components/seating-legend"
import { SeatingMap, type SeatingMapSeat } from "@/components/seating-map"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { formatCount } from "@/lib/format"
import { DEFAULT_SEATING_MODE, type SeatingColorMode, seatingMode } from "@/lib/seating"

/**
 * The seating page's client half: mode state, the two queries, and the states
 * around them.
 *
 * Same split as `components/rankings.tsx` — the route is a server component and
 * everything with a subscription or a `useState` lives below this boundary, so
 * what ships as JS is the map rather than the page.
 *
 * ## Loading, empty and generated are three different things
 *
 * `undefined` is Convex still loading; `[]` is a real answer. And an empty arc
 * has its own cause worth naming: the seating rows are *derived*, by
 * `seating/generate`, from a roster that must be ingested first. So a deployment
 * can hold a full roster and no seats — which is not an error and not "the
 * Bundestag is empty", and the empty state says which. Every section in this app
 * distinguishes loading from loaded-and-empty for the same reason.
 */
export function Seating({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const [mode, setMode] = useState<SeatingColorMode>(DEFAULT_SEATING_MODE)

  const seats = useQuery(api.seating.getSeatingWithMPs, { wahlperiode })
  const fractionSizes = useQuery(api.mps.getFractionSizes, { wahlperiode })

  const definition = seatingMode(mode)

  if (seats === undefined) {
    return (
      <output className="flex flex-col gap-4" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-10 w-full max-w-md rounded-md" />
        {/* Roughly the arc's aspect ratio, so the page does not jump when the
            chamber arrives. */}
        <Skeleton className="aspect-[2/1] w-full rounded-lg" />
      </output>
    )
  }

  if (seats.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">{t("seating.empty")}</p>
        <p className="text-muted-foreground text-xs">{t("seating.emptyHint")}</p>
      </div>
    )
  }

  const rows: SeatingMapSeat[] = seats.map((entry) => ({
    mpInternalId: entry.mpInternalId,
    name: entry.name,
    fraktion: entry.fraktion,
    constituency: entry.constituency,
    // `?? null` so a backend that predates this field — the deploy window, and
    // any preview pointed at an older deployment — yields the same "not
    // recorded" the schema means by null, rather than an `undefined` that the
    // tooltip's narrowing would have to guard separately. See `SeatTooltipData`.
    profession: entry.profession ?? null,
    // `?? null` for the same deploy-window reason as `profession` above.
    electionMethod: entry.electionMethod ?? null,
    photoUrl: entry.photoUrl,
    // `?? null` for the same deploy-window reason as `profession` above — this
    // field is newer than the deployed `getSeatingWithMPs`, and `MPPhoto` shows
    // initials rather than an uncredited portrait when it is missing.
    photoCredit: entry.photoCredit ?? null,
    seatLabel: entry.seat.seatLabel,
    row: entry.seat.row,
    column: entry.seat.column,
    // Null, not 0, all the way through to the colour and the tooltip: an
    // unscored MP is not an inactive one. See `seatingLevel`.
    totalScore: entry.score?.totalScore ?? null,
    voteParticipationRate: entry.score?.voteParticipationRate ?? null,
    committeeCount: entry.committeeCount,
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {/* `min-w-0` here as well as inside the toggle: the wrap container is
            itself a flex item, and one `auto` minimum anywhere in the chain is
            enough to keep the tab strip from shrinking. */}
        <ColorModeToggle value={mode} onChange={setMode} className="min-w-0 flex-1" />
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("seating.seatCount", { count: formatCount(rows.length, locale) })}
        </p>
      </div>

      <SeatingMap seats={rows} mode={mode} wahlperiode={wahlperiode} />

      <SeatingLegend mode={mode} fractionSizes={fractionSizes ?? []} />

      {/* The active mode's structural limit, where it has one. Beside the map
          rather than behind a link, matching how the leaderboards carry theirs:
          each is a case where a colour could be read as a finding the sources do
          not support. */}
      {definition?.caveatKey !== undefined && <CaveatNote>{t(definition.caveatKey)}</CaveatNote>}
    </div>
  )
}
