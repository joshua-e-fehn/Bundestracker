"use client"

import { LanguagesIcon } from "lucide-react"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LOCALE_LABELS, LOCALES } from "@/lib/i18n"

/**
 * The DE/EN switch.
 *
 * A menu rather than a cycling button, because a two-state cycle gives no
 * indication of what the other state is — a reader who cannot read the current
 * language cannot tell what pressing it would do. The options name themselves
 * ("Deutsch", "English", from `LOCALE_LABELS`), which is the one labelling that
 * works regardless of which language the reader has.
 *
 * The choice is client state, not a route: Bundestrack serves one URL per page
 * in both languages (see lib/i18n.ts). `LocaleProvider` persists it.
 *
 * `variant`/`className` are forwarded because the mobile sheet renders this as
 * a full-width row while the header renders it as an icon button — same
 * component, two presentations, rather than two components.
 */
export function LocaleToggle({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
}) {
  const { locale, setLocale, t } = useLocale()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={showLabel ? "sm" : "icon-sm"}
          className={className}
          aria-label={t("nav.language")}
        >
          <LanguagesIcon />
          {showLabel ? LOCALE_LABELS[locale] : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {LOCALES.map((value) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setLocale(value)}
            data-active={locale === value ? "" : undefined}
            className="data-active:bg-accent"
          >
            {LOCALE_LABELS[value]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
