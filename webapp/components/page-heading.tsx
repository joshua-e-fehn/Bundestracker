"use client"

import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"

/**
 * A page's title and standfirst, translated.
 *
 * A client component for one reason: the language toggle is client-side (see
 * lib/i18n.ts), so text that must change when the reader flips it cannot be
 * rendered by the server page above. Taking *keys* rather than strings is what
 * keeps that boundary honest — a server page passing already-translated text
 * would freeze it at the server's negotiated locale and the heading would stay
 * German while the table below switched to English.
 */
export function PageHeading({
  titleKey,
  subtitleKey,
}: {
  titleKey: TranslationKey
  subtitleKey?: TranslationKey
}) {
  const { t } = useLocale()
  return (
    <header className="flex flex-col gap-2">
      <h1 className="font-semibold text-3xl tracking-tight">{t(titleKey)}</h1>
      {subtitleKey !== undefined && <p className="text-muted-foreground">{t(subtitleKey)}</p>}
    </header>
  )
}
