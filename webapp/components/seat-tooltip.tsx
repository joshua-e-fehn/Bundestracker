"use client"

import { MPPhoto } from "@/components/mp-photo"
import { PartyBadge } from "@/components/party-badge"
import { useLocale } from "@/components/providers/locale-provider"
import { occupationOf } from "@/lib/bundestag"
import { formatCount, formatPercent, formatScore } from "@/lib/format"
import type { SeatingColorMode } from "@/lib/seating"

/**
 * What one seat says when pointed at.
 *
 * Extracted from the map rather than inlined because it is the only part of the
 * diagram that carries *numbers* — a dot's colour states a bucket, this states
 * the value behind it. `heatmapLevel`'s reasoning applies: the ramp is relative
 * and therefore not comparable between chambers, so the real figure has to be
 * reachable somewhere, and this is where.
 *
 * The surface and the positioning belong to `components/seating-map.tsx`, which
 * owns the hover — this is the contents and nothing else. That split is why the
 * map could replace a per-seat Radix `Tooltip` with one pointer-tracked card
 * without touching this file.
 *
 * ## The active mode's figure leads
 *
 * All four figures are shown, but the one the map is currently coloured by is
 * emphasised. A reader comparing two seats is comparing the thing they selected,
 * and making them find it in a list of four is how a tooltip becomes a table
 * nobody reads.
 *
 * ## An unscored MP says so
 *
 * `score === null` renders "no score computed", never a zero. The distinction is
 * the same one `seatingLevel` preserves in the colours: an MP the nightly sweep
 * has not reached and an MP who did nothing are different claims, and printing
 * "0" asserts the second.
 */

export type SeatTooltipData = {
  name: string
  fraktion: string
  constituency: string | null
  /**
   * `BERUF` from Stammdaten. Free text and frequently absent, so the line is
   * omitted rather than rendered empty — see the row below.
   *
   * `| undefined` as well as `| null`, and that is not tidiness. This field is
   * newer than the deployed `getSeatingWithMPs`, so a browser running this
   * build against a backend that has not been redeployed yet receives rows
   * without the key at all. During a deploy that window is every reader. The
   * first version of this narrowed on `!== null`, which `undefined` passes —
   * and the `.trim()` after it threw, taking the whole seating page to its
   * error boundary the moment a seat was hovered. Absent and null mean the
   * same thing here ("no profession recorded"), so both are handled the same.
   */
  profession: string | null | undefined
  /** abgeordnetenwatch's `occupation` — what the MP does *now*, where
   * `profession` is what they did before. Preferred by `occupationOf` when both
   * exist, because the tooltip has room for one line. Typed `| undefined` for
   * exactly the reason above. */
  occupation: string | null | undefined
  photoUrl: string | null
  seatLabel: string
  totalScore: number | null
  voteParticipationRate: number | null
  committeeCount: number
}

export function SeatTooltip({ seat, mode }: { seat: SeatTooltipData; mode: SeatingColorMode }) {
  const { t, locale } = useLocale()

  return (
    <div className="flex min-w-56 max-w-72 flex-col gap-2">
      <div className="flex items-center gap-2">
        <MPPhoto name={seat.name} photoUrl={seat.photoUrl} className="size-8 shrink-0" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-sm">{seat.name}</span>
          {seat.constituency !== null && (
            <span className="truncate text-muted-foreground text-xs">{seat.constituency}</span>
          )}
        </div>
      </div>

      <PartyBadge fraktion={seat.fraktion} className="w-fit" />

      {/* Omitted entirely when absent, not rendered as an empty row: neither
          source covers the whole roster, and a blank line beside a label reads
          as a value that failed to load.

          One line, not two — the tooltip is 224–288 px wide. `occupationOf`
          picks the current occupation over the former profession and is shared
          with the table and the profile, so the same MP does not read as a
          lawyer here and an MdB there. Its `?.trim()` also covers the field
          being *missing* against a backend that predates it; see the type. */}
      {occupationOf(seat) ? (
        <p className="line-clamp-2 text-muted-foreground text-xs leading-snug">
          {occupationOf(seat)}
        </p>
      ) : null}

      <dl className="flex flex-col gap-0.5 text-xs">
        <Figure
          label={t("mp.activityScore")}
          // The gap the whole null-versus-zero rule exists to keep visible.
          value={
            seat.totalScore === null ? t("seating.noScore") : formatScore(seat.totalScore, locale)
          }
          emphasised={mode === "activity"}
        />
        <Figure
          label={t("seating.mode.attendance")}
          value={
            seat.voteParticipationRate === null
              ? t("seating.noScore")
              : formatPercent(seat.voteParticipationRate, locale)
          }
          emphasised={mode === "attendance"}
        />
        <Figure
          label={t("mp.committees")}
          value={formatCount(seat.committeeCount, locale)}
          emphasised={mode === "committee"}
        />
      </dl>

      {/* The synthetic seat label, last and muted. It is the one figure here
          that is invented rather than measured (§9), so it must not sit at the
          top reading like an official seat number. */}
      <p className="text-[10px] text-muted-foreground">{seat.seatLabel}</p>
    </div>
  )
}

function Figure({
  label,
  value,
  emphasised,
}: {
  label: string
  value: string
  emphasised: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasised ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</dd>
    </div>
  )
}
