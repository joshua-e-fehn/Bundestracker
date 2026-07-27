"use client"

import { useQuery } from "convex/react"
import { MenuIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { BrandMark } from "@/components/brand-mark"
import { LocaleToggle } from "@/components/locale-toggle"
import { useLocale } from "@/components/providers/locale-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { UserMenu } from "@/components/user-menu"
import { api } from "@/convex/_generated/api"
import type { TranslationKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The primary navigation.
 *
 * One list, rendered twice — inline above `md`, inside a sheet below it. The
 * alternative (two lists behind CSS visibility) is how a link ends up in one and
 * not the other, which nobody notices because only one is ever on screen at a
 * time.
 *
 * ## Every entry here must be a route that exists
 *
 * This list was originally written against German paths (`/abgeordnete`,
 * `/rangliste`) while the shell was being built and the pages were not. The
 * pages then landed on another branch at English paths — the spelling
 * `lib/auth-routes.ts` also uses — so all five links pointed at 404s once the
 * two branches were merged.
 *
 * So the rule is the one `lib/auth-routes.ts` already states for its own list: a
 * link goes in when its page does, not before. A nav entry for an unbuilt page
 * costs nothing to add later and, until then, is indistinguishable to a reader
 * from a broken site. `nav.votes` and `nav.motions` keep their dictionary
 * entries for whichever branch builds those pages.
 */
const NAV_LINKS: ReadonlyArray<{ href: string; labelKey: TranslationKey }> = [
  { href: "/mps", labelKey: "nav.members" },
  { href: "/votes", labelKey: "nav.votes" },
  { href: "/rankings", labelKey: "nav.rankings" },
  { href: "/seating", labelKey: "nav.seating" },
  { href: "/feed", labelKey: "nav.feed" },
]

/** One spelling of a path in both languages, deliberately. The URLs are shared
 * artefacts — a link pasted into a chat should not read differently depending on
 * who copied it. */
function useIsActive() {
  const pathname = usePathname()
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Which Bundestag the site is showing, as a chip in the header.
 *
 * Renders nothing at all while the query is in flight, and nothing when the
 * roster is empty — the two states a fresh deployment passes through. A
 * skeleton here would be a shimmer in the chrome on every page load for a fact
 * that is decoration; and `null` for an unloaded roster keeps the header from
 * asserting a period that has no data behind it, which is the same distinction
 * `getCurrentWahlperiode` draws for the pages below.
 *
 * Hidden below `sm`, where the three controls and the menu button already fill
 * the bar.
 */
function CurrentPeriodBadge() {
  const { t } = useLocale()
  const wahlperiode = useQuery(api.mps.getCurrentWahlperiode)

  if (wahlperiode === undefined || wahlperiode === null) return null

  return (
    <span
      title={t("nav.periodLabel", { wahlperiode })}
      className="mr-1 hidden rounded-full border border-border/60 px-2.5 py-1 font-medium text-muted-foreground text-xs tabular-nums sm:inline-block"
    >
      {t("nav.period", { wahlperiode })}
    </span>
  )
}

export function SiteHeader() {
  const { t } = useLocale()
  const isActive = useIsActive()
  // Controlled so that following a link closes the sheet. Without this the
  // panel stays open over the page it just navigated to.
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-border/60 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      {/* The flag, as a hairline along the very top of the page. `federal-rule`
          is defined in app/globals.css, which explains at length why the flag
          is confined to 3 px rather than used as UI colour — in short, the page
          already carries meaning-bearing colour in six party hues and a
          red-gold interface underneath them would leave nothing readable as an
          accent.

          It goes on the *header* rather than on `<body>` so it scrolls with
          nothing: the header is sticky, so the rule stays pinned to the top
          edge of the viewport and reads as the site's own edge rather than as a
          decoration that slides away. `aria-hidden` because it is a graphic
          with no accessible content — the wordmark below already names the
          site. */}
      <div aria-hidden className="federal-rule h-[3px] w-full" />

      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        {/* Truncates rather than `shrink-0`. At 320 px the brand's 112 px plus
            the four controls' 187 px came to 307 px inside a 288 px content
            box, so the header — and with it every page, since the document
            scrolls as one — was 19 px wider than the viewport on every route.
            A wordmark that clips is better than a site that scrolls sideways.

            The mark is `shrink-0` inside that truncating box so the eagle
            survives at 320 px and only the word clips — a wordmark reduced to
            "Bundestra…" beside its mark still reads as the brand; a mark
            squeezed to 4 px reads as a rendering fault. */}
        <Link
          href="/"
          className="mr-2 flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BrandMark />
          <span className="min-w-0 truncate font-semibold text-base tracking-tight">
            {t("app.name")}
          </span>
        </Link>

        {/* `lg`, not `md`. The five links measure 564 px; at exactly 768 px —
            where `md:flex` turned them on — the bar needed 913 px and pushed
            the document to 933 px. The sheet below already serves this width
            properly, so the inline nav now waits until there is room for it. */}
        {/* `relative` so each link's underline can be positioned against its own
            box — see the marker below. */}
        <nav aria-label={t("nav.menu")} className="hidden items-center gap-0.5 lg:flex">
          {NAV_LINKS.map(({ href, labelKey }) => (
            <Link
              key={href}
              href={href}
              // `aria-current` rather than only a colour: the active link has to
              // be announceable, not merely visible.
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "relative rounded-md px-2.5 py-1.5 font-medium text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isActive(href)
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(labelKey)}
              {/* The active marker: a gold underline rather than a bolder
                  weight or a filled pill.

                  Three constraints meet here. It must not be *only* colour, so
                  the mark is a shape — a rule under the word — that survives
                  greyscale and colour-vision deficiency; `aria-current` above
                  covers the non-visual case regardless. It must not shift the
                  layout, so it is absolutely positioned and the link keeps its
                  padding whether active or not — a `border-b` toggled on the
                  active link would move every other link by a pixel as you
                  navigate. And it uses `--gold-brand`, the fill tier, because
                  this is a 2 px bar carrying no text: exactly the case
                  app/globals.css reserves the identity colour for. The label
                  itself stays `--foreground`, which is what keeps it readable. */}
              {isActive(href) && (
                <span
                  aria-hidden
                  className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-gold-brand"
                />
              )}
            </Link>
          ))}
        </nav>

        {/* Pushes the controls right and absorbs the slack, so the nav stays
            left-aligned next to the brand at every width. */}
        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-1">
          {/* The slack between the nav and the controls used to be dead space
              roughly 245 px wide at desktop widths. It now carries the one fact
              every page on this site is implicitly scoped to and none of them
              states in the chrome: which Bundestag you are looking at. Read
              from the data rather than from `CURRENT_WAHLPERIODE`, for the
              reason `newestWahlperiode` gives — a constant keeps naming the
              previous Bundestag for months after the next is sworn in. */}
          <CurrentPeriodBadge />

          <LocaleToggle />
          <ThemeToggle />
          <UserMenu className="ml-1" />

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              {/* Paired with the inline nav's `lg:flex` above — the two must
                  flip at the same width or the site has no navigation at all
                  between 768 and 1024 px. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-1 lg:hidden"
                aria-label={t("nav.openMenu")}
              >
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              {/* Required: radix-ui 1.1.23 dropped the dev warning for a
                  dialog with no accessible name, so omitting this produces one
                  silently. */}
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <BrandMark />
                  {t("nav.menu")}
                </SheetTitle>
              </SheetHeader>
              <nav aria-label={t("nav.menu")} className="grid gap-0.5 px-2">
                {NAV_LINKS.map(({ href, labelKey }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive(href) ? "page" : undefined}
                    // The same gold marker as the inline nav, turned on its
                    // side: a rule down the leading edge rather than under the
                    // word, because these are stacked rows rather than a
                    // horizontal strip. `border-l-2` with a transparent border
                    // on the inactive rows rather than a border only on the
                    // active one — otherwise the active row's text would shift
                    // 2 px right of its neighbours.
                    className={cn(
                      "rounded-md border-l-2 px-3 py-2 font-medium text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      isActive(href)
                        ? "border-gold-brand bg-accent text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {t(labelKey)}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
