"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  DEFAULT_LOCALE,
  getTranslator,
  isLocale,
  type Locale,
  localeFromNavigator,
  type TranslationKey,
  type TranslationValues,
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
 *
 * ## Three sources, in this precedence
 *
 * 1. **The stored choice.** A reader who pressed the toggle has stated a
 *    preference, and nothing may override it.
 * 2. **The browser's own language list** (`navigator.languages`), for a first
 *    visit. Consulted rather than trusting `initialLocale` alone because the
 *    two disagree in practice: `Accept-Language` can be stripped by a proxy,
 *    absent on a prefetch, or normalised to one tag by a CDN, in which case
 *    the server negotiated against nothing and handed back the default. The
 *    browser still knows, so it is asked.
 * 3. **German**, the default — see `DEFAULT_LOCALE`. A browser set to French
 *    gets German, not English: the audience is German and the subject is the
 *    Bundestag.
 *
 * The browser check only ever *upgrades* away from the fallback. If the server
 * already negotiated a locale off a real header, that answer stands — it saw
 * quality values, which `navigator.languages` does not carry — so this cannot
 * flip a reader whose header said `en;q=0.9, de;q=0.3` into German just
 * because German appears later in their browser's list.
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
      return
    }
    // No stored choice: this is a first visit, so fall back to the browser's
    // own list. Only when the server landed on the default — see the note
    // above on why a negotiated answer is not second-guessed.
    if (initialLocale === DEFAULT_LOCALE) {
      setLocaleState(localeFromNavigator(navigator.languages ?? [navigator.language]))
    }
  }, [initialLocale])

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
      // `getTranslator` rather than an inline `(key, values) => t(key, locale,
      // values)`: binding a locale to `t` is one operation, and it should have
      // one implementation whether the caller is a client component or a
      // server one.
      t: getTranslator(locale),
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
