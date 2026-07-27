"use client"

import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A row of toggleable filter chips.
 *
 * Generic over the option value so the feed's event-type filter and any later
 * chip filter share one implementation — the alternative is two components that
 * agree on appearance and drift on keyboard behaviour.
 *
 * ## Selection semantics
 *
 * **Empty means everything.** No chip selected shows all options rather than
 * none: a filter row that starts by hiding all the data is a filter nobody can
 * recover from without knowing which chip to press. The "all" chip therefore
 * clears the selection rather than selecting every value — the two look
 * identical on screen and behave differently when a new event kind appears in
 * the data, where "all" should include it and an enumerated selection should
 * not silently start doing so.
 *
 * ## Accessibility
 *
 * Real `<button>`s with `aria-pressed`, inside a `<fieldset>` with a visually
 * hidden `<legend>`. Not checkboxes: these are toggles that act immediately,
 * and a screen reader should announce "Rede, pressed" rather than a checkbox in
 * a form that is never submitted — `aria-pressed`, not `aria-checked`, for the
 * same reason. The fieldset rather than `role="group"` because the element
 * already carries that meaning natively.
 */

export type FilterChipOption<Value extends string> = {
  value: Value
  label: string
  /** Optional leading element — the feed passes an event-type icon. */
  icon?: React.ReactNode
  /** Count shown after the label. Rendered as `~n` when `atLeast`, because
   * convex/feed.ts caps its counts and an exact-looking number that is really a
   * ceiling is worse than an approximate-looking one. */
  count?: number
  atLeast?: boolean
}

export function FilterChips<Value extends string>({
  options,
  selected,
  onChange,
  allLabel,
  label,
  className,
}: {
  options: FilterChipOption<Value>[]
  selected: Value[]
  onChange: (next: Value[]) => void
  /** Label for the chip that clears the selection. */
  allLabel: string
  /** Accessible name for the group as a whole — "Nach Art filtern". */
  label: string
  className?: string
}) {
  const isAll = selected.length === 0

  function toggle(value: Value) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    // A real `<fieldset>` rather than `role="group"`: the element already means
    // "these controls belong together", so the ARIA attribute would be
    // restating in ARIA what HTML says natively. The legend carries the group's
    // name and is visually hidden — the row's meaning is obvious on screen from
    // the chips themselves, and unhelpfully so to a screen reader arriving at a
    // row of unexplained buttons.
    <fieldset className={cn("flex flex-wrap items-center gap-2 border-0 p-0", className)}>
      <legend className="sr-only">{label}</legend>
      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={isAll}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          isAll
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-border text-muted-foreground hover:bg-muted",
        )}
      >
        {allLabel}
      </button>

      {options.map((option) => {
        const active = selected.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              // Gold rather than `--primary` for the selected state. `--primary`
              // is near-black in light mode, so an active chip was a grey chip
              // beside inactive grey chips — the one control on the feed whose
              // whole job is to show what is on. Gold is the site's accent and
              // is unmistakable against the neutral row. The `X` and
              // `aria-pressed` still carry the state without colour.
              active
                ? "border-gold/50 bg-gold/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {option.icon}
            <span>{option.label}</span>
            {option.count !== undefined && (
              <span className="text-muted-foreground text-xs tabular-nums">
                {option.atLeast ? `${option.count}+` : option.count}
              </span>
            )}
            {active && <X className="size-3" aria-hidden="true" />}
          </button>
        )
      })}
    </fieldset>
  )
}
