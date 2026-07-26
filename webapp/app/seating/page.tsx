import type { Metadata } from "next"
import { CurrentPeriod } from "@/components/current-period"
import { PageHeading } from "@/components/page-heading"
import { Seating } from "@/components/seating"
import { SyntheticSeatingNotice } from "@/components/seating-notice"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/seating` — the hemicycle.
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
          the server/client boundary. See components/current-period.tsx. */}
      <CurrentPeriod component={Seating} />
    </main>
  )
}
