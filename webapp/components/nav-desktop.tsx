"use client"

import { ChevronDownIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  isActiveGroup,
  isActivePath,
  NAV_GROUPS,
  NAV_PRIMARY,
  type NavGroup,
  type NavItem,
} from "@/lib/navigation"
import { useDismissOnNavigate } from "@/lib/use-dismiss-on-navigate"
import { cn } from "@/lib/utils"

/**
 * The desktop navigation: one overview link and three group menus.
 *
 * Replaces the eight-link row this bar used to carry. The complaint that opened
 * the task was that the navigation had become "a wall of links" as the product
 * grew, and the arithmetic behind that is in the old header's own comments —
 * five labels measured 564 px, a sixth would not fit, so the ninth route lived
 * only in the mobile sheet and the tenth only in a sentence inside another
 * page. A flat row cannot absorb another feature; three groups can absorb
 * several, and `lib/navigation.ts` states where each one goes.
 *
 * ## Why menus rather than a collapsible icon rail
 *
 * The reference implementation this was modelled on (Fiscalis) uses shadcn's
 * `Sidebar` with `collapsible="icon"`: a 16 rem rail that shrinks to 3 rem,
 * persisted in a cookie, with tooltips standing in for the labels it hides.
 * That is the right pattern for that app and the wrong one here, for three
 * reasons that are properties of *this* site rather than preferences:
 *
 *  - **Bundestracker is a public document, not a workspace.** A reader arrives
 *    from a search engine or a pasted link, reads one page, and leaves. A rail
 *    that must be discovered, expanded and remembered is overhead paid by every
 *    first visit to be repaid on a return visit most readers never make. The
 *    header is already the pattern the site's own audience — and every German
 *    public-sector site it sits beside — expects.
 *  - **A left rail costs the content its width permanently.** Every page here
 *    is a centred `max-w-6xl` column of tables, charts and a seating arc that
 *    is already tight at 1024 px. Taking 256 px off the left of all of them to
 *    hold nine links is the layout obstruction criterion 3 rules out.
 *  - **Icon-only is not honest for these labels.** "Sitzverteilung",
 *    "Untersuchungsausschuss" and "Fraktionsvergleich" are not concepts with
 *    conventional glyphs. A collapsed rail of nine invented icons is a
 *    guessing game, and the tooltips that fix it are the labels again — one
 *    hover later.
 *
 * So the *strengths* transfer rather than the component: named groups instead
 * of a flat list, progressive disclosure of the long tail, an unambiguous
 * active state, descriptions on every destination, and a deliberate separate
 * mobile pattern. What is dropped is the collapse toggle and its persisted
 * state, because a header that is 56 px tall has nothing to collapse.
 *
 * ## Hover *and* click, both
 *
 * Radix's `DropdownMenu` opens on click and on keyboard, which is the accessible
 * baseline. Opening on hover as well is the thing that makes a grouped bar feel
 * as fast as the flat row it replaces — without it, every destination that used
 * to be one click away is now two. The hover handling is deliberately kept to
 * the trigger and the content (`onPointerEnter` / `onPointerLeave` with a short
 * close delay), and only for a fine pointer: on a touch screen a hover-open
 * menu fires on the tap that was meant to follow the link.
 */
export function NavDesktop({ className }: { className?: string }) {
  const { t } = useLocale()
  const pathname = usePathname()

  return (
    // `aria-label` rather than a heading: this is a landmark, and a bar with
    // two `<nav>` elements on the page (the footer has one) needs each named or
    // a screen reader announces "navigation" twice with no way to tell them
    // apart.
    <nav aria-label={t("nav.primary")} className={cn("items-center gap-0.5", className)}>
      {/* The overview, outside the groups — it is not a category, it is all of
          them at once. See `NAV_PRIMARY`. */}
      <NavBarLink href={NAV_PRIMARY.href} active={isActivePath(pathname, NAV_PRIMARY.href)}>
        {t(NAV_PRIMARY.labelKey)}
      </NavBarLink>

      {NAV_GROUPS.map((group) => (
        <NavGroupMenu key={group.id} group={group} />
      ))}
    </nav>
  )
}

/**
 * The gold underline that marks the reader's location.
 *
 * Lifted unchanged from the old header, including its reasoning: absolutely
 * positioned so that turning it on shifts nothing (a `border-b` on the active
 * link would move every other link by a pixel on each navigation), a *shape*
 * rather than only a colour so it survives greyscale and colour-vision
 * deficiency, and `--gold-brand` because a 2 px bar carrying no text is exactly
 * the case app/globals.css reserves the identity tier for.
 */
function ActiveMarker() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-gold-brand"
    />
  )
}

const BAR_ITEM_CLASS =
  "relative flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function NavBarLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      // Announceable, not merely visible — the underline below is the sighted
      // half of the same statement.
      aria-current={active ? "page" : undefined}
      className={cn(
        BAR_ITEM_CLASS,
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {active && <ActiveMarker />}
    </Link>
  )
}

/** How long the menu waits after the pointer leaves before closing. Enough to
 * cross the 4 px gap between the trigger and its panel without the menu
 * evaporating mid-reach; short enough that it does not linger over the page. */
const HOVER_CLOSE_DELAY_MS = 180

function NavGroupMenu({ group }: { group: NavGroup }) {
  const { t } = useLocale()
  // Closes itself when the route changes — Radix keeps the menu open across a
  // client-side navigation, so without this the panel stays over the page it
  // just opened. See lib/use-dismiss-on-navigate.ts.
  const { open, setOpen, pathname } = useDismissOnNavigate()
  const groupActive = isActiveGroup(pathname, group)
  const closeTimer = useTimeoutRef()

  // Hover only where hovering means something. On a touch screen every tap
  // produces a synthetic pointer-enter, so opening on hover there turns the
  // first tap on a trigger into an open-then-immediately-close.
  const hoverProps = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType !== "mouse") return
      clearTimeout(closeTimer.current)
      setOpen(true)
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType !== "mouse") return
      closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS)
    },
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        // A real `<button>` — the trigger opens a menu, it does not navigate,
        // and `aria-expanded` / `aria-haspopup` come from Radix on it.
        className={cn(
          BAR_ITEM_CLASS,
          groupActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        {...hoverProps}
      >
        {t(group.labelKey)}
        {/* Turns over when the panel opens, so the trigger says which state it
            is in without relying on the panel being visible. `motion-reduce`
            drops the animation rather than the rotation — the arrow still ends
            up pointing the right way for a reader who has asked for less
            motion. */}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 opacity-60 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
        {/* The group carries the marker when the reader is anywhere inside it.
            Without this, navigating into a group loses every indication of
            where you are — the destination's own row is behind a closed
            menu. */}
        {groupActive && <ActiveMarker />}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        // `w-auto` overrides the default, which pins the panel to the trigger's
        // width — right for a select, far too narrow for rows carrying a label
        // and a description.
        className="w-auto min-w-[19rem] max-w-[22rem] p-1.5"
        {...hoverProps}
      >
        <DropdownMenuLabel className="px-2 pt-1 pb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
          {t(group.labelKey)}
        </DropdownMenuLabel>
        {group.items.map((item, index) => (
          <NavMenuEntry
            key={item.href}
            item={item}
            pathname={pathname}
            // A rule above every entry but the first, so a group whose entries
            // each carry two lines does not read as one block of text.
            separated={index > 0}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A mutable timeout handle that clears itself on unmount. Small enough to
 * inline, but a menu that unmounts mid-hover would otherwise leave a timer
 * calling `setOpen` on a gone component. */
function useTimeoutRef() {
  const [ref] = useState<{ current: ReturnType<typeof setTimeout> | undefined }>(() => ({
    current: undefined,
  }))
  useEffect(() => () => clearTimeout(ref.current), [ref])
  return ref
}

function NavMenuEntry({
  item,
  pathname,
  separated,
}: {
  item: NavItem
  pathname: string
  separated: boolean
}) {
  const { t } = useLocale()
  const active = isActivePath(pathname, item.href)

  return (
    <>
      {separated && <DropdownMenuSeparator className="my-1" />}
      <DropdownMenuItem asChild>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex-col items-start gap-0.5 rounded-md px-2 py-2",
            // A left rule rather than the bar's underline: these are stacked
            // rows. Transparent on the inactive ones rather than absent, so the
            // active row's text does not shift 2 px right of its neighbours.
            "border-l-2",
            active ? "border-gold-brand bg-accent" : "border-transparent",
          )}
        >
          <span className="font-medium text-sm">{t(item.labelKey)}</span>
          {item.descriptionKey && (
            <span className="text-muted-foreground text-xs leading-snug">
              {t(item.descriptionKey)}
            </span>
          )}
        </Link>
      </DropdownMenuItem>

      {/* Children, indented under the parent that is still a link in its own
          right. `/votes/own-resources` is the only one today, and it had no
          route into it from the chrome at all before this. */}
      {item.children?.map((child) => (
        <DropdownMenuItem key={child.href} asChild>
          <Link
            href={child.href}
            aria-current={isActivePath(pathname, child.href) ? "page" : undefined}
            className={cn(
              "ml-3 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 border-l-2",
              isActivePath(pathname, child.href)
                ? "border-gold-brand bg-accent"
                : "border-border/60",
            )}
          >
            <span className="font-medium text-[0.8rem]">{t(child.labelKey)}</span>
            {child.descriptionKey && (
              <span className="text-muted-foreground text-xs leading-snug">
                {t(child.descriptionKey)}
              </span>
            )}
          </Link>
        </DropdownMenuItem>
      ))}
    </>
  )
}
