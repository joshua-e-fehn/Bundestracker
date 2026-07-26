"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * A minimal navigation bar.
 *
 * ## This is a placeholder, and deliberately a small one
 *
 * The real navigation belongs to the `frontend-layout-homepage` branch, whose
 * task covers the brand mark, the language and theme toggles, the sign-in
 * button and the mobile sheet menu. None of that is here, and none of it should
 * be — two branches building one nav is how you get two navs.
 *
 * It exists because `/rankings` and `/feed` are otherwise unreachable except by
 * typing the URL, and a page nothing links to is not shipped. So this is the
 * smallest thing that makes them reachable: the links, and nothing else.
 *
 * **When the layout branch lands, delete this file** and move `NAV_LINKS` into
 * whatever it built. The dictionary keys (`nav.rankings`, `nav.feed`) are added
 * on this branch and will already be there.
 */

const NAV_LINKS: { href: string; labelKey: TranslationKey }[] = [
  { href: "/", labelKey: "nav.home" },
  { href: "/mps", labelKey: "nav.members" },
  { href: "/rankings", labelKey: "nav.rankings" },
  { href: "/feed", labelKey: "nav.feed" },
]

export function SiteNav() {
  const { t, locale, setLocale } = useLocale()
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 z-40 border-border border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-3 sm:px-6">
        <Link href="/" className="mr-3 font-semibold tracking-tight">
          {t("app.name")}
        </Link>

        {NAV_LINKS.slice(1).map((link) => {
          // Exact match, or a section prefix — so `/mps/bt-0001` still marks
          // "Abgeordnete" as current.
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(link.labelKey)}
            </Link>
          )
        })}

        {/* The toggle the layout branch will replace with a proper one. Kept
            because without it an English reader has no way to reach the English
            strings these pages are written in. */}
        <button
          type="button"
          onClick={() => setLocale(locale === "de" ? "en" : "de")}
          className="ml-auto rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          {locale.toUpperCase()}
        </button>
      </div>
    </nav>
  )
}
