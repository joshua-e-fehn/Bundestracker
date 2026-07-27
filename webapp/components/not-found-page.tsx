import Link from "next/link"
import { DEFAULT_LOCALE, t, type TranslationKey } from "@/lib/i18n"

/**
 * The shared body of every not-found boundary.
 *
 * Three of them exist — app/not-found.tsx for a URL matching no route, and the
 * two `[id]` segments that distinguish "this MP does not exist" and "this ballot
 * does not exist" from it. They differ only in one sentence and where the link
 * goes; the heading, the shell and every class were identical in all three, so
 * the layout lives here and each boundary supplies its three keys.
 *
 * `PageHeading` is the neighbouring component for a page title and cannot be
 * used here: it is a client component reading `useLocale`, and these boundaries
 * are server components rendered outside the `LocaleProvider` — which is the
 * same reason the strings below are resolved at `DEFAULT_LOCALE` rather than at
 * the reader's choice.
 *
 * ## German only, deliberately
 *
 * A server component outside the client `LocaleProvider` has no access to the
 * language toggle, so there is no reader locale to read. German is the default
 * (lib/i18n.ts), so an English reader gets one German sentence beside a link
 * rather than a page that fails to render. The header and footer around this —
 * which *are* inside the provider, since all three boundaries render within the
 * root layout — still follow the reader's chosen language.
 *
 * ## ⚠ The two segment boundaries are served with HTTP 200, not 404
 *
 * Verified against a production build under Next 16.2.12, not inferred: a page
 * whose entire body is `notFound()` returns 200 while rendering its boundary,
 * whereas a URL with no page at all correctly returns 404. So the status is lost
 * above application code, and a segment `not-found.tsx` — the usual remedy —
 * does not recover it. The consequence is for crawlers rather than readers: an
 * unknown-MP URL may be indexed as a real page. `notFound()` stays in the pages
 * because it is the correct call and will produce the right status once the
 * framework does. `app/not-found.tsx` is unaffected: a genuine route miss is
 * handled by the framework and does return 404.
 */
export function NotFoundPage({
  messageKey,
  backHref,
  backLabelKey,
}: {
  /** The sentence under the heading: what specifically was not found. */
  messageKey: TranslationKey
  /** Where the reader most likely meant to be — the list, or the home page. */
  backHref: string
  backLabelKey: TranslationKey
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-semibold text-2xl tracking-tight">
        {t("common.notFound", DEFAULT_LOCALE)}
      </h1>
      <p className="text-muted-foreground">{t(messageKey, DEFAULT_LOCALE)}</p>
      <Link href={backHref} className="text-sm underline underline-offset-4 hover:text-foreground">
        ← {t(backLabelKey, DEFAULT_LOCALE)}
      </Link>
    </main>
  )
}
