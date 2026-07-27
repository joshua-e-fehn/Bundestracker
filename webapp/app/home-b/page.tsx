import type { Metadata } from "next"
import { Sitzungswoche } from "@/components/home-sitzungswoche"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/home-b` — the "Sitzungswoche" home page, as a candidate for `/`.
 *
 * A second home page rather than a replacement: `/` is untouched and stays the
 * dashboard it is. This route exists so the narrative version can be looked at
 * on real data, on a real device, beside the one it might replace — the same
 * reason `?hero=` exists in components/hero-animation.tsx, which says at length
 * why a choice between designs is made by looking rather than by specifying.
 *
 * A server component rendering a client one, the shape AGENTS.md asks for. The
 * subscriptions and the scroll state live below the boundary.
 *
 * ## Not indexed, deliberately
 *
 * Two home pages serving nearly the same content is duplicate content, and the
 * one that should rank is `/`. `robots: { index: false }` says so, and the
 * canonical points at `/` — which is also the honest description of what this
 * is: an alternate rendering of the home page, not a page of its own. Both come
 * off the moment this either replaces `/` or is deleted.
 *
 * German metadata, matching every other route here: `generateMetadata` cannot
 * see the client-side language toggle, so the tab title is the default locale's
 * while the page content follows the reader's choice.
 */
export const metadata: Metadata = {
  title: t("homeB.title", DEFAULT_LOCALE),
  description: t("homeB.lead", DEFAULT_LOCALE),
  alternates: { canonical: "/" },
  robots: { index: false, follow: true },
}

export default function HomeBPage() {
  return <Sitzungswoche />
}
