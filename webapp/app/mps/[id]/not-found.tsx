import Link from "next/link"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * What `notFound()` renders for an unknown MP id.
 *
 * A segment boundary rather than the app-wide 404, because the two are
 * different questions: "this URL is not a page" and "this page exists but that
 * MP does not". The second wants a way back to the roster, which is almost
 * always what the reader meant.
 *
 * German only, and deliberately: this is a server component outside the client
 * `LocaleProvider`, so it has no access to the toggle — the same constraint
 * `generateMetadata` works under (see the note in app/layout.tsx). German is
 * the default locale, so an English reader gets one German sentence beside a
 * link rather than a page that fails to render.
 *
 * ⚠ **Served with HTTP 200, not 404, under Next 16.2.12.** Verified against a
 * production build, not inferred: a page whose entire body is `notFound()` and
 * nothing else also returns 200 while rendering its boundary, whereas a URL
 * with no page at all correctly returns 404. So the status is lost above
 * application code and nothing here recovers it — a segment `not-found.tsx`,
 * which is the usual remedy, does not. The consequence is for crawlers rather
 * than readers: an unknown-MP URL may be indexed as a real page. `notFound()`
 * stays because it is the correct call and will produce the right status once
 * the framework does; this note exists so the next person need not re-derive
 * the finding.
 */
export default function MPNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-semibold text-2xl tracking-tight">
        {t("common.notFound", DEFAULT_LOCALE)}
      </h1>
      <p className="text-muted-foreground">{t("mp.notFound", DEFAULT_LOCALE)}</p>
      <Link href="/mps" className="text-sm underline underline-offset-4 hover:text-foreground">
        ← {t("mp.backToList", DEFAULT_LOCALE)}
      </Link>
    </main>
  )
}
