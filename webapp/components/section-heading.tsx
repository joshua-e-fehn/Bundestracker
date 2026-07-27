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
 * route; this is the `h2` above one section of it. Both take translation *keys*
 * rather than strings, and for the reason that component's header gives: a
 * caller resolving the text would freeze it at whatever locale was negotiated,
 * so the heading would stay German while the table under it switched to English.
 *
 * `id` goes on the `h2` itself rather than on the wrapper, so a section's
 * `aria-labelledby` resolves to the heading text and not to a box that also
 * contains the link.
 *
 * `className` exists for the margin only. The home page's sections carry their
 * own `mb-4` while /parties spaces its children with a flex `gap`, and
 * hard-coding either would put a double gap on one of them.
 */
export function SectionHeading({
  id,
  titleKey,
  subtitleKey,
  href,
  className,
}: {
  id: string
  titleKey: TranslationKey
  subtitleKey?: TranslationKey
  /** Where "show all" goes. Omitted where the section is already the whole
   * thing rather than a preview of it. */
  href?: string
  className?: string
}) {
  const { t } = useLocale()

  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="grid gap-1">
        <h2 id={id} className="font-semibold text-lg tracking-tight">
          {t(titleKey)}
        </h2>
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
