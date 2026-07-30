"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  DEFAULT_LOCALE,
  getTranslator,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
  localeCookieValue,
  localeFromNavigator,
  type TranslationKey,
  type TranslationValues,
} from "@/lib/i18n"

const STORAGE_KEY = "bundestrack.locale"

/**
 * Mirrors the pressed-toggle language into a cookie the *next* server render
 * can read.
 *
 * `localStorage` is unreachable from the server, so a reader who pressed the
 * toggle on their previous visit would otherwise get a German `<title>` above
 * an English page for one paint on the next one, and every social-share
 * preview would carry the wrong language. See `LOCALE_COOKIE` in lib/i18n.ts
 * for the wider decision.
 *
 * Client-only writer (`document.cookie` is the DOM's own API), on a defensive
 * `typeof document` guard so a preview-mode call from SSR does not throw.
 * `SameSite=Lax` matches SIDEBAR_COOKIE. No `Secure` — dev serves over `http`,
 * and this cookie carries no secret so a downgrade attack has nothing to
 * steal. The `max-age` is a year; a language choice is not per-session.
 */
function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return
  // Cookie Store API is Chromium-only (no Safari/Firefox as of 2026-07),
  // and the sibling `SIDEBAR_COOKIE` writer uses this same shape — using
  // two mechanisms for the same purpose would give two opportunities to
  // disagree about SameSite/Max-Age.
  // biome-ignore lint/suspicious/noDocumentCookie: see above
  document.cookie = `${LOCALE_COOKIE}=${localeCookieValue(locale)}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
}

type LocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  /**
   * Apply a language saved on the reader's *account*, unless they have already
   * chosen one on this device.
   *
   * Separate from `setLocale` because it is a different act with a different
   * precedence. `setLocale` is the reader pressing the toggle — it wins over
   * everything and is written to localStorage. This is the account's stored
   * answer arriving after the fact, which under the rule below sits *between*
   * a device-local choice and the browser's language list: it is a preference
   * the same person expressed, on another device, so it beats
   * `navigator.languages`; but a toggle pressed in this browser is more recent
   * and more specific, so it does not beat that.
   *
   * Returns nothing and may do nothing. See `SavedLocaleSync`, its one caller.
   */
  adoptSavedLocale: (locale: Locale) => void
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
 * ## Four sources, in this precedence
 *
 * 1. **The stored choice.** A reader who pressed the toggle on *this device*
 *    has stated a preference, and nothing may override it.
 * 2. **The language saved on the account**, for a signed-in reader who has not
 *    chosen on this device. Arrives asynchronously, long after the first paint
 *    — see `adoptSavedLocale` and `SavedLocaleSync` — which is why it is
 *    applied by a call rather than read here.
 * 3. **The browser's own language list** (`navigator.languages`), for a first
 *    visit. Consulted rather than trusting `initialLocale` alone because the
 *    two disagree in practice: `Accept-Language` can be stripped by a proxy,
 *    absent on a prefetch, or normalised to one tag by a CDN, in which case
 *    the server negotiated against nothing and handed back the default. The
 *    browser still knows, so it is asked.
 * 4. **German**, the default — see `DEFAULT_LOCALE`. A browser set to French
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
    // Mirror into the cookie so the next server render (metadata, <html
    // lang>, first paint) already reflects this choice. See writeLocaleCookie
    // for why localStorage alone was not enough.
    writeLocaleCookie(next)
  }, [])

  /**
   * Precedence rule 2, applied when the account's answer arrives.
   *
   * The localStorage read is the whole of it: a key present means this reader
   * has pressed the toggle in this browser, and rule 1 says that wins. Anything
   * else — a first visit, a new device, a cleared browser — has nothing more
   * specific than the account, so the account decides.
   *
   * It does **not** write `STORAGE_KEY`. Doing so would silently promote the
   * account's answer to a device-local choice, after which clearing the
   * preference in settings would leave the old language pinned in every browser
   * that had ever loaded a page while signed in — and there would be no way to
   * tell that state apart from a reader who had genuinely pressed the toggle.
   */
  const adoptSavedLocale = useCallback((next: Locale) => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && isLocale(stored)) return
    setLocaleState(next)
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      adoptSavedLocale,
      // `getTranslator` rather than an inline `(key, values) => t(key, locale,
      // values)`: binding a locale to `t` is one operation, and it should have
      // one implementation whether the caller is a client component or a
      // server one.
      t: getTranslator(locale),
    }),
    [locale, setLocale, adoptSavedLocale],
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
