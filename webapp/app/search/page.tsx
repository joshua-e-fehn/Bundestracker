import type { Metadata } from "next"
import { Suspense } from "react"
import { SearchPage } from "@/components/search-page"
import { CURRENT_WAHLPERIODE } from "@/lib/bundestag"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * Keyword search over parliamentary records, answering with MPs.
 *
 * A thin server component: unlike /mps and /rankings there is nothing to
 * preload, because the query lives in the URL and the search that follows from
 * it is driven by `useSearchParams` in the browser. Preloading would mean
 * running a search on the server for a `?q=` that may not be there — and
 * subscribing the page to a result set that changes with every filter, which is
 * what `useQuery` already does properly.
 *
 * `Suspense` is required, not decorative: `useSearchParams` opts a client
 * component into client-side rendering, and Next.js fails the build for a
 * component that reads it without a boundary above. The fallback is deliberately
 * plain — the page is a search box over an empty list until the reader types,
 * so there is no content-shaped skeleton worth drawing.
 */

export const metadata: Metadata = {
  title: t("search.title", DEFAULT_LOCALE),
  description: t("search.subtitle", DEFAULT_LOCALE),
}

export default function Search() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
      <Suspense>
        <SearchPage defaultWahlperiode={CURRENT_WAHLPERIODE} />
      </Suspense>
    </main>
  )
}
