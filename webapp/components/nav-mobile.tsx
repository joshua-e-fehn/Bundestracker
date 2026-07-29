"use client"

import { MenuIcon } from "lucide-react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { useLocale } from "@/components/providers/locale-provider"
import { SearchBar } from "@/components/search-bar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  isActivePath,
  NAV_GROUPS,
  NAV_PRIMARY,
  NAV_SEARCH,
  type NavItem,
  navCurrent,
} from "@/lib/navigation"
import { useDismissOnNavigate } from "@/lib/use-dismiss-on-navigate"
import { cn } from "@/lib/utils"

/**
 * The mobile navigation: a drawer carrying the whole tree, flat and open.
 *
 * A deliberately *different* pattern from the desktop bar rather than the same
 * one at a smaller size, which is the point of criterion 4. On desktop the
 * groups are collapsed behind menu triggers because a 56 px bar has room for
 * four items and not for nine. In a drawer that constraint does not exist — it
 * scrolls — so hiding the same entries behind nine taps of disclosure would be
 * ceremony with no width to justify it. Every destination here is visible after
 * one tap on the menu button, under a heading that says which group it is in.
 *
 * That is the same conclusion the old sheet reached (it listed everything) with
 * the grouping added, and it keeps the two surfaces honest about the same tree:
 * both read `lib/navigation.ts`, so a route cannot appear in one and not the
 * other. The old header carried a hand-maintained `NAV_SHEET_ONLY` set for
 * exactly the drift that arrangement invites.
 *
 * ## What the sheet primitive already handles
 *
 * `components/ui/sheet.tsx` is Radix's `Dialog`, so focus moves into the panel
 * on open, is trapped while it is open, and returns to the trigger on close;
 * Escape and the overlay both dismiss; the page behind is inert and
 * `aria-hidden`. Those are criterion 4's keyboard and focus requirements, and
 * they come from the primitive rather than from anything written here — which
 * is why this uses it rather than a hand-rolled panel.
 *
 * What *is* written here is the close-on-navigate behaviour, which the
 * primitive cannot know about: following a `<Link>` inside an open dialog
 * changes the route and leaves the dialog open over the new page.
 */
export function NavMobile({ className }: { className?: string }) {
  const { t } = useLocale()
  // Closes on navigation, including one the reader did not start from this
  // panel (the browser's back button, say). One rule rather than an `onClick`
  // per row, which is what the old sheet had: that covers only the links
  // someone remembered to wire, and the search box's submit navigates too. See
  // lib/use-dismiss-on-navigate.ts.
  const { open, setOpen, pathname } = useDismissOnNavigate()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {/* `size="icon"` — 32 px — rather than the `icon-sm` this used to be.
            It is the only way to the navigation below `lg`, and a 28 px target
            is under every touch-target floor there is. The padding around it in
            the header brings the tappable area past 44 px. */}
        <Button variant="ghost" size="icon" className={className} aria-label={t("nav.openMenu")}>
          <MenuIcon />
        </Button>
      </SheetTrigger>

      {/* `w-[min(20rem,88vw)]`: 320 px where there is room, and never more than
          88% of the viewport. A fixed `w-72` was fine at 375 px and left a
          22 px strip of page at 320 px, which reads as a rendering fault rather
          than as an overlay. `overflow-y-auto` because the full tree is taller
          than a phone in landscape. */}
      <SheetContent
        side="right"
        className="flex w-[min(20rem,88vw)] flex-col gap-0 overflow-y-auto p-0"
      >
        {/* Radix throws a dev warning for a dialog with no accessible name, and
            radix-ui 1.1.23 dropped the warning rather than the requirement — so
            omitting this fails silently for a screen reader. */}
        <SheetHeader className="border-border/60 border-b px-4 py-3.5">
          <SheetTitle className="flex items-center gap-2 text-base">
            <BrandMark className="size-5" />
            {t("nav.menu")}
          </SheetTitle>
        </SheetHeader>

        {/* The search box itself, not a link to it: below `xl` the bar has no
            room for one, and the drawer is where a reader looks for what the
            bar could not fit. Submitting navigates, which closes the drawer via
            the effect above. */}
        <div className="border-border/60 border-b px-4 py-3">
          <SearchBar className="max-w-none" />
        </div>

        <nav aria-label={t("nav.menu")} className="flex flex-col gap-5 px-3 py-4">
          {/* The overview, above the groups and without one — it is all three
              at once. See `NAV_PRIMARY`. */}
          <div className="grid gap-0.5">
            <DrawerLink item={NAV_PRIMARY} pathname={pathname} />
          </div>

          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="grid gap-0.5">
              {/* A heading, not a button. The group is a label over rows that
                  are already visible; making it a disclosure control would add
                  a tap to every destination in a panel that scrolls. */}
              <h2 className="px-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                {t(group.labelKey)}
              </h2>
              {group.items.map((item) => (
                <div key={item.href} className="grid gap-0.5">
                  <DrawerLink item={item} pathname={pathname} />
                  {item.children?.map((child) => (
                    <DrawerLink key={child.href} item={child} pathname={pathname} nested />
                  ))}
                </div>
              ))}
            </div>
          ))}

          <div className="grid gap-0.5 border-border/60 border-t pt-4">
            <DrawerLink item={NAV_SEARCH} pathname={pathname} />
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  )
}

function DrawerLink({
  item,
  pathname,
  nested = false,
}: {
  item: NavItem
  pathname: string
  nested?: boolean
}) {
  const { t } = useLocale()
  const active = isActivePath(pathname, item.href)

  return (
    <Link
      href={item.href}
      // `page` only on the exact destination; an ancestor row such as `/votes`
      // while the reader is on `/votes/own-resources` announces `true`, which
      // says "the current item in this set" without claiming to be the page.
      // The gold rule below still uses the prefix match, so the visual
      // highlight is unchanged. See `navCurrent`.
      aria-current={navCurrent(pathname, item.href)}
      className={cn(
        // `min-h-11` — 44 px, the touch-target floor — rather than padding
        // alone, so a one-line row is as tappable as a two-line one.
        "flex min-h-11 flex-col justify-center gap-0.5 rounded-md border-l-2 px-3 py-2 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        nested && "ml-3",
        active
          ? "border-gold-brand bg-accent text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className={cn("font-medium", nested ? "text-[0.8rem]" : "text-sm")}>
        {t(item.labelKey)}
      </span>
      {item.descriptionKey && (
        <span className="text-muted-foreground text-xs leading-snug">{t(item.descriptionKey)}</span>
      )}
    </Link>
  )
}
