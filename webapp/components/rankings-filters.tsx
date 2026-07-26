"use client"

import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatMonth } from "@/lib/format"
import type { TranslationKey } from "@/lib/i18n"
import type { AgeGroup } from "@/lib/taxonomy"

/**
 * The rankings filter bar: Fraktion, federal state, age group, month.
 *
 * ## Options come from the data
 *
 * Every dropdown is populated by `getRankingFilterOptions`, never from a
 * constant. Fraktion names differ between electoral periods, and the federal
 * state is recoverable for only some MPs (see `stateOf` in
 * convex/rankings.ts) — so a hardcoded list of sixteen Länder would offer
 * fifteen filters that select nothing, which reads as broken data rather than
 * as an absent field. A filter that cannot be satisfied is not shown.
 *
 * The counts beside each option are part of that: "SPD (122)" tells the reader
 * what they are about to narrow to, and a group with no members never appears.
 */

/** Sentinel for "no filter". Radix reserves the empty string on `SelectItem` to
 * mean "clear the value", so the absence of a filter needs an actual name. */
export const ANY = "__any__"

/** `AgeGroup` keys are not valid `TranslationKey`s on their own; this maps them
 * to the `rankings.age.*` strings. Typed, so a group added to lib/taxonomy.ts
 * without a label fails the typecheck rather than rendering its raw key. */
const AGE_LABEL_KEYS: Record<AgeGroup, TranslationKey> = {
  u30: "rankings.age.u30",
  "30s": "rankings.age.30s",
  "40s": "rankings.age.40s",
  "50s": "rankings.age.50s",
  "60s": "rankings.age.60s",
  "70plus": "rankings.age.70plus",
}

export type RankingFilterOptions = {
  fraktionen: { value: string; count: number }[]
  states: { value: string; count: number }[]
  ageGroups: { value: AgeGroup; count: number }[]
  months: string[]
}

export type RankingFilterState = {
  fraktion: string
  state: string
  ageGroup: string
  /** `ANY` means the whole electoral period — the `month: null` score row, not
   * "every month". The two are different rows and the period total is not a sum
   * of the monthly ones being displayed together. */
  month: string
}

export const EMPTY_FILTERS: RankingFilterState = {
  fraktion: ANY,
  state: ANY,
  ageGroup: ANY,
  month: ANY,
}

export function hasActiveFilters(filters: RankingFilterState): boolean {
  return (
    filters.fraktion !== ANY ||
    filters.state !== ANY ||
    filters.ageGroup !== ANY ||
    filters.month !== ANY
  )
}

/**
 * One labelled filter dropdown.
 *
 * Four of these differing only in their options is enough repetition to factor
 * out, and the labelling is why it is worth doing properly once. A `<label>`
 * *wrapping* the select does not label it: Radix renders the trigger as a
 * `<button>`, and the implicit association a label makes only reaches form
 * controls — so the wrapper would look correct, satisfy nobody, and leave a
 * screen reader announcing an unnamed button. `id` + `aria-labelledby` on the
 * trigger is the association that actually holds.
 *
 * `items === undefined` is the loading state — the options query has not
 * resolved — and renders the "any" item alone rather than an empty list, so the
 * control is usable and honest before the counts arrive.
 */
function FilterSelect({
  id,
  label,
  anyLabel,
  value,
  onValueChange,
  items,
  width,
}: {
  id: string
  label: string
  /** Label for the "no filter" item. Omitted where the filter is mandatory —
   * the month picker on the rising board. */
  anyLabel?: string
  value: string
  onValueChange: (value: string) => void
  items: { value: string; label: string }[] | undefined
  width: string
}) {
  const labelId = `${id}-label`
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-muted-foreground text-xs">
        {label}
      </span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-labelledby={labelId} className={width}>
          <SelectValue placeholder={anyLabel ?? label} />
        </SelectTrigger>
        <SelectContent>
          {anyLabel !== undefined && <SelectItem value={ANY}>{anyLabel}</SelectItem>}
          {items?.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function RankingsFilters({
  options,
  filters,
  onChange,
  /** Whether the month picker may be cleared to "whole period". False on the
   * rising board, which has nothing to compare a period total against. */
  allowWholePeriod = true,
}: {
  options: RankingFilterOptions | undefined
  filters: RankingFilterState
  onChange: (next: RankingFilterState) => void
  allowWholePeriod?: boolean
}) {
  const { t, locale } = useLocale()

  function set<Key extends keyof RankingFilterState>(key: Key, value: string) {
    onChange({ ...filters, [key]: value })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <FilterSelect
        id="rankings-filter-fraktion"
        label={t("rankings.filter.fraktion")}
        anyLabel={t("rankings.filter.allFraktionen")}
        value={filters.fraktion}
        onValueChange={(value) => set("fraktion", value)}
        width="w-[14rem]"
        items={options?.fraktionen.map((entry) => ({
          value: entry.value,
          label: `${entry.value} (${entry.count})`,
        }))}
      />

      {/* Hidden entirely when no MP's record yields a state, rather than shown
          empty. See the header — and `stateOf`, which explains why that is the
          common case until the pipeline stores WKR_LAND as its own field. */}
      {options !== undefined && options.states.length > 0 && (
        <FilterSelect
          id="rankings-filter-state"
          label={t("rankings.filter.state")}
          anyLabel={t("rankings.filter.allStates")}
          value={filters.state}
          onValueChange={(value) => set("state", value)}
          width="w-[11rem]"
          items={options.states.map((entry) => ({
            value: entry.value,
            label: `${entry.value} (${entry.count})`,
          }))}
        />
      )}

      {options !== undefined && options.ageGroups.length > 0 && (
        <FilterSelect
          id="rankings-filter-age"
          label={t("rankings.filter.ageGroup")}
          anyLabel={t("rankings.filter.allAges")}
          value={filters.ageGroup}
          onValueChange={(value) => set("ageGroup", value)}
          width="w-[11rem]"
          items={options.ageGroups.map((entry) => ({
            value: entry.value,
            label: `${t(AGE_LABEL_KEYS[entry.value])} (${entry.count})`,
          }))}
        />
      )}

      <FilterSelect
        id="rankings-filter-month"
        label={t("rankings.filter.month")}
        // The rising board passes `allowWholePeriod={false}`, which removes the
        // "whole period" item — there is no month before a period total to
        // compare against. Omitting the item rather than disabling it, because a
        // disabled option invites the reader to wonder what would happen.
        anyLabel={allowWholePeriod ? t("rankings.filter.wholePeriod") : undefined}
        value={filters.month}
        onValueChange={(value) => set("month", value)}
        width="w-[13rem]"
        items={options?.months.map((month) => ({
          value: month,
          label: formatMonth(month, locale),
        }))}
      />

      {hasActiveFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          {t("common.reset")}
        </Button>
      )}
    </div>
  )
}
