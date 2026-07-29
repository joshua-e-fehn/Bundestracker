"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { authClient } from "@/lib/auth-client"
import { GITHUB_ENABLED } from "@/lib/auth-providers"
import { continueWithoutAccountTarget } from "@/lib/auth-routes"

/**
 * The provider picker.
 *
 * ## Why this page exists at all
 *
 * Because the header's "Anmelden" used to *be* the sign-in flow: it called
 * `authClient.signIn.social({ provider: "github" })` directly, so pressing it
 * navigated the tab straight to github.com. That is wrong in two ways at once —
 * it offers no choice, and it hands the reader off to a third party before
 * telling them why an account is wanted. Bundestrack is a public dashboard;
 * signing in buys two specific things (custom weightings, a follow list) and
 * nothing else, so the reader deserves to read that before leaving the site.
 *
 * `components/user-menu.tsx` now links here rather than calling `signIn`, so
 * there is one sign-in flow rather than two.
 *
 * ## GitHub is disabled, not hidden
 *
 * `GITHUB_ENABLED` is false while the OAuth app is unconfigured — the
 * credentials are the only thing missing. Rendering it greyed out with a
 * "coming soon" badge says that, where hiding it would make the reader who came
 * looking for it think Bundestrack does not support GitHub at all.
 *
 * The backend no longer registers the provider until those credentials exist
 * (convex/betterAuth/auth.ts), so the two halves now agree: an unconfigured
 * deployment neither offers the button nor answers its endpoint.
 *
 * The disabled state is real, not cosmetic: `disabled` on a `<button>` takes it
 * out of the tab order and stops the click, so no code path can reach the
 * unconfigured provider. `aria-describedby` points at the reason, so a screen
 * reader gets "not enabled yet" rather than only "dimmed".
 */
export function SignInPanel() {
  const { t } = useLocale()
  const router = useRouter()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const [pendingProvider, setPendingProvider] = useState<"google" | "github" | null>(null)
  const [failed, setFailed] = useState(false)

  // ⚠ A hydration guard, not a loading flag — the same one, for the same
  // reason, as components/user-menu.tsx:84. The server has no session, so it
  // always renders the provider buttons below; on the client Better Auth can
  // resolve a session before React hydrates, and the `session ?` branch would
  // then put a `<p>` where the server put a `<div>`. A differing element type
  // at the same position makes React throw a hydration mismatch and regenerate
  // the tree, which in React 19 detaches the whole of `<head>` and leaves the
  // reader's next click dying in the tag-26 unmount path with
  // "Cannot read properties of null (reading 'removeChild')".
  //
  // The blast radius is not this page: the root re-render tears out `<head>`
  // wherever in the tree the mismatch happened, so a signed-in reader cold
  // loading /sign-in — from a bookmark, a pasted link or a reload — would find
  // the *rest of the site's* first click swallowed afterwards.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  async function signIn(provider: "google") {
    setFailed(false)
    setPendingProvider(provider)
    try {
      // Better Auth's redirect plugin navigates the tab to the provider, so on
      // the happy path nothing after this runs. The catch is for the unhappy
      // one — an unreachable Convex deployment or an unconfigured provider —
      // where the promise rejects and the page would otherwise sit on a
      // spinner that never resolves.
      await authClient.signIn.social({ provider, callbackURL: "/" })
    } catch {
      setPendingProvider(null)
      setFailed(true)
    }
  }

  return (
    <Card className="mx-auto flex w-full max-w-md flex-col gap-5 p-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-semibold text-xl tracking-tight">{t("auth.signInTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("auth.chooseProvider")}</p>
      </div>

      {/* Already signed in: say so rather than offering a second sign-in that
          would replace the session with an identical one. The menu in the
          header is where signing out lives, so this only needs to state the
          fact and get out of the way. */}
      {mounted && session ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          {t("auth.alreadySignedIn")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full"
            disabled={sessionPending || pendingProvider !== null}
            onClick={() => void signIn("google")}
          >
            <GoogleMark />
            {pendingProvider === "google" ? t("auth.signingIn") : t("auth.signInWithGoogle")}
          </Button>

          <Button
            variant="outline"
            size="lg"
            className="w-full"
            disabled={!GITHUB_ENABLED}
            aria-describedby={GITHUB_ENABLED ? undefined : "github-unavailable"}
            // No onClick at all while disabled — the handler would be dead code
            // that reads as a working path to anyone scanning this file.
            onClick={GITHUB_ENABLED ? () => {} : undefined}
          >
            <GitHubMark />
            {t("auth.signInWithGitHub")}
            {GITHUB_ENABLED ? null : (
              <Badge variant="secondary" className="ml-auto">
                {t("common.comingSoon")}
              </Badge>
            )}
          </Button>

          {GITHUB_ENABLED ? null : (
            <p id="github-unavailable" className="text-muted-foreground text-xs">
              {t("auth.githubUnavailable")}
            </p>
          )}
        </div>
      )}

      {failed && (
        // `role="alert"` so the failure is announced. It replaces nothing on
        // screen, because the buttons must stay usable for the retry.
        <p role="alert" className="text-destructive text-sm">
          {t("auth.signInFailed")}
        </p>
      )}

      <div className="flex flex-col gap-3 border-border/60 border-t pt-4">
        <p className="text-muted-foreground text-xs leading-relaxed">{t("auth.benefits")}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{t("auth.optionalNotice")}</p>
        {/* Back only when "back" is a Bundestrack page, otherwise home.
            `window.history.length > 1` was the old test and it is true of
            nearly every visit, including one that arrived from another site —
            so a reader coming from an external link and clicking *continue
            without an account* was sent straight back off the site. The
            decision lives in lib/auth-routes.ts, with the rest of "where may
            this reader be sent". */}
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => {
            if (
              continueWithoutAccountTarget(document.referrer, window.location.origin) === "back"
            ) {
              router.back()
            } else {
              router.push("/")
            }
          }}
        >
          {t("auth.continueWithoutAccount")}
        </Button>
      </div>
    </Card>
  )
}

/**
 * The two provider marks, inline.
 *
 * Not `lucide-react`: it ships a generic `Github` glyph and nothing for Google,
 * and a button offering one branded provider beside an unbranded one reads as
 * two different kinds of thing. These are the official marks, as paths, which
 * is also how they stay a single request rather than two.
 *
 * `aria-hidden` on both — the button's own text names the provider, so the mark
 * would be announced twice.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55Z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.1 0 5.71-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.74H1.71v2.98A11.5 11.5 0 0 0 12 23.5Z"
      />
      <path
        fill="#FBBC05"
        d="M5.55 14.18a6.9 6.9 0 0 1 0-4.36V6.84H1.71a11.5 11.5 0 0 0 0 10.32l3.84-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.7 1.32 15.09.25 12 .25 7.52.25 3.65 2.82 1.71 6.84l3.84 2.98C6.46 7.1 9 4.75 12 4.75Z"
      />
    </svg>
  )
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}
