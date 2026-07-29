import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeading } from "@/components/page-heading"
import { PartyComparison } from "@/components/party-comparison"
import { PeriodScope } from "@/components/period-scope"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/parties` — the Fraktion comparison dashboard, for the Wahlperiode `?wp=`
 * names. The groups themselves differ between periods — FDP and Linke sat in
 * WP19 and WP20 and one of them does not sit now — so this is a page whose
 * *rows* change with the selector, not only its numbers.
 *
 * A server component rendering client ones, the shape AGENTS.md asks for: the
 * interactivity (the radar's legend filter, the metric tabs) and the Convex
 * subscriptions live below this boundary, so what ships as JS is the charts and
 * not the page.
 *
 * German metadata, matching every other route here: `generateMetadata` cannot
 * see the client-side language toggle, so the tab title is the default locale's
 * while the page content follows the reader's choice.
 */
export const metadata: Metadata = {
  title: t("parties.title", DEFAULT_LOCALE),
  description: t("parties.subtitle", DEFAULT_LOCALE),
}

export default function PartiesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="parties.title" subtitleKey="parties.subtitle" />
      {/* The component itself, not a closure over it: a function cannot cross
          the server/client boundary. See components/period-scope.tsx — and
          app/rankings/page.tsx for why the `Suspense` boundary is required. */}
      <Suspense>
        <PeriodScope component={PartyComparison} />
      </Suspense>
    </main>
  )
}
