import { cookies, headers } from "next/headers"
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale, localeFromAcceptLanguage } from "./i18n"

/**
 * Server-side locale resolution — the one gate every page's `<title>` reads.
 *
 * Kept apart from `lib/i18n.ts` because `next/headers` may only be imported
 * from server code, and `i18n.ts` is imported by every component in the app —
 * folding the two would poison the client bundle with a `next/headers` symbol
 * that Turbopack refuses to compile.
 *
 * Precedence:
 * 1. **The `bundestrack.locale` cookie.** Written by the language toggle
 *    (components/providers/locale-provider.tsx `setLocale`), so this is the
 *    reader's explicit choice on this device. Wins over everything.
 * 2. **`Accept-Language`.** What the browser was configured to send, honoured
 *    with q-values. This is the answer for a first visit before any toggle
 *    has been pressed.
 * 3. **German**, the fallback, for the reason `DEFAULT_LOCALE` is German: the
 *    audience is German and the subject is the Bundestag.
 *
 * `navigator.languages` is deliberately absent from this list — the browser's
 * own list is only reachable in the client, and applying it here would put
 * an English metadata `<title>` above a page that will hydrate to German
 * (because localStorage held `de` from a previous visit). See the
 * `LocaleProvider` header for the four-source rule the client follows, which
 * this three-source server rule mirrors as closely as an SSR call can.
 */
export async function resolveServerLocale(): Promise<Locale> {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()])
  const cookie = cookieStore.get(LOCALE_COOKIE)?.value
  if (cookie && isLocale(cookie)) return cookie
  return localeFromAcceptLanguage(requestHeaders.get("accept-language")) ?? DEFAULT_LOCALE
}
