import type { Metadata } from "next"
import { Suspense } from "react"
import { MotionList } from "@/components/motion-list"
import { PageHeading } from "@/components/page-heading"
import { PeriodScope } from "@/components/period-scope"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"

/**
 * `/motions` — the procedures and printed papers of the Wahlperiode `?wp=` names.
 *
 * The other half of `/votes`. That page answers "how did the chamber decide";
 * this one answers "what was put before it", and the two share no rows: a named
 * ballot is a `voteSheets` row and a motion is a `motions` row, joined by
 * nothing the sources publish.
 *
 * A server component rendering client ones, the shape AGENTS.md asks for: the
 * filters, the cursor pager and the live Convex subscription live below this
 * boundary. Same `Suspense` requirement as `/rankings` — `PeriodScope` reads
 * `useSearchParams`, and Next.js fails the *build* for a component that reads it
 * without a boundary above. The fallback is deliberately absent; `PeriodScope`
 * renders its own skeleton.
 *
 * ⚠ Unlike `/votes`, the coverage boundary here is not a date. DIP publishes
 * procedures for every tracked period, so an empty list is always "this
 * deployment has not backfilled it" rather than "the Bundestag published
 * nothing" — which is why this page carries no `SourceCoverageNote` and states
 * the not-loaded case directly instead. `lib/period.ts`'s `PeriodSource` union
 * deliberately has no `motions` member for that reason: a boundary that does not
 * exist should not be modelled as one.
 *
 * Locale-aware metadata via `resolveServerLocale` — see app/layout.tsx for the
 * cookie → header → German precedence.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return {
    title: t("motions.title", locale),
    description: t("motions.subtitle", locale),
  }
}

export default function MotionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading titleKey="motions.title" subtitleKey="motions.subtitle" />
      {/* The component itself, not a closure over it: a function cannot cross
          the server/client boundary. See components/period-scope.tsx. */}
      <Suspense>
        <PeriodScope component={MotionList} />
      </Suspense>
    </main>
  )
}
