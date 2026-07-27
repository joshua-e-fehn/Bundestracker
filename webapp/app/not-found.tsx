import Link from "next/link"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * The app-wide 404, for a URL that matches no route at all.
 *
 * Without this file Next.js serves its own built-in 404, and a browser sweep of
 * every route found what that costs: the page reads "This page could not be
 * found." in English on a **white** background, inside an app that is German by
 * default (lib/i18n.ts) and dark by default
 * (components/providers/theme-provider.tsx). It also renders outside the root
 * layout's shell, so the header, the nav and the footer all vanish and the
 * reader is left on a blank page with no way back that is not the browser's own
 * back button. Three of the site's defining choices are contradicted at once, on
 * the one page a lost reader sees.
 *
 * The two `[id]` segments already answer their own narrower question —
 * app/mps/[id]/not-found.tsx and app/votes/[id]/not-found.tsx distinguish "this
 * MP does not exist" from "this URL is not a page" and link back to the list
 * that was probably meant. This is the general case they leave: no route
 * matched, so the only useful destination is the home page.
 *
 * German only, and deliberately, for the reason both segment boundaries give:
 * this is a server component rendered outside the client `LocaleProvider`, so it
 * has no access to the language toggle. German is the default locale, so an
 * English reader gets one German sentence beside a link rather than a page that
 * fails to render. The header and footer around it — which *are* inside the
 * provider, since this renders within the root layout — still follow the
 * reader's chosen language.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-semibold text-2xl tracking-tight">
        {t("common.notFound", DEFAULT_LOCALE)}
      </h1>
      <p className="text-muted-foreground">{t("common.notFoundPage", DEFAULT_LOCALE)}</p>
      <Link href="/" className="text-sm underline underline-offset-4 hover:text-foreground">
        ← {t("common.backHome", DEFAULT_LOCALE)}
      </Link>
    </main>
  )
}
