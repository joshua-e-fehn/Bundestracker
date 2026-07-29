"use client"

import { useQuery } from "convex/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale } from "@/components/providers/locale-provider"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/convex/_generated/api"
import { formatCount } from "@/lib/format"
import { isCurrentPeriod, type PeriodOptions, periodHref } from "@/lib/period"

/**
 * The Wahlperiode control: which Bundestag this page is about.
 *
 * ## Why it writes the URL rather than holding state
 *
 * The period is not a filter over a page — it *is* the page. A reader who sends
 * a colleague a WP19 ranking must send them a WP19 ranking, and one who presses
 * Back after switching must land on the period they came from. Both follow from
 * the period living in the address bar, and neither is recoverable from a
 * `useState`. It is the same argument components/search-page.tsx already makes
 * for its filters, applied to the one parameter that scopes everything else.
 *
 * `router.push`, not `replace`: changing period is a navigation, not a
 * refinement. That is the opposite call from the `/search` filters, which
 * deliberately `replace` so Back does not walk the reader through every
 * dropdown they tried — and the difference is real. A period change swaps the
 * whole dataset; a Fraktion filter narrows one already on screen.
 *
 * ## Other parameters survive
 *
 * `periodHref` rewrites `wp` and carries everything else, so switching period
 * on `/search?q=klima` keeps the query and switching on a filtered list keeps
 * the filter. The acceptance criterion is "period navigation must preserve
 * other applicable filters", and doing it in the href builder rather than here
 * means every caller gets it, including the ones that are plain links.
 *
 * ## The current period writes no parameter
 *
 * Switching *back* to the current period returns to the bare path — see
 * `periodHref`. A URL that pinned `?wp=21` would name a chamber that stops
 * being current at the next election, which is the exact staleness
 * `newestWahlperiode` exists to prevent, reintroduced through the address bar.
 *
 * ## It renders nothing when there is nothing to choose
 *
 * One ingested period is not a choice, and a dropdown holding one option is a
 * control that cannot do anything — the rule `/search`'s own period filter
 * already followed. A deployment mid-backfill therefore sees the site it had
 * before, rather than a disabled widget explaining itself.
 */
export function PeriodSelector({
  wahlperiode,
  className,
  /** Where the switch navigates. Defaults to the current path with `wp`
   * rewritten, which is what every page-level use wants. */
  hrefFor,
  /**
   * The periods to offer, overriding "every period this deployment holds".
   *
   * The profile is the one caller that needs this, and it needs it for a reason
   * the page-level selectors do not have: an MP sat in *some* periods, not all
   * of them. Offering WP20 on the profile of someone first elected in WP21
   * would be offering a page that does not exist — a switch straight into the
   * "did not sit" state, from a control whose whole job is to be a list of
   * places you can go. `mps.getMPMandates` is exactly this list, and it is what
   * convex/mps.ts already calls "the profile page's period switcher".
   *
   * `undefined` means the deployment-wide list from `mps.listPeriods`.
   */
  periods,
}: {
  wahlperiode: number
  className?: string
  hrefFor?: (next: number) => string
  periods?: readonly { wahlperiode: number; mandates: number }[]
}) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const options = useQuery(api.mps.listPeriods, {})

  // While the list is in flight, and when there is one period to offer.
  // Not a skeleton: this control sits above a page's content, so a shimmer here
  // would push the whole page down and then let it snap back on a query that
  // usually resolves in one round-trip. Absent-then-present costs one reflow;
  // skeleton-then-present costs two.
  //
  // `options` gates both cases even when `periods` is given: the *current*
  // period is what decides which entry is marked as such and which href omits
  // the parameter, and neither can be answered from an MP's own mandate list.
  if (options === undefined) return null
  const offered = periods ?? options.periods
  if (offered.length <= 1) return null

  const buildHref =
    hrefFor ?? ((next: number) => periodHref(pathname, next, { current: options.current, params }))

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* `Label htmlFor` reaches the Radix trigger because the trigger is a
            `<button>` and a button is labelable — the same association
            components/filter-select.tsx documents, and the reason `id` is not
            generated here either. */}
        <Label htmlFor="period-selector" className="text-muted-foreground text-xs">
          {t("period.label")}
        </Label>
        <Select
          value={String(wahlperiode)}
          onValueChange={(value) => {
            const next = Number(value)
            if (!Number.isFinite(next) || next === wahlperiode) return
            router.push(buildHref(next))
          }}
        >
          <SelectTrigger id="period-selector" size="sm" className="w-auto min-w-[11rem]">
            {/* The placeholder is reached in one real state, not as a
                defensive branch: `PeriodNotIngested` renders this control at a
                period that is deliberately absent from the list, so Radix has
                no item to echo. Without it the trigger would be blank — a
                dropdown that appears broken on the one screen whose job is to
                explain that nothing is broken. */}
            <SelectValue placeholder={t("period.option", { wahlperiode })} />
          </SelectTrigger>
          <SelectContent className="max-w-[min(22rem,90vw)]">
            {offered.map((entry) => (
              <SelectItem key={entry.wahlperiode} value={String(entry.wahlperiode)}>
                {/* The period, then what marks it out. The current one is named
                    as current rather than left to be inferred from being first
                    — a reader who has switched away needs to know which one to
                    switch back to, and "21" alone does not say. */}
                {t("period.option", { wahlperiode: entry.wahlperiode })}
                {isCurrentPeriod(entry.wahlperiode, options.current)
                  ? ` · ${t("period.currentSuffix")}`
                  : ` · ${t("period.mandates", {
                      count: formatCount(entry.mandates, locale),
                    })}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/**
 * The banner a historical page carries, and the current one does not.
 *
 * Separate from the selector because it answers a different question. The
 * dropdown asks *which* Bundestag; this states that the one on screen is not
 * the sitting one, which a reader arriving on a shared link has no other way to
 * learn — they did not press the control, so they never saw its value.
 *
 * ## It is not decoration, it is the honesty requirement
 *
 * Every figure below it is measured against sources that reach a closed period
 * unevenly (`docs/historical-coverage.md`). A WP19 profile showing zero
 * committee seats is showing "never published", and a WP18 one showing zero
 * ballots is showing "no machine-readable record exists". Those are stated per
 * card, where the zero is — but a reader has to know they are looking at a past
 * period before any of those notes mean anything.
 *
 * ## No live-region role
 *
 * It carried `role="status"` and should not have. A live region is for content
 * that *changes while the reader is on the page* — a save confirmation, a
 * result count — and it interrupts whatever is being read to announce the
 * change. This banner never changes in place: it is present on the first paint
 * of a historical page and absent on a current one, and a period switch is a
 * navigation, so the reader arrives at a new document with it already there.
 *
 * Announcing it as a status would therefore either say nothing (nothing
 * changed) or interrupt at the moment of a navigation the reader just made
 * deliberately. What it needs instead is to be *in reading order above the
 * content*, which it is, so a screen reader meets it before the figures it
 * qualifies — the same way the seating notice and every `CaveatNote` on the
 * site work.
 *
 * Renders nothing for the current period, and nothing while the period list is
 * still resolving — `isCurrentPeriod` treats unknown as current for exactly
 * this reason, so the current page never flashes a "this is historical" banner
 * during a round-trip.
 */
export function HistoricalPeriodNotice({
  wahlperiode,
  options,
}: {
  wahlperiode: number
  /** Passed in rather than queried, so a page that already holds the list does
   * not open a second subscription to the same query for the banner beside the
   * selector that opened the first. */
  options: PeriodOptions | undefined
}) {
  const { t } = useLocale()

  if (options === undefined) return null
  if (isCurrentPeriod(wahlperiode, options.current)) return null

  const entry = options.periods.find((row) => row.wahlperiode === wahlperiode)

  return (
    <div className="flex flex-col gap-1 rounded-md border border-gold/40 bg-gold/5 px-3 py-2.5 text-sm">
      <p className="font-medium">{t("period.historicalTitle", { wahlperiode })}</p>
      <p className="text-muted-foreground text-xs leading-relaxed">{t("period.historicalBody")}</p>
      {/* The unscored case, stated separately because its cause is different
          and its fix is ours rather than the Bundestag's. A backfilled period
          whose score sweep has not run renders every board empty
          (`docs/historical-coverage.md`, "Scores"), and empty boards read as an
          idle chamber. This says which it is. */}
      {entry && !entry.scored ? (
        <p className="text-muted-foreground text-xs leading-relaxed">{t("period.notScored")}</p>
      ) : null}
    </div>
  )
}
