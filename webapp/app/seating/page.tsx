import type { Metadata } from "next"
import { Suspense } from "react"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { Seating } from "@/components/seating"
import { SyntheticSeatingNotice } from "@/components/seating-notice"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/seating` — the hemicycle, for the Wahlperiode `?wp=` names.
 *
 * A server component rendering client ones, the shape AGENTS.md asks for: the
 * interactivity (colour mode, zoom, tooltips) and the Convex subscriptions live
 * below this boundary.
 *
 * ## The notice is part of the page, not a footnote
 *
 * §9 of docs/api-research.md is unambiguous: **no machine-readable seating plan
 * exists**, anywhere. The seat *distribution* on this page is real — counted from
 * the roster — and every individual seat's position is invented. A diagram of a
 * parliament is read as a diagram of that parliament, so shipping one without
 * saying which half is real would be the most misleading thing this codebase
 * does. Hence the notice renders above the map, unconditionally, at full
 * contrast, before any data has loaded.
 *
 * The notice is period-independent for the same reason, and that is worth
 * stating now that the page can show a closed Wahlperiode: the arc is
 * constructed in *every* period including the current one, so a historical
 * seating page is not more invented than today's. `period.source.seating.equal`
 * says so on the page rather than leaving a reader to assume the older one is
 * the worse of the two.
 *
 * German metadata, matching every other route here: `generateMetadata` cannot see
 * the client-side language toggle, so the tab title is the default locale's while
 * the page content follows the reader's choice.
 */
export const metadata: Metadata = {
  title: t("seating.title", DEFAULT_LOCALE),
  description: t("seating.subtitle", DEFAULT_LOCALE),
}

export default function SeatingPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="seating.title" subtitleKey="seating.subtitle" />
      <SyntheticSeatingNotice />
      {/* The component itself, not a closure over it: a function cannot cross
          the server/client boundary. See components/period-scope.tsx — and
          app/rankings/page.tsx for why the `Suspense` boundary is required. */}
      <Suspense>
        <PeriodScope component={Seating} />
      </Suspense>
    </main>
  )
}
