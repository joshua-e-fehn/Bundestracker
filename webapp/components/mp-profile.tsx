"use client"

import Link from "next/link"
import { ActivityHeatmap } from "@/components/activity-heatmap"
import { FraktionBadge } from "@/components/fraktion-badge"
import { MPCommittees } from "@/components/mp-committees"
import { MPPhoto } from "@/components/mp-photo"
import { MPRecentRecords } from "@/components/mp-recent-records"
import { MPScorePanel } from "@/components/mp-score-panel"
import { useLocale } from "@/components/providers/locale-provider"
import { TrendGraphs } from "@/components/trend-graphs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/bundestag"
import type { Locale } from "@/lib/i18n"

/**
 * The profile: who this MP is, what they have done, and how it was scored.
 *
 * A sidebar of things that are true of the *person* — portrait, group,
 * constituency, biography, committee seats — beside a main column of things
 * they *did*: the score and its parts, the contribution graph, and the most
 * recent speeches, motions and votes.
 *
 * A client component because three of those panels are interactive (the weight
 * sliders, the heatmap's tooltips) and the rest subscribe: an ingest landing
 * while the page is open should update it. The roster row itself arrives from
 * the server, already fetched — see app/mps/[id]/page.tsx.
 */

export type MPDoc = {
  internalId: string
  name: string
  fraktion: string
  party: string
  constituency: string | null
  photoUrl: string | null
  bio: string | null | undefined
  birthDate: string | null
  education: string | null | undefined
  profession: string | null | undefined
  electionMethod: string | null
  datesInOffice: { start: string; end: string | null } | null
}

export function MPProfile({
  mp,
  wahlperiode,
  today,
}: {
  mp: MPDoc
  wahlperiode: number
  today: string
}) {
  const { t, locale } = useLocale()

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/mps"
        className="text-muted-foreground text-sm hover:text-foreground hover:underline"
      >
        ← {t("mp.backToList")}
      </Link>

      {/* `minmax(0,1fr)` on the base single-column track, not only on the `lg:`
          two-column one. A grid item's `min-width` defaults to `auto`, which
          means "at least as wide as my content" — so below `lg` the one column
          sized itself to the widest thing in either child and the page grew to
          737 px inside a 375 px viewport, scrolling the whole profile sideways.
          The `lg:` track already said `minmax(0,1fr)` for this reason; the
          narrow case needed the same and did not have it. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 pt-2 text-center">
              <MPPhoto name={mp.name} photoUrl={mp.photoUrl} className="size-28" />
              <div className="flex flex-col items-center gap-2">
                <h1 className="font-semibold text-2xl tracking-tight">{mp.name}</h1>
                <FraktionBadge fraktion={mp.fraktion} />
                {/* The party, when it differs from the group. `CDU` inside
                    `CDU/CSU` is not news; a `fraktionslos` MP's former party
                    is. The two are separate columns in the schema precisely
                    because they are not the same thing. */}
                {mp.party && mp.party !== mp.fraktion ? (
                  <span className="text-muted-foreground text-sm">{mp.party}</span>
                ) : null}
                <span className="text-muted-foreground text-sm">
                  {mp.constituency ?? t("mps.listMandate")}
                </span>
              </div>
            </CardContent>
          </Card>

          <Biography mp={mp} locale={locale} />
          <MPCommittees mpInternalId={mp.internalId} wahlperiode={wahlperiode} />
        </aside>

        <div className="flex flex-col gap-6">
          <MPScorePanel mpInternalId={mp.internalId} wahlperiode={wahlperiode} />

          <Card>
            <CardHeader>
              <CardTitle>{t("heatmap.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityHeatmap mpInternalId={mp.internalId} locale={locale} today={today} />
            </CardContent>
          </Card>

          {/* Above the "latest five" panels, not below them: the heatmap says
              which days were busy and this says whether that is rising or
              falling, so the two graphs sit together and the record lists
              follow. */}
          <TrendGraphs mpInternalId={mp.internalId} wahlperiode={wahlperiode} />

          <MPRecentRecords mpInternalId={mp.internalId} wahlperiode={wahlperiode} />
        </div>
      </div>
    </div>
  )
}

/**
 * Education, profession, birth date, mandate type and span.
 *
 * Every field here is nullable in the schema and most are null in practice, so
 * the panel renders only what exists and says so plainly when nothing does —
 * rather than printing five labels with five dashes after them, which looks
 * like a broken page instead of a sparse record.
 */
function Biography({ mp, locale }: { mp: MPDoc; locale: Locale }) {
  const { t } = useLocale()

  const rows: Array<{ label: string; value: string }> = []
  if (mp.birthDate) rows.push({ label: t("mp.birthDate"), value: formatDate(mp.birthDate, locale) })
  if (mp.profession) rows.push({ label: t("mp.profession"), value: mp.profession })
  if (mp.education) rows.push({ label: t("mp.education"), value: mp.education })
  if (mp.electionMethod) rows.push({ label: t("mp.electionMethod"), value: mp.electionMethod })
  if (mp.datesInOffice) {
    // An open `end` means still serving — that is how §6.2 reconciles 635 rows
    // to 630 seats, so it renders as words rather than as a blank after the
    // dash, which would read as a missing date.
    const start = formatDate(mp.datesInOffice.start, locale)
    const end = mp.datesInOffice.end
      ? formatDate(mp.datesInOffice.end, locale)
      : t("mp.stillServing")
    rows.push({ label: t("mp.datesInOffice"), value: `${start} – ${end}` })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mp.biography")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 && !mp.bio ? (
          <p className="text-muted-foreground text-sm">{t("mp.noBiography")}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-2.5">
              {rows.map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground text-xs">{row.label}</dt>
                  <dd className="text-sm">{row.value}</dd>
                </div>
              ))}
            </dl>
            {mp.bio ? <p className="text-sm leading-relaxed">{mp.bio}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
