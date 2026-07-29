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
 */
export function SidebarToggle({
  /** Passed rather than read from context, because the sidebar already has the
   * value and passing it keeps the button and the rail it sits in rendering
   * from one read in one pass — a second `useSidebar()` here would be a second
   * subscription to the same context for no additional information. */
  expanded,
  className,
}: {
  expanded: boolean
  className?: string
}) {
  const { t } = useLocale()
  const { toggle } = useSidebar()

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
          // Full width when expanded so the control reads as the rail's own
          // footer rather than as a button parked in a corner; square when
          // collapsed, where the rail is 3.5 rem and there is nothing else to
          // align to.
          className={cn(expanded && "w-full justify-start gap-2 px-2.5", className)}
        >
          <Icon />
          {/* The label beside the glyph when there is room for it. The button
              keeps its `aria-label` regardless — that is what names it in the
              collapsed state, and repeating the text visibly here does not
              double the announcement because `aria-label` overrides content
              rather than adding to it. */}
          {expanded && <span className="truncate font-normal text-sm">{label}</span>}
        </Button>
      </TooltipTrigger>
      {/* Only where the button has no visible text of its own. Expanded, the
          label is already on the button and a tooltip repeating it is noise. */}
      {!expanded && (
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      )}
    </Tooltip>
  )
}
