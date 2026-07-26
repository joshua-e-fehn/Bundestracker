"use client"

import { useLocale } from "@/components/providers/locale-provider"

/**
 * Placeholder landing page.
 *
 * A client component only so the scaffold demonstrates the language toggle
 * end to end. The real pages are server components by default — Bundestrack
 * renders public data, so there is rarely a reason to ship it as JS.
 */
export default function Home() {
  const { t, locale, setLocale } = useLocale()

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="font-semibold text-4xl tracking-tight">{t("app.name")}</h1>
      <p className="text-lg text-muted-foreground">{t("app.tagline")}</p>
      <p className="text-muted-foreground text-sm">{t("app.description")}</p>
      <button
        type="button"
        onClick={() => setLocale(locale === "de" ? "en" : "de")}
        className="self-start rounded-md border px-3 py-1.5 text-sm"
      >
        {t("nav.language")}: {locale.toUpperCase()}
      </button>
    </main>
  )
}
