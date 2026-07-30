import type { Metadata } from "next"
import { SignInPanel } from "@/components/sign-in-panel"
import { t } from "@/lib/i18n"
import { resolveServerLocale } from "@/lib/i18n-server"

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
 * Locale-aware metadata via `resolveServerLocale` — see app/layout.tsx for the
 * cookie → header → German precedence.
 *
 * `robots: noindex` — a sign-in form is not a page a search engine should
 * surface for a site whose whole content is public and reachable without one.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return {
    title: t("auth.signIn", locale),
    description: t("auth.optionalNotice", locale),
    robots: { index: false, follow: true },
  }
}

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 py-16 sm:px-6">
      <SignInPanel />
    </main>
  )
}
