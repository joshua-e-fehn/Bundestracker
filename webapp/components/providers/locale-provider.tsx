"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type TranslationKey,
  type TranslationValues,
  t as translate,
} from "@/lib/i18n"

const STORAGE_KEY = "bundestrack.locale"

type LocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, values?: TranslationValues) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

/**
 * Holds the active language and hands components a bound `t`.
 *
 * The choice is a client-side preference, not a route: Bundestrack serves one
 * URL per page in both languages (see lib/i18n.ts). It persists to
 * localStorage so a reload keeps the reader's choice.
 *
 * `initialLocale` comes from the server — negotiated off `Accept-Language` —
 * so the first paint is already in the right language rather than flashing
 * German at an English reader. The stored preference is read in an effect
 * afterwards, because localStorage does not exist during SSR; reading it in
 * `useState` would desync hydration.
 */
export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && isLocale(stored)) {
      setLocaleState(stored)
    }
  }, [])

  // Keeps <html lang> honest as the toggle is used. It matters beyond tidiness:
  // screen readers pick pronunciation from it, and so does the browser's
  // translate prompt.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(key, locale, values),
    }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * The active locale and a bound `t`, for client components.
 *
 * Throws outside the provider rather than falling back to German silently — a
 * component rendering untranslatable text is a wiring bug, and it should
 * surface in development rather than ship looking almost right.
 *
 * Server components import `t` from `@/lib/i18n` directly instead.
 */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (!context) {
    throw new Error("useLocale must be used inside <LocaleProvider>")
  }
  return context
}
