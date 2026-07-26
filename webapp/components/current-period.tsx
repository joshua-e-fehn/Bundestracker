"use client"

import { useQuery } from "convex/react"
import { useLocale } from "@/components/providers/locale-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"

/**
 * Resolves the current electoral period and hands it to a client component.
 *
 * Every query on both pages needs a `wahlperiode` before it can ask for
 * anything, and the URL deliberately does not carry one: `/rankings` should be
 * the current Bundestag, not `/rankings?wp=21`.
 *
 * Derived from the roster — the highest `wahlperiode` on it — for the reason
 * `scoreSweep.currentPeriod` gives at length: a hardcoded 21 keeps showing the
 * previous Bundestag for months after WP22 is elected, which is the kind of
 * staleness that produces a plausible wrong page rather than an error.
 *
 * ## Why a component prop rather than a render prop
 *
 * The obvious shape — `children: (wahlperiode) => ReactNode` — does not work
 * here and fails at runtime rather than at the typecheck. The pages above are
 * **server** components, so everything they pass crosses the server/client
 * boundary and must be serialisable; a function is not, and React reports
 * *"Functions are not valid as a child of Client Components"* when the page is
 * rendered.
 *
 * So the boundary carries a component *reference* instead, which the bundler
 * can serialise as a client-module pointer, and this component calls it. That
 * fixes the props to `{ wahlperiode }` for anything used here, which both
 * consumers already had.
 *
 * The empty state is a real one, not a defensive branch: a fresh deployment has
 * no roster until the first pipeline run, and a page that says so beats one
 * that renders an empty table for period 0.
 */
export function CurrentPeriod({
  component: Component,
}: {
  component: React.ComponentType<{ wahlperiode: number }>
}) {
  const { t } = useLocale()
  const wahlperiode = useQuery(api.rankings.getCurrentWahlperiode, {})

  if (wahlperiode === undefined) {
    return (
      <output className="flex flex-col gap-2" aria-live="polite">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </output>
    )
  }

  if (wahlperiode === null) {
    return (
      <p className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
        {t("common.empty")}
      </p>
    )
  }

  return <Component wahlperiode={wahlperiode} />
}
