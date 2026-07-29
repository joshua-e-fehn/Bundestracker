"use client"

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"
import { useLocale } from "@/components/providers/locale-provider"
import { useSidebar } from "@/components/providers/sidebar-provider"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * The control that collapses and expands the sidebar.
 *
 * ## Why the icon changes rather than staying a single panel glyph
 *
 * shadcn's `SidebarTrigger` renders one `PanelLeft` in both states, which makes
 * the button say *what it acts on* but never *what it will do*. Two icons —
 * closing when open, opening when closed — make the affordance predictive, and
 * they are the pair lucide ships for exactly this. The label does the same job
 * for a screen reader, and the two must agree: both flip on the same boolean
 * rather than one being a static string.
 *
 * ## Why it is a button with a real label and not the reference's rail
 *
 * Fiscalis also carries a `SidebarRail` — a 16 px invisible strip along the
 * sidebar's edge that toggles on click, with `tabIndex={-1}` and a `title`. It
 * is a nice pointer affordance and it is not reachable by keyboard at all,
 * which is why it exists *beside* the trigger there rather than instead of it.
 * Adding an unfocusable second control for a thing this site has one of would
 * be two ways to do one thing, so only the button is here.
 *
 * ## Where it lives, and why it stopped being the rail's footer
 *
 * At the far left of the header, before the wordmark — Fiscalis's placement
 * (`frontend/components/atomic/organisms/header.tsx:28`: `<SidebarTrigger
 * className="-ml-1" />` then a vertical rule, then everything else). It used to
 * sit at the bottom of the rail, which put the control that reveals the
 * navigation *inside* the thing it reveals: collapsed to 3.5 rem, the only way
 * to get the labels back was a 28 px glyph at the bottom of a column of ten
 * other glyphs, below the fold on a short window. In the header it is at a
 * fixed screen position in both states and it is the first thing in the tab
 * order, which is what a control over the whole shell should be.
 *
 * The `expanded` prop is now optional for that reason: the header does not
 * render the rail and has no reason to hold its state, so it reads from
 * context. Inside the rail the value is still passed down.
 */
export function SidebarToggle({
  /** Optional. When the caller already has the value — the rail did — passing
   * it avoids a second subscription to the same context for no additional
   * information. The header has no such value, so it falls back to context. */
  expanded: expandedProp,
  className,
}: {
  expanded?: boolean
  className?: string
}) {
  const { t } = useLocale()
  const { expanded: expandedContext, toggle } = useSidebar()
  const expanded = expandedProp ?? expandedContext

  const label = expanded ? t("nav.collapseSidebar") : t("nav.expandSidebar")
  const Icon = expanded ? PanelLeftCloseIcon : PanelLeftOpenIcon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggle}
          // The button's *state*, not its action: `false` while expanded says
          // "the thing this controls is showing". Paired with `aria-controls`
          // it would be stronger still, but the sidebar has no stable id and
          // inventing one for an attribute that only refines an already-correct
          // announcement is not worth the coupling.
          aria-expanded={expanded}
          aria-label={label}
          className={cn(className)}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      {/* The label, in both states now. It used to be suppressed while expanded
          because the rail's footer button carried the text visibly beside the
          glyph; in the header there is no room for a 22-character German label
          in the bar, so the button is icon-only in both states and the tooltip
          is the only place the label is readable by pointer. `bottom` because
          the button is against the top edge — `right` would have put the panel
          over the wordmark. */}
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
