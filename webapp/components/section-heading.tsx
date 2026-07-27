"use client"

import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import type { TranslationKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * A section's title, standfirst and optional "show all" link.
 *
 * Distinct from `components/page-heading.tsx`, which is the `h1` at the top of a
 * route; this is the heading above one section of it. Both take translation
 * *keys* rather than strings, and for the reason that component's header gives:
 * a caller resolving the text would freeze it at whatever locale was
 * negotiated, so the heading would stay German while the table under it
 * switched to English.
 *
 * `id` goes on the heading itself rather than on the wrapper, so a section's
 * `aria-labelledby` resolves to the heading text and not to a box that also
 * contains the link.
 *
 * `className` exists for the margin only. The home page's sections carry their
 * own `mb-4` while /parties spaces its children with a flex `gap`, and
 * hard-coding either would put a double gap on one of them.
 *
 * ## Why the level is a prop
 *
 * It was a hardcoded `h2`, which is right on every page that puts these
 * directly under its `h1`. The narrative home page (app/home-a/page.tsx) nests
 * them one level deeper — each chapter is an `h2` and the boards inside it are
 * subsections — so a fixed `h2` flattened the outline: "Wer ist aktiv?" and
 * "Aktivste Abgeordnete" came out as siblings, which tells a screen reader the
 * board is a peer of the chapter rather than part of it, and makes the page's
 * five chapters indistinguishable from its eleven sections.
 *
 * A number rather than a tag name, so the call site says *how deep* it is and
 * not which element to emit — the styling is the same at both levels, since
 * these are visually the same object in two nestings.
 */
export function SectionHeading({
  id,
  titleKey,
  subtitleKey,
  href,
  level = 2,
  className,
}: {
  id: string
  titleKey: TranslationKey
  subtitleKey?: TranslationKey
  /** Where "show all" goes. Omitted where the section is already the whole
   * thing rather than a preview of it. */
  href?: string
  /** Heading depth. 2 by default — a section directly under a page's `h1`.
   * Pass 3 where the section is nested inside another titled one. */
  level?: 2 | 3
  className?: string
}) {
  const { t } = useLocale()
  const Heading = level === 3 ? "h3" : "h2"

  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="grid gap-1">
        <Heading id={id} className="font-semibold text-lg tracking-tight">
          {t(titleKey)}
        </Heading>
        {subtitleKey ? <p className="text-muted-foreground text-sm">{t(subtitleKey)}</p> : null}
      </div>
      {href ? (
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href={href}>
            {t("home.showAll")}
            <ArrowRightIcon />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
