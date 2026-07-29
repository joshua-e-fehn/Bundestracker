"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLocale } from "@/components/providers/locale-provider"
import { useSidebar } from "@/components/providers/sidebar-provider"
import { SidebarAccount } from "@/components/sidebar-account"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  isActivePath,
  NAV_ACCOUNT,
  NAV_GROUPS,
  NAV_PRIMARY,
  NAV_SEARCH,
  type NavItem,
  navCurrent,
} from "@/lib/navigation"
import { cn } from "@/lib/utils"

/**
 * The desktop navigation: a real left sidebar, part of the page shell.
 *
 * Replaces both the eight-link row this site started with and the grouped
 * header dropdowns that briefly replaced it. The dropdowns were a
 * misunderstanding of the request — the ask was for the app-shell pattern the
 * reference implementation (Fiscalis) uses, and a menu that opens on hover over
 * a 56 px bar is not that, however well-grouped its contents are.
 *
 * ## What this takes from the reference, and what it does not
 *
 * Taken: the shell shape (a fixed rail beside a content column that reflows
 * around it, rather than an overlay that covers it), `collapsible="icon"`
 * semantics, a persisted collapse state, `Ctrl/⌘+B`, tooltips standing in for
 * the labels the collapsed state hides, grouped sections with a label over
 * each, the trigger at the far left of the header rather than inside the rail,
 * and the account at the rail's foot.
 *
 * Not taken: shadcn's `sidebar.tsx` itself, all 773 lines of it. That file
 * carries a mobile `Sheet` branch driven by a `useIsMobile` media-query hook, a
 * `SidebarRail` drag affordance, menu badges, skeletons, actions, three
 * `variant`s and two `side`s — of which this site uses the rail and nothing
 * else. Vendoring it would have added a second sheet implementation beside
 * `components/ui/sheet.tsx`, a second breakpoint system (JS `matchMedia`)
 * beside the CSS one everything else here uses, and a `TooltipProvider` beside
 * the one already in the root layout. The protocol's rule is not to introduce a
 * second way to do something that already exists, so this is the rail written
 * against the primitives this repo already has.
 *
 * ## Why the earlier objections to a sidebar do not hold, and what remains
 *
 * The grouped-header version argued three reasons a rail was wrong here. Two
 * were real and are answered by *collapsing* rather than by not having one:
 *
 *  - **The content column's width.** Every page is a centred `max-w-6xl` of
 *    tables, charts and a seating arc, already tight at 1024 px. That is why
 *    the sidebar collapses to a 3.5 rem rail and why the collapsed state is
 *    one click away and remembered — a reader who wants the width can take it
 *    back permanently. It is also why the shell has no sidebar at all below
 *    `lg`, where there is no width to give.
 *  - **Icon-only is not honest for these labels.** "Sitzverteilung" and
 *    "Untersuchungsausschuss" have no conventional glyph. Correct — which is
 *    why the collapsed rail is not icon-*only*: every row keeps an
 *    `aria-label` carrying the full label, and a tooltip showing it. The
 *    expanded state is the default precisely because the words are the honest
 *    version, and a first-time reader gets it.
 *
 * The third — that a public document should not make a reader discover and
 * expand a rail — is the one this design answers by *defaulting to expanded*
 * and persisting only a deliberate collapse (see lib/sidebar-state.ts).
 *
 * ## The active state is two statements, not one
 *
 * The gold rule marks the reader's *section* — a prefix match, so `/votes`
 * stays marked on `/votes/own-resources`. `aria-current` is narrower: `page`
 * only on the exact destination, `true` on an ancestor. That distinction is the
 * PR #41 correction and it is preserved here unchanged; `navCurrent` in
 * lib/navigation.ts carries the full note on why the two answer differently.
 */
export function NavSidebar() {
  const { t } = useLocale()
  const { expanded } = useSidebar()
  const pathname = usePathname()

  return (
    // `fixed`, not `sticky`. The page is one scrolling document with a footer
    // at the bottom of it; a sticky rail would scroll with that document and
    // leave the navigation somewhere above the fold on a long page like /mps.
    // `top-14` clears the header, whose 3 px federal rule sits above its own
    // 56 px — so the rail begins exactly where the header's bottom border is
    // rather than sliding under it.
    //
    // Hidden below `lg` in CSS rather than by a JavaScript viewport check: both
    // this and the mobile drawer are in the server HTML and the browser picks
    // one before hydration, so a phone never paints a 16 rem rail it is about
    // to remove.
    <div
      data-state={expanded ? "expanded" : "collapsed"}
      className={cn(
        // `top-…`/`bottom-0` spelled separately rather than as `inset-y-0` plus
        // an override: two Tailwind utilities of equal specificity are resolved
        // by their order in the *generated stylesheet*, not in the class
        // attribute, so `inset-y-0 top-[…]` is a coin flip on whether the rail
        // starts below the header or behind it.
        "fixed top-[calc(3.5rem+3px)] bottom-0 left-0 z-40 hidden lg:flex",
        "flex-col border-border/60 border-r bg-sidebar text-sidebar-foreground",
        // The one animated property, and it is animated on the *shell* rather
        // than on the content beside it: `--shell-inset` in app/globals.css
        // drives the page's left padding off the same duration, so the rail and
        // the column it makes room for move together. `motion-reduce` drops the
        // transition rather than the collapse — a reader who asked for less
        // motion still gets both states, they just arrive instantly.
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        expanded ? "w-64" : "w-14",
      )}
    >
      {/* `aria-label` rather than a heading: this is a landmark, and a page with
          three `<nav>` elements (this, the mobile drawer, the footer) needs each
          named or a screen reader announces "navigation" three times with no way
          to tell them apart. */}
      <nav
        aria-label={t("nav.primary")}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-2 py-3"
      >
        {/* The overview, above the groups and in none of them — it is not a
            category, it is all three at once. See `NAV_PRIMARY`. */}
        <SidebarLink item={NAV_PRIMARY} pathname={pathname} expanded={expanded} />

        {/* ⚠ `grid-cols-[minmax(0,1fr)]` on both levels, not a bare `grid`.
            A grid's implicit column is `auto`, which sizes to its *widest*
            item and refuses to shrink below it — so the child row's
            "Abstimmungen über eigene Angelegenheiten" (286 px of text) made
            its whole group 97 px wider than the 256 px rail, pushing three
            rows out under the page. `truncate` on the label cannot help: the
            track it sits in has already agreed to be that wide. Measured in
            Chromium at 1440 px in both locales; English overflowed by 81 px
            on the same three rows. */}
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-0.5">
            <GroupLabel expanded={expanded}>{t(group.labelKey)}</GroupLabel>
            {group.items.map((item) => (
              <div key={item.href} className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
                <SidebarLink item={item} pathname={pathname} expanded={expanded} />
                {/* Children stay visible rather than living behind a
                    disclosure. There is exactly one today
                    (`/votes/own-resources`) and it is the route that had no
                    entry at all before the redesign — putting it behind a
                    chevron would be re-hiding the thing this work exists to
                    surface. The reference implementation collapses its
                    children because it has seven of them under one parent; one
                    child is not a list that needs managing.

                    Collapsed, the indent would put a 16 px glyph off the edge
                    of a 3.5 rem rail, so `nested` is dropped there and the
                    child sits flush as its own icon. */}
                {item.children?.map((child) => (
                  <SidebarLink
                    key={child.href}
                    item={child}
                    pathname={pathname}
                    expanded={expanded}
                    nested={expanded}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}

        {/* Search: a box in the header at these widths, so it is here as an
            entry only for the rail's sake — a reader scanning a column of
            glyphs should not find the site's search missing from it. See
            `NAV_SEARCH`. */}
        <div className="mt-3 grid gap-0.5 border-border/60 border-t pt-3">
          <SidebarLink item={NAV_SEARCH} pathname={pathname} expanded={expanded} />
        </div>
      </nav>

      {/* The account, at the bottom edge and pinned there by the nav's `flex-1`
          above it. `mt-auto` is not needed — the nav already absorbs the slack.

          This slot used to hold the collapse control. That moved to the far
          left of the header (components/sidebar-toggle.tsx), which left the
          foot of the rail free for the thing an app shell conventionally puts
          there and this site had nowhere good for: the reader's own account.
          It is the header's `<UserMenu />` moved rather than copied — see
          components/sidebar-account.tsx on why there is not one of each.

          Settings sits directly above it rather than in one of the three
          groups: it is the site's only destination whose subject is the reader
          rather than the Bundestag, so it belongs beside their account and not
          among the parliamentary sections. See `NAV_ACCOUNT`. Above the account
          row rather than inside its dropdown, because that menu exists only
          when signed in and the page's signed-out rendering — the one that
          explains what an account is for — would then be unreachable by exactly
          the readers it addresses.

          ⚠ It is inside a `<nav>` of its own rather than a bare `<div>`. The
          first version put it in this footer directly, which looks identical
          and is not: a screen-reader user navigating by landmark would find
          nine destinations in the primary navigation and no settings, because
          a link outside every `<nav>` is not in any navigation as far as
          assistive technology is concerned. Found by
          scripts/verify-settings-follow.py, whose sidebar check is written as
          `nav a[href="/settings"]` for exactly this reason.

          A second landmark rather than moving the row up into the primary one:
          the account is pinned to the rail's foot by the primary nav's
          `flex-1`, and putting settings above that boundary would either
          unpin the account or separate the two things this slot exists to
          pair. Named, because a page with several `<nav>`s needs each labelled
          or they all announce as "navigation". */}
      <div className="border-border/60 border-t p-2">
        <nav aria-label={t("nav.accountArea")} className="grid gap-1">
          <SidebarLink item={NAV_ACCOUNT} pathname={pathname} expanded={expanded} />
          <SidebarAccount expanded={expanded} />
        </nav>
      </div>
    </div>
  )
}

/**
 * A group's name.
 *
 * Collapsed, it is replaced by a rule rather than simply hidden. Hiding it
 * outright would run the three groups' icons together into one undifferentiated
 * column of nine — which is the "wall of links" this whole redesign exists to
 * undo, rebuilt in glyphs. The reference implementation animates its label to
 * `opacity: 0` and pulls it up with a negative margin, which leaves exactly
 * that undifferentiated column; a hairline keeps the grouping legible at a
 * glance without claiming space for words that would not fit.
 */
function GroupLabel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  if (!expanded) {
    return <div aria-hidden className="mx-2 mb-1 h-px bg-border/60" />
  }
  return (
    <h2 className="px-2 pt-1 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
      {children}
    </h2>
  )
}

function SidebarLink({
  item,
  pathname,
  expanded,
  nested = false,
}: {
  item: NavItem
  pathname: string
  expanded: boolean
  nested?: boolean
}) {
  const { t } = useLocale()
  // The prefix match — the *visual* statement, "you are in this section". The
  // narrower `navCurrent` below is the announced one. See lib/navigation.ts.
  const active = isActivePath(pathname, item.href)
  const label = t(item.labelKey)
  const Icon = item.icon

  const link = (
    <Link
      href={item.href}
      // `page` only when this *is* the page; `true` when it merely contains it.
      // The PR #41 correction, preserved.
      aria-current={navCurrent(pathname, item.href)}
      // The label as an accessible name in both states. Collapsed, the `<span>`
      // is not rendered at all — so without this the row would announce as a
      // bare link with no name, and the tooltip does not supply one (it is
      // pointer-driven and a screen reader may never open it).
      aria-label={expanded ? undefined : label}
      // Expanded, the one label long enough to be clipped by `truncate`
      // ("Abstimmungen über eigene Angelegenheiten", 286 px into a 181 px
      // track) is otherwise unreadable past the ellipsis. `title` is the
      // browser's own recovery for exactly that and costs nothing on the ten
      // rows that fit. Not a `Tooltip`: this row is already a full-width link,
      // so a floating panel repeating a label that is 95 % visible would fire
      // on every pass of the pointer down the rail.
      title={expanded ? label : undefined}
      className={cn(
        // `min-w-0` so the flex row itself may shrink below its content's
        // intrinsic width — without it a flex item's `min-width: auto` floor is
        // the label's full length, and `truncate` on the span below never
        // engages. The grid tracks above and this are the two halves of the
        // same fix; either one alone still overflows.
        "relative flex h-9 min-w-0 items-center gap-2.5 rounded-md text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        // Collapsed rows centre their glyph in the rail; expanded ones are a
        // normal left-aligned row. `shrink-0` on the icon below is what keeps
        // the glyph its own size while the label is being clipped mid-collapse.
        expanded ? "px-2.5" : "justify-center px-0",
        nested && "ml-3",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {/* The section marker: a gold rule down the left edge of the row. A
          *shape* rather than only a colour, so it survives greyscale and
          colour-vision deficiency — the same reasoning the old header's
          underline carried, moved to the edge a vertical list has. Absolutely
          positioned so turning it on shifts nothing. */}
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold-brand"
        />
      )}
      <Icon aria-hidden className="size-4 shrink-0" />
      {/* Rendered only when expanded rather than hidden with CSS. A label
          clipped by `overflow-hidden` is still in the accessibility tree and
          still found by the browser's find-in-page, so a collapsed rail would
          have announced every label twice — once from `aria-label` and once
          from the text it names. */}
      {expanded && <span className="truncate">{label}</span>}
    </Link>
  )

  // Expanded, the label is on screen and a tooltip repeating it is noise that
  // follows the pointer. Collapsed, it is the only way to read the rail, so the
  // tooltip is the label — which is why this is conditional rather than always
  // mounted with a `hidden` prop, the shape the reference implementation uses.
  if (expanded) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
