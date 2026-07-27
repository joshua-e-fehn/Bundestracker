"use client"

import { useQuery } from "convex/react"
import { PartyCoalitionCard } from "@/components/party-coalition-card"
import { PartyComparisonRadar } from "@/components/party-comparison-radar"
import { PartyDisciplineCard } from "@/components/party-discipline-card"
import { PartyMetricChart } from "@/components/party-metric-chart"
import { PartyScoreTable } from "@/components/party-score-table"
import { SectionHeading } from "@/components/section-heading"
import { CaveatNote } from "@/components/caveat-note"
import { useLocale } from "@/components/providers/locale-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { formatCount } from "@/lib/format"

/**
 * The `/parties` dashboard's client half.
 *
 * Same split as components/rankings.tsx and components/seating.tsx: the route is
 * a server component and everything with a subscription or a `useState` lives
 * below this boundary.
 *
 * ## One query feeds four views
 *
 * The ranked table, the radar and the nine bar charts are three renderings of
 * the same 6×9 grid, and the coalition card is that grid folded into two rows.
 * Fetching it once is not only cheaper — it is what makes them consistent. Four
 * queries would be four chances to disagree about what a Fraktion's mean is, and
 * a table whose top row is not the radar's outermost polygon is a page nobody
 * can trust. Discipline is the exception and has its own query, because it is
 * computed from ballots rather than from scores and carries a read bound the
 * rest do not.
 *
 * ## Loading, empty and partially-swept are three different states
 *
 * `undefined` is Convex still loading, and an empty `parties` array is a real
 * answer — nothing ingested. The third is the one this page has to be careful
 * about: a roster loaded and only partly scored produces means that are true of
 * whoever has a row, which is not the same claim as "this is what the Fraktion
 * does". `parties.coverageGap` states it above the charts rather than letting a
 * partial sweep read as a finding.
 */
export function PartyComparison({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const comparison = useQuery(api.parties.getPartyComparison, { wahlperiode })

  if (comparison === undefined) {
    return (
      <output className="flex flex-col gap-6" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </output>
    )
  }

  if (comparison.parties.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border border-dashed p-8 text-center">
        <p className="font-medium text-sm">{t("common.noData")}</p>
        <p className="text-muted-foreground text-sm">{t("parties.empty")}</p>
      </div>
    )
  }

  const missing = comparison.totalMandates - comparison.totalScored

  return (
    <div className="flex flex-col gap-10">
      {/* The notice that governs every figure below it, above everything and
          unconditional — the same placement, and the same reasoning, as
          `SyntheticSeatingNotice` on /seating. A reader who takes one of these
          bars for a Fraktion total has been misled by us, so this is said before
          they start rather than footnoted after. */}
      <div className="flex flex-col gap-2">
        <CaveatNote>{t("parties.meansNotice")}</CaveatNote>
        <p className="text-muted-foreground text-xs">
          {t("parties.coverage", {
            scored: formatCount(comparison.totalScored, locale),
            mandates: formatCount(comparison.totalMandates, locale),
          })}
          {/* Only when the two diverge. On a fully-swept deployment the sentence
              above already says everything, and a second one saying "0 are
              missing" is noise that trains the reader to skip both.

              The singular is its own key rather than a `{missing}` that reads
              "1 Mandate" — the convention lib/relative-time.ts sets out, made
              by key so each language splits where it actually splits. */}
          {missing > 0 &&
            ` ${
              missing === 1
                ? t("parties.coverageGapOne")
                : t("parties.coverageGap", { missing: formatCount(missing, locale) })
            }`}
        </p>
      </div>

      <section aria-labelledby="party-table-heading" className="flex flex-col gap-4">
        <SectionHeading
          id="party-table-heading"
          titleKey="parties.table.title"
          subtitleKey="parties.table.subtitle"
        />
        <PartyScoreTable parties={comparison.parties} />
        {/* §9 puts fraktionslos at 3 seats against CDU/CSU's 209, so this sits
            under the table that prints both numbers rather than under a chart
            where the seat count is only in a tooltip. */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("parties.smallGroupCaveat")}
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("parties.radar.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t("parties.radar.subtitle")}</p>
          <PartyComparisonRadar parties={comparison.parties} />
          {/* Not optional: a normalised axis says "relative to the leader",
              which is a different claim from the number it was built from, and
              the polygon is unreadable as anything else without this. */}
          <CaveatNote>{t("parties.radarCaveat")}</CaveatNote>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("parties.metrics.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t("parties.metrics.subtitle")}</p>
          <PartyMetricChart parties={comparison.parties} />
        </CardContent>
      </Card>

      <PartyCoalitionCard parties={comparison.parties} wahlperiode={wahlperiode} />

      <PartyDisciplineCard wahlperiode={wahlperiode} />
    </div>
  )
}
