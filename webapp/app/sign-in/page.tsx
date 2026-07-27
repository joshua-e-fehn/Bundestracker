import type { Metadata } from "next"
import { SignInPanel } from "@/components/sign-in-panel"
import { DEFAULT_LOCALE, t } from "@/lib/i18n"

/**
 * `/sign-in` — the provider picker.
 *
 * A route that `lib/auth-routes.ts` has listed as public since before it
 * existed, and that `components/providers/auth-guard.tsx` redirects to. Until
 * now it 404'd, which is exactly the failure that file's ⚠ warns about from the
 * other direction: the guard sends a reader somewhere that is not there.
 *
 * Server component rendering a client one, the shape AGENTS.md asks for. The
 * session check and the OAuth call need the browser; the page and its metadata
 * do not.
 *
 * German metadata, matching every other route here: `generateMetadata` cannot
 * see the client-side language toggle, so the tab title is the default
 * locale's while the panel follows the reader's choice.
 *
 * `robots: noindex` — a sign-in form is not a page a search engine should
 * surface for a site whose whole content is public and reachable without one.
 */
export const metadata: Metadata = {
  title: t("auth.signIn", DEFAULT_LOCALE),
  description: t("auth.optionalNotice", DEFAULT_LOCALE),
  robots: { index: false, follow: true },
}

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 py-16 sm:px-6">
      <SignInPanel />
    </main>
  )
}
