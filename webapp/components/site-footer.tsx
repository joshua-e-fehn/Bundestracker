"use client"

import { ExternalLinkIcon } from "lucide-react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { LocaleToggle } from "@/components/locale-toggle"
import { useLocale } from "@/components/providers/locale-provider"
// Both URLs used to be file-private constants here, which was right while the
// footer was the only thing linking out. /about names the same two sources, and
// two copies of an address are how the two come to disagree. See lib/links.ts.
import { BUNDESTAG_OPEN_DATA_URL, REPO_URL } from "@/lib/links"

/**
 * Site footer: attribution, source, language, byline.
 *
 * The disclaimer is not boilerplate. Bundestrack presents official
 * parliamentary data under its own name and computes a score over it, and the
 * score is an editorial weighting (see lib/scoring.ts) — a reader is entitled to
 * know on every page that this is not published by the Bundestag.
 */
export function SiteFooter() {
  const { t } = useLocale()

  return (
    <footer className="mt-auto border-border/60 border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1.5">
            <span className="flex items-center gap-2 font-semibold text-sm">
              <BrandMark className="size-4" />
              {t("app.name")}
            </span>
            <span className="text-muted-foreground text-sm">{t("app.tagline")}</span>
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {/* The dashboard, first. `/` is the narrative page, so this is the
                one route that is otherwise reachable only from the header — and
                the footer is where a reader who has scrolled to the bottom of
                the story is standing when they decide they would rather have
                the numbers. */}
            <Link
              href="/dashboard"
              className="rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("nav.dashboard")}
            </Link>
            {/* The disclaimer below states that Bundestrack is not the
                Bundestag's own; this is where a reader who wants to know what it
                *is* — and what the figures do and do not measure — goes from any
                page on the site. `Link` rather than `<a>`: an in-app route,
                unlike the two outbound links beside it, so it has no
                external-link icon and does not open a tab. */}
            <Link
              href="/about"
              className="rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("nav.about")}
            </Link>
            <a
              href={BUNDESTAG_OPEN_DATA_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("footer.dataSourceName")}
              <ExternalLinkIcon className="size-3.5" />
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("footer.sourceCode")}
              <ExternalLinkIcon className="size-3.5" />
            </a>
            <LocaleToggle showLabel className="-ml-2 text-muted-foreground" />
          </nav>
        </div>

        <div className="flex flex-col gap-2 border-border/60 border-t pt-6 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl">{t("footer.disclaimer")}</p>
          <p className="shrink-0">{t("footer.builtBy")}</p>
        </div>
      </div>

      {/* The flag again, closing the page as the header opened it. Full-bleed
          rather than inset to the `max-w-6xl` content column: it is the
          document's bottom edge, and a rule that stopped short of the viewport
          on a wide screen would read as an element on the page rather than as
          its border. See `federal-rule` in app/globals.css. */}
      <div aria-hidden className="federal-rule h-[3px] w-full" />
    </footer>
  )
}
