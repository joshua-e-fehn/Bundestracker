"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { useDeferredValue, useMemo, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { usePeriod, usePeriodHref } from "@/components/providers/period-provider"
import { SourceCoverageNote } from "@/components/source-coverage-note"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/convex/_generated/api"
import { committeeHref } from "@/lib/committees"
import { formatCount } from "@/lib/format"
import { foldName } from "@/lib/search"

/**
 * The committees list — one row per Ausschuss, with its seat count.
 *
 * Renders under `PeriodScope`, so the period reaches it as a prop and
 * `useMPHref`/`usePeriodHref` inside it carry that period into every link the
 * page renders. The `current` for `SourceCoverageNote` comes from the same
 * `PeriodProvider`, so its "not published" note kicks in on any WP < current
 * without this component knowing the boundary.
 *
 * ## The seat-count reads *seats*, not people
 *
 * The number this renders is the one `getCommittees` returns, and the header
 * of `convex/committees.ts` is clear about what that means: one row per
 * (MP, period, committee), which is one seat. Stammdaten emits a chair twice
 * (`Vorsitzender` + `Ordentliches Mitglied`) and the upsert key collapses it
 * to one row, so a chair counts once. The i18n string says "Sitze" for that
 * reason — a count of 42 is 42 seats on 42 people, not 42 memberships-with-
 * role-rows.
 *
 * ## The search is a filter, not a query
 *
 * All ~25 committees for a period come down at once (the whole WP21 corpus is
 * ~1,744 rows and the returned list is one row per committee), so the search
 * runs client-side over the loaded rows. `foldName` — the same folding
 * `mp-table.tsx` uses — is what makes `für` and `fuer` match, which matters
 * for the two committee names with umlauts.
 */
export function CommitteeDirectory({ wahlperiode }: { wahlperiode: number }) {
  const { t, locale } = useLocale()
  const { current } = usePeriod()
  const committees = useQuery(api.committees.getCommittees, { wahlperiode })

  const [search, setSearch] = useState("")
  // Typing re-filters ~25 rows per keystroke, which is trivial — but the
  // deferred read stays consistent with the roster's pattern, and keeps the
  // input responsive if the source ever grows.
  const deferredSearch = useDeferredValue(search)

  const filtered = useMemo(() => {
    if (committees === undefined) return undefined
    const needle = foldName(deferredSearch)
    if (needle === "") return committees
    return committees.filter((c) => foldName(c.committeeName).includes(needle))
  }, [committees, deferredSearch])

  const totalSeats = useMemo(() => {
    if (committees === undefined) return 0
    return committees.reduce((sum, c) => sum + c.memberCount, 0)
  }, [committees])

  if (committees === undefined) {
    return (
      <output className="flex flex-col gap-2" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        {Array.from({ length: 6 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
          <div key={index} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </output>
    )
  }

  // The empty case has two shapes, and they mean opposite things.
  //
  //  - Closed period (WP19/WP20): `SourceCoverageNote` renders — the source
  //    publishes nothing. No filter, no search, no roster. Just the note.
  //  - Current period (WP21) with no rows: a state WP21 does not reach in
  //    practice (§6.3 records 25 committees) but which needs an honest
  //    message rather than a blank rectangle. It reads as "the sync has
  //    not run yet", because that is the only way to get here.
  if (committees.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SourceCoverageNote source="committees" wahlperiode={wahlperiode} current={current} />
        {/* Only render the "current-period is empty" message when the source
            *is* published for this period — otherwise the caveat above is the
            explanation and adding a second one would look like two answers. */}
        {(current === null || current === undefined || wahlperiode >= current) && (
          <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
            {t("committees.emptyCurrent")}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Non-current periods do not reach here (the block above catches
          them), so the caveat is redundant. It stays out on purpose. */}

      <p className="text-muted-foreground text-sm">
        {t("committees.count", {
          committees: formatCount(committees.length, locale),
          seats: formatCount(totalSeats, locale),
        })}
      </p>

      <div className="flex flex-col gap-1.5 sm:max-w-md">
        <Label htmlFor="committee-search" className="sr-only">
          {t("committees.searchLabel")}
        </Label>
        <Input
          id="committee-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("committees.searchPlaceholder")}
          aria-label={t("committees.searchLabel")}
        />
      </div>

      {filtered !== undefined && filtered.length < committees.length && (
        <p aria-live="polite" className="text-muted-foreground text-xs">
          {t("committees.filteredCount", {
            shown: formatCount(filtered.length, locale),
            total: formatCount(committees.length, locale),
          })}
        </p>
      )}

      {filtered !== undefined && filtered.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
          {t("committees.noMatch")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {(filtered ?? committees).map((committee) => (
            <CommitteeRow
              key={committee.committeeName}
              committeeName={committee.committeeName}
              memberCount={committee.memberCount}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One committee's row in the directory list.
 *
 * The link's period is carried by `usePeriodHref` — so `/committees?wp=19`
 * (if it ever renders rows) would send the reader to `/committees/…?wp=19`,
 * not to the same name in the current period.
 */
function CommitteeRow({
  committeeName,
  memberCount,
}: {
  committeeName: string
  memberCount: number
}) {
  const { t, locale } = useLocale()
  const periodHref = usePeriodHref()
  return (
    <li>
      <Link
        href={periodHref(committeeHref(committeeName))}
        className="flex items-center justify-between gap-4 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{committeeName}</span>
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {memberCount === 1
            ? t("committees.memberCountOne")
            : t("committees.memberCount", { count: formatCount(memberCount, locale) })}
        </span>
      </Link>
    </li>
  )
}
