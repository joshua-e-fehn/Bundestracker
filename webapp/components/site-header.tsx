"use client"

import { MenuIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { LocaleToggle } from "@/components/locale-toggle"
import { useLocale } from "@/components/providers/locale-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { UserMenu } from "@/components/user-menu"
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

export function SiteHeader() {
  const { t } = useLocale()
  const isActive = useIsActive()
  // Controlled so that following a link closes the sheet. Without this the
  // panel stays open over the page it just navigated to.
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-border/60 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="mr-2 shrink-0 rounded-md font-semibold text-base tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t("app.name")}
        </Link>

        <nav aria-label={t("nav.menu")} className="hidden items-center gap-0.5 md:flex">
          {NAV_LINKS.map(({ href, labelKey }) => (
            <Link
              key={href}
              href={href}
              // `aria-current` rather than only a colour: the active link has to
              // be announceable, not merely visible.
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 font-medium text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isActive(href) ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(labelKey)}
            </Link>
          ))}
        </nav>

        {/* Pushes the controls right and absorbs the slack, so the nav stays
            left-aligned next to the brand at every width. */}
        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <LocaleToggle />
          <ThemeToggle />
          <UserMenu className="ml-1" />

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-1 md:hidden"
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
                <SheetTitle>{t("nav.menu")}</SheetTitle>
              </SheetHeader>
              <nav aria-label={t("nav.menu")} className="grid gap-0.5 px-2">
                {NAV_LINKS.map(({ href, labelKey }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive(href) ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-2 font-medium text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      isActive(href)
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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
