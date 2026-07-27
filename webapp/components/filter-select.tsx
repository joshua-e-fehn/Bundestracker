"use client"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * One labelled filter dropdown, with its "no filter" option.
 *
 * Extracted from components/mp-table.tsx, which had it first and where the
 * /search page's copy was byte-identical. The rankings page has a *third*
 * variant (`components/rankings-filters.tsx`) that is deliberately not folded
 * in: it takes a `width`, makes its "any" option optional because the rising
 * board's month picker is mandatory, and labels with a `<span id>` plus
 * `aria-labelledby` rather than `<Label htmlFor>`. Merging those differences
 * into one component would mean four more props and a control that is
 * configurable rather than obvious.
 *
 * ## `ALL` lives here too
 *
 * The sentinel is exported alongside the component rather than redeclared per
 * page, because it is part of this control's contract: the caller compares
 * against it to decide whether a filter is set. Two copies of a magic string
 * that must match is how one page's "reset" button stops recognising its own
 * cleared state.
 */

/**
 * Sentinel for "no filter".
 *
 * Radix's Select forbids an empty-string value — it reserves that for the
 * cleared state — so the all-values option needs a value of its own.
 */
export const ALL = "__all__"

/**
 * The labelling is why `id` is a required prop rather than generated.
 *
 * Radix renders the trigger as a `<button>`, so `<Label htmlFor>` does
 * associate with it (a button is a labelable element) — but only because the
 * trigger carries the matching `id`. Passing it through is what keeps that
 * association from silently lapsing.
 *
 * `truncate` behaviour comes from the trigger's own styles: a committee name is
 * longer than any column a filter grid gives it, and the alternative to
 * truncating is a control that sets its column's width from its longest option.
 */
export function FilterSelect({
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
