import Link from "next/link"
import { FraktionBadge } from "@/components/fraktion-badge"
import { MPPhoto } from "@/components/mp-photo"
import { Card } from "@/components/ui/card"
import { formatNumber } from "@/lib/bundestag"
import { heatmapLevel } from "@/lib/heatmap"
import type { Locale } from "@/lib/i18n"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * One MP, at a glance — photo, name, group, score, and a sparkline of recent
 * months.
 *
 * A server component: nothing here is interactive beyond the link, and the
 * whole card is public data (AGENTS.md's default — client components only where
 * interactivity is needed). The caller passes the data in rather than the card
 * querying for it, because the places that show cards show many, and a query
 * per card is the shape `mpLabel` exists to avoid.
 *
 * The mini heatmap is *monthly*, unlike the daily grid on the profile. Twelve
 * cells fit in a card; 365 do not, and shrinking them below a pixel would draw
 * a line rather than a graph. It reads `activityScores`' monthly rows, which is
 * the grain those rows exist at.
 */

export type MPCardData = {
  internalId: string
  name: string
  fraktion: string
  constituency: string | null
  photoUrl: string | null
  /** Period total under the stored (default) weights. Null when the cron has
   * not scored this MP — distinct from a score of zero, and rendered as such. */
  totalScore: number | null
  /** Recent months, oldest first, as `{month, count}`. Empty is fine; the strip
   * simply does not render. */
  monthlyActivity?: ReadonlyArray<{ month: string; count: number }>
}

export function MPCard({
  mp,
  locale,
  className,
}: {
  mp: MPCardData
  locale: Locale
  className?: string
}) {
  return (
    <Card className={cn("p-0 transition-colors hover:bg-muted/40", className)}>
      <Link
        href={`/mps/${encodeURIComponent(mp.internalId)}`}
        className="flex items-center gap-3 p-4 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        <MPPhoto name={mp.name} photoUrl={mp.photoUrl} className="size-12" />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* `truncate` needs the min-w-0 above: a flex child's default
              min-width is its content, so a long name would widen the card
              instead of ellipsising. */}
          <span className="truncate font-medium text-sm">{mp.name}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <FraktionBadge fraktion={mp.fraktion} />
            {mp.constituency ? (
              <span className="truncate text-muted-foreground text-xs">{mp.constituency}</span>
            ) : (
              <span className="text-muted-foreground text-xs">{t("mps.listMandate", locale)}</span>
            )}
          </div>
          {mp.monthlyActivity && mp.monthlyActivity.length > 0 ? (
            <MiniHeatmap months={mp.monthlyActivity} locale={locale} />
          ) : null}
        </div>

        <div className="flex flex-col items-end">
          <span className="font-semibold text-lg tabular-nums">
            {mp.totalScore === null ? "—" : formatNumber(mp.totalScore, locale)}
          </span>
          <span className="text-muted-foreground text-xs">{t("mp.activityScore", locale)}</span>
        </div>
      </Link>
    </Card>
  )
}

const LEVEL_CLASSES = [
  "bg-muted",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const

/** A row of month cells, shaded like the full grid. Scaled to this MP's own
 * busiest month for the reason `heatmapLevel` gives: an absolute scale renders
 * a backbencher's whole year flat. */
function MiniHeatmap({
  months,
  locale,
}: {
  months: ReadonlyArray<{ month: string; count: number }>
  locale: Locale
}) {
  const max = Math.max(0, ...months.map((entry) => entry.count))
  return (
    <div
      className="mt-0.5 flex gap-[2px]"
      // `role="img"` so the label is valid and the strip is announced as one
      // thing: on a card this is a sparkline, and the per-cell detail lives on
      // the profile page. A bare aria-label on a div labels nothing.
      role="img"
      aria-label={t("heatmap.title", locale)}
    >
      {months.map((entry) => (
        <span
          key={entry.month}
          className={cn("h-2 w-[7px] rounded-[1px]", LEVEL_CLASSES[heatmapLevel(entry.count, max)])}
        />
      ))}
    </div>
  )
}
