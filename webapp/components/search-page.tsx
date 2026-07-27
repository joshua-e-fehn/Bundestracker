"use client"

import { useQuery } from "convex/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { EVENT_TYPE_STYLES } from "@/components/event-type-icon"
import { useLocale } from "@/components/providers/locale-provider"
import { SearchBar } from "@/components/search-bar"
import { SearchResults } from "@/components/search-results"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/convex/_generated/api"
import { EVENT_TYPES, type EventType, isEventType } from "@/lib/taxonomy"

/**
 * The /search page: the box, the filters, the results.
 *
 * ## All state lives in the URL
 *
 * Every control writes a query parameter and reads back from one; nothing here
 * holds a `useState` for a filter. That is what makes a search shareable — a
 * colleague opening `?q=klima&fraktion=SPD` sees the same page — and what makes
 * the back button undo a filter rather than leave the page. It is also why the
 * filters can be rendered by a client component while the page above stays a
 * server component: the parameters are the only thing crossing the boundary.
 *
 * ## Every option comes from the data
 *
 * The group and committee lists are read from the roster, never from a
 * constant — the rule components/mp-table.tsx and components/rankings-filters.tsx
 * both state, for the reason given there: a control offering values nothing
 * matches reads as broken data rather than as an absent field.
 *
 * ⚠ The committee filter is hidden on a historical Wahlperiode, and its absence
 * is honest where an empty dropdown would not be: §6.4 records that committee
 * membership is published for the **current period only**, so a past period has
 * no committees to offer — not a chamber that sat on none.
 */

/** Sentinel for "no filter". Radix's Select reserves the empty string for its
 * cleared state, so the all-values option needs a value of its own — the same
 * constant components/mp-table.tsx defines for the same reason. */
const ALL = "__all__"

export function SearchPage({ defaultWahlperiode }: { defaultWahlperiode: number }) {
  const { t } = useLocale()
  const router = useRouter()
  const params = useSearchParams()

  const query = params.get("q") ?? ""
  const fraktion = params.get("fraktion") ?? ALL
  const committee = params.get("committee") ?? ALL
  const typeParam = params.get("type") ?? ALL
  const periodParam = Number(params.get("wp"))
  const wahlperiode =
    Number.isFinite(periodParam) && periodParam > 0 ? periodParam : defaultWahlperiode

  const options = useQuery(api.search.getSearchFilterOptions, { wahlperiode })

  /**
   * Rewrites one parameter, preserving the rest.
   *
   * `replace`, not `push`: adjusting a filter is a refinement of the same
   * search, and pushing would make the back button walk through every dropdown
   * the reader tried rather than returning them to where they came from. The
   * query itself *is* pushed — see `SearchBar` — because that is a new search.
   */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (value === null || value === ALL) next.delete(key)
      else next.set(key, value)
      router.replace(`/search?${next.toString()}`)
    },
    [params, router],
  )

  const eventType: EventType | undefined = isEventType(typeParam) ? typeParam : undefined
  const hasFilters = fraktion !== ALL || committee !== ALL || typeParam !== ALL

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">{t("search.title")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("search.subtitle")}</p>
      </header>

      <SearchBar variant="page" initialQuery={query} autoFocus={!query} />

      {/* The two limits of the feature, stated before the results rather than
          under them. Prefix matching is what does work; typo correction is what
          does not, and a reader who assumes otherwise reads an empty result as
          a fact about the Bundestag. */}
      <div className="flex flex-col gap-1.5 text-muted-foreground text-xs">
        <p>{t("search.noFuzzyNotice")}</p>
        <p>{t("search.bilingualNotice")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))]">
        <FilterSelect
          id="search-fraktion"
          label={t("search.filterFraktion")}
          value={fraktion}
          onChange={(value) => setParam("fraktion", value)}
          allLabel={t("search.allFraktionen")}
          options={(options?.fraktionen ?? []).map((entry) => ({
            value: entry.value,
            label: `${entry.value} (${entry.count})`,
          }))}
        />

        {/* Rendered only where the data can answer it — see the header. */}
        {options && options.committees.length > 0 && (
          <FilterSelect
            id="search-committee"
            label={t("search.filterCommittee")}
            value={committee}
            onChange={(value) => setParam("committee", value)}
            allLabel={t("search.allCommittees")}
            options={options.committees.map((name) => ({ value: name, label: name }))}
          />
        )}

        <FilterSelect
          id="search-type"
          label={t("search.filterType")}
          value={typeParam}
          onChange={(value) => setParam("type", value)}
          allLabel={t("search.allTypes")}
          // `EVENT_TYPES`, not a list restated here: the schema's validator is
          // built from the same tuple, so a kind the database accepts is a kind
          // this filter offers. convex/feed.ts makes the same point.
          options={EVENT_TYPES.map((kind) => ({
            value: kind,
            label: t(EVENT_TYPE_STYLES[kind].labelKey),
          }))}
        />

        {/* Only when there is a choice to make. A deployment holding one
            Wahlperiode — which is every deployment until the Wave 10 backfill
            runs — gets no control rather than a dropdown with one option. */}
        {options && options.wahlperioden.length > 1 && (
          <FilterSelect
            id="search-period"
            label={t("search.filterPeriod")}
            value={String(wahlperiode)}
            onChange={(value) => setParam("wp", value)}
            allLabel={t("search.period", { wahlperiode: defaultWahlperiode })}
            options={options.wahlperioden.map((period) => ({
              value: String(period),
              label: t("search.period", { wahlperiode: period }),
            }))}
          />
        )}
      </div>

      {hasFilters && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              // The query survives a filter reset: the reader is clearing how
              // the results are narrowed, not what they asked.
              const next = new URLSearchParams()
              if (query) next.set("q", query)
              router.replace(`/search?${next.toString()}`)
            }}
          >
            {t("common.reset")}
          </Button>
        </div>
      )}

      {committee !== ALL && (
        <p className="text-muted-foreground text-xs">{t("search.committeeScopeNotice")}</p>
      )}

      <SearchResults
        query={query}
        wahlperiode={wahlperiode}
        fraktion={fraktion === ALL ? undefined : fraktion}
        committee={committee === ALL ? undefined : committee}
        eventType={eventType}
      />
    </div>
  )
}

/**
 * One labelled filter dropdown with its "no filter" option.
 *
 * The same shape components/mp-table.tsx uses, and for the labelling reason
 * stated there: Radix renders the trigger as a `<button>`, so `<Label htmlFor>`
 * associates with it only because the trigger carries the matching `id`.
 */
function FilterSelect({
  id,
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  allLabel: string
  options: ReadonlyArray<{ value: string; label: string }>
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[min(24rem,90vw)]">
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
