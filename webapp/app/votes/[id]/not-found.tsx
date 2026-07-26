import Link from "next/link"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * What `notFound()` renders for an unknown ballot id.
 *
 * A segment boundary rather than the app-wide 404, for the reason
 * app/mps/[id]/not-found.tsx gives: "this URL is not a page" and "this page
 * exists but that ballot does not" are different answers, and the second wants
 * a way back to the list.
 *
 * German only, and deliberately: a server component outside the client
 * `LocaleProvider` has no access to the toggle, so an English reader gets one
 * German sentence beside a link rather than a page that fails to render.
 *
 * ⚠ Served with HTTP 200 under Next 16.2.12 — the same framework behaviour
 * verified and documented on the MP not-found boundary. The status is lost
 * above application code; `notFound()` stays because it is the correct call and
 * will produce the right status once the framework does.
 */
export default function VoteNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-semibold text-2xl tracking-tight">
        {t("common.notFound", DEFAULT_LOCALE)}
      </h1>
      <p className="text-muted-foreground">{t("votes.notFound", DEFAULT_LOCALE)}</p>
      <Link href="/votes" className="text-sm underline underline-offset-4 hover:text-foreground">
        ← {t("votes.backToList", DEFAULT_LOCALE)}
      </Link>
    </main>
  )
}
