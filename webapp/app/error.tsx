"use client"

import { useEffect } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"

/**
 * The route-level error boundary.
 *
 * Not optional infrastructure here: Convex's `useQuery` re-*throws* a failed
 * query during render rather than returning it as a value, so without a
 * boundary above them a single backend error takes down the whole client tree
 * and the reader gets a blank page. Every data section on this site calls
 * `useQuery`.
 *
 * `reset()` re-renders the segment, which is the right affordance for the
 * failure this most often catches — an unreachable deployment or a query that
 * failed once — rather than a full reload that would lose the reader's place.
 *
 * The message stays generic on purpose. `error.message` from a server-side
 * throw is redacted to a digest in production anyway, and the raw text of an
 * internal failure is not something to render to the public.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useLocale()

  useEffect(() => {
    // The digest is the only handle on the real error once it is redacted, so
    // it goes to the console where a developer can match it against the server
    // log. There is no error-reporting service wired up yet.
    console.error("Unhandled error", error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-[60svh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-semibold text-xl tracking-tight">{t("common.error")}</h1>
      {error.digest ? (
        <p className="font-mono text-muted-foreground text-xs">{error.digest}</p>
      ) : null}
      <Button onClick={reset} variant="outline" size="sm">
        {t("common.retry")}
      </Button>
    </main>
  )
}
