import type { Metadata } from "next"
import { SettingsPage } from "@/components/settings-page"
import { CURRENT_WAHLPERIODE } from "@/lib/bundestag"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/settings` — the reader's own saved choices.
 *
 * The route the 2026-07-29 audit records as never having existed (GAP-007),
 * under four `userPreferences` functions that had been finished and left with
 * no caller (GAP-006), while the sign-in page and `/about` both told readers in
 * German and English that an account saves custom weightings and a follow list
 * (GAP-008). This page is what those sentences were describing.
 *
 * Server component rendering a client one, the split AGENTS.md asks for: the
 * page and its metadata are static, and everything on it — the session, the
 * preference queries, the sliders — needs the browser.
 *
 * `CURRENT_WAHLPERIODE` rather than `mps.getCurrentWahlperiode`, matching
 * app/mps/page.tsx and app/mps/[id]/page.tsx: this is the roster period the
 * watchlist resolves names and portraits against, and taking it from the
 * constant keeps the followed list and the profiles it links to answering for
 * the same Bundestag.
 *
 * German metadata like every other route here — `generateMetadata` cannot see
 * the client-side language toggle (see app/layout.tsx).
 *
 * `robots: noindex` for the same reason `/sign-in` carries it: this page is
 * empty of content for anyone who is not the reader it belongs to, and a search
 * engine surfacing it would offer a settings page to people with no settings.
 */
export const metadata: Metadata = {
  title: t("settings.title", DEFAULT_LOCALE),
  description: t("settings.subtitle", DEFAULT_LOCALE),
  robots: { index: false, follow: true },
}

export default function Settings() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
      <SettingsPage wahlperiode={CURRENT_WAHLPERIODE} />
    </main>
  )
}
