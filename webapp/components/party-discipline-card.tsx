"use client"

import { useQuery } from "convex/react"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { formatCount, formatRate } from "@/lib/format"
import { partyByKey, partyColor, type PartyKey } from "@/lib/parties"

/**
 * How often each Fraktion's members vote with their own group's majority.
 *
 * ## The number is nearly always high, and the caveat is the point
 *
 * Almost every named ballot is whipped and near-unanimous inside every group, so
 * the level says little and the *gap* between 97 % and 99 % says a great deal.
 * A reader who takes 98 % as "quite disciplined" has learned nothing;
 * `parties.disciplineCaveat` is what turns the column into a comparison rather
 * than a grade. That is why the bar is scaled against the range in view rather
 * than against 100 % — see `Bar` below.
 *
 * ## The window is stated, because a rate over an unnamed subset means nothing
 *
 * `getPartyDiscipline` reads every vote record on the ballots it examines —
 * ~630 per ballot — so it bounds itself at 20 by default, exactly as
 * `getCrossPartyRankings` does and for the same read-limit arithmetic. The
 * response carries `ballotsExamined` and this card prints it. A period-wide
 * figure needs the tally maintained at ingest, which is a schema change.
 *
 * ## `formatRate`, not `formatPercent`
 *
 * One decimal place. Whole percents would collapse the entire interesting range
 * — six groups clustered between 97 % and 100 % — onto four visible values while
 * the column still sorted invisibly beneath them. The same reason lib/format.ts
 * gives for the participation column, and it bites harder here.
 */
export function PartyDisciplineCard({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const discipline = useQuery(api.parties.getPartyDiscipline, { wahlperiode })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("parties.discipline.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{t("parties.discipline.subtitle")}</p>

        {discipline === undefined ? (
          <output className="flex flex-col gap-2" aria-live="polite">
            <span className="sr-only">{t("common.loading")}</span>
            {Array.from({ length: 5 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <Skeleton key={index} className="h-10 w-full rounded-md" />
            ))}
          </output>
        ) : discipline.parties.length === 0 ? (
          // No ballot in the window produced a group line — either nothing has
          // been ingested, or every group split exactly, which is vanishingly
          // rare but is not an error.
          <p className="rounded-lg border border-border border-dashed p-6 text-center text-muted-foreground text-sm">
            {t("parties.discipline.empty")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("parties.column.party")}</TableHead>
                    <TableHead className="w-[45%]">{t("parties.discipline.column.rate")}</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">
                      {t("parties.discipline.column.against")}
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      {t("parties.discipline.column.ballots")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discipline.parties.map((row) => (
                    <DisciplineRow
                      key={row.partyKey}
                      partyKey={row.partyKey}
                      rate={row.rate}
                      against={row.against}
                      ballots={row.ballots}
                      // The floor of the drawn scale, computed over the rows in
                      // view — see `Bar`.
                      floor={scaleFloor(discipline.parties.map((entry) => entry.rate))}
                      locale={locale}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Which ballots this was computed over. Stated rather than left
                implicit, because the figure is only true of that window. */}
            <p className="text-muted-foreground text-xs">
              {t("parties.discipline.window", {
                count: formatCount(discipline.ballotsExamined, locale),
              })}
            </p>
          </>
        )}

        <CaveatNote>{t("parties.disciplineCaveat")}</CaveatNote>
      </CardContent>
    </Card>
  )
}

/**
 * Where the drawn scale starts.
 *
 * Bars from 0 % would be six near-identical full-width blocks: the whole spread
 * lives in the top few percent, so a 0-based axis draws the one thing this table
 * is for as no difference at all. The floor is set a little below the weakest
 * group so the *differences* are what the eye reads.
 *
 * ⚠ A truncated axis is normally a way to exaggerate, so two things keep it
 * honest: the exact rate is printed beside every bar, and the caveat says in
 * words that the gap rather than the level is the signal. Capped at 90 % so a
 * genuinely split group — which would be a real finding — is still drawn short
 * rather than being rescaled to look ordinary.
 */
function scaleFloor(rates: readonly number[]): number {
  const lowest = Math.min(...rates)
  if (!Number.isFinite(lowest)) return 0
  return Math.min(0.9, Math.max(0, lowest - 0.02))
}

function DisciplineRow({
  partyKey,
  rate,
  against,
  ballots,
  floor,
  locale,
}: {
  partyKey: PartyKey
  rate: number
  against: number
  ballots: number
  floor: number
  locale: Parameters<typeof formatRate>[1]
}) {
  const party = partyByKey(partyKey)
  const color = partyColor(party.label)
  // Normalised into the truncated window. `span <= 0` is every group on the
  // same rate — a real answer, drawn as full bars rather than as a division by
  // zero that would render NaN widths and collapse the column.
  const span = 1 - floor
  const percent = span <= 0 ? 100 : Math.max(0, Math.min(100, ((rate - floor) / span) * 100))

  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2 font-medium">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          {party.label}
        </span>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-3">
          <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${percent}%`, backgroundColor: color }}
            />
          </div>
          {/* One decimal place — see the header. The printed figure is the true
              rate, not the truncated scale's position. */}
          <span className="w-14 shrink-0 text-right font-medium text-xs tabular-nums">
            {formatRate(rate, locale)}
          </span>
        </div>
      </TableCell>

      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
        {formatCount(against, locale)}
      </TableCell>

      <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
        {formatCount(ballots, locale)}
      </TableCell>
    </TableRow>
  )
}
