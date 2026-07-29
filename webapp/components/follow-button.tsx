"use client"

import { useMutation, useQuery } from "convex/react"
import { BookmarkIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

/**
 * Follow / unfollow one MP.
 *
 * The UI half of a backend that has been complete and uncalled since it was
 * written: `userPreferences.followMP`, `unfollowMP`, `isFollowing` and
 * `getFollowedMPs` had no caller anywhere in `app/` or `components/`, while
 * `auth.benefits` promised readers in both languages that an account "lets you
 * follow individual members" (the 2026-07-29 audit's GAP-006/GAP-008). This is
 * the control that makes that sentence true; `components/settings-page.tsx` is
 * the list it fills.
 *
 * ## Two labels, not `aria-pressed`
 *
 * A toggle button carrying one label and a pressed state announces "Folgen,
 * gedrückt" — the action and the state in one breath, which reads as a
 * contradiction. Swapping the label instead ("Folgen" / "Nicht mehr folgen")
 * says exactly one thing: what pressing does. The button keeps focus through
 * the mutation, so the new label is what a screen reader reads back and the
 * outcome is announced without a live region.
 *
 * ## Signed out it is a link, not a disabled button
 *
 * Following has no half that works without an account — `followMP` throws
 * "Not authenticated" for an anonymous caller (convex/lib/auth.ts) — so unlike
 * the weight sliders, which stay usable signed out and only lose persistence
 * (components/mp-score-panel.tsx), there is nothing here to leave switched on.
 * The control therefore becomes the invitation: a link to `/sign-in`, the one
 * sign-in flow on this site. A `disabled` button is the one option that would
 * say nothing about why it is disabled, and letting the mutation throw would
 * present the site's own precondition as a failure the reader caused.
 *
 * ## One query, or none — never one per row
 *
 * `isFollowing` exists to answer this button cheaply for a single MP, and that
 * is what the profile uses. A *list* must not: 25 rows would be 25
 * subscriptions for a set the parent can fetch once from `getPreferences`,
 * which components/activity-feed.tsx and components/mp-score-panel.tsx already
 * read. So `following` may be passed in, and the query is skipped when it is —
 * the same prop-rather-than-query rule `MPCard` states for `dissent` and
 * `electionMethod`, for the same reason.
 *
 * ## ⚠ The first client render must match the server's
 *
 * The same hydration contract as components/sidebar-account.tsx, and the same
 * consequence if it is broken: the server has no session, so its HTML always
 * holds the `Skeleton` (a `<div>`); on the client Better Auth can resolve
 * before React hydrates, and returning an `<a>` or a `<button>` into that slot
 * is a differing element *type* at the same position — React throws #418,
 * regenerates the tree, and in React 19 that detaches `<head>`, after which the
 * reader's next click dies with a null `removeChild`. `mounted` is set from an
 * effect, and effects do not run until hydration has committed.
 *
 * That contract is guarded by components/sidebar-account.test.ts, which reads
 * every file branching on `authClient.useSession()` — this one included.
 */
export function FollowButton({
  mpInternalId,
  name,
  following: providedFollowing,
  iconOnly = false,
  size = "sm",
  className,
}: {
  mpInternalId: string
  /** The member's name, for the failure message and for the icon-only variant's
   * accessible name. A follow control appears in lists; "could not save"
   * beside one of 630 rows does not say which one. */
  name: string
  /** Whether the reader already follows this MP, where the caller knows.
   * Omitted, the control asks `isFollowing` itself — see the header on why a
   * list must pass it and a profile need not. */
  following?: boolean
  /** Drop the label, keeping it as the accessible name. For a table cell, where
   * a worded button would take a column of its own. */
  iconOnly?: boolean
  size?: "sm" | "default"
  className?: string
}) {
  const { t } = useLocale()
  const { data: session, isPending } = authClient.useSession()

  // See the ⚠ above: a hydration guard, not a loading flag.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Skipped in both the cases where it would be waste: signed out, where the
  // query's answer is a constant `false` and the branch below never reads it,
  // and controlled, where the caller has already fetched the whole set.
  const queried = useQuery(
    api.userPreferences.isFollowing,
    session && providedFollowing === undefined ? { mpInternalId } : "skip",
  )
  const follow = useMutation(api.userPreferences.followMP)
  const unfollow = useMutation(api.userPreferences.unfollowMP)

  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const following = providedFollowing ?? queried

  async function toggle() {
    setFailed(false)
    setSaving(true)
    try {
      // `followMP`/`unfollowMP` rather than one `toggleFollow`, honouring the
      // API's own decision: both are idempotent set operations, so a double-tap
      // or a retried request after a dropped response cannot invert the intent.
      // A toggle would (convex/userPreferences.ts).
      if (following) await unfollow({ mpInternalId })
      else await follow({ mpInternalId })
    } catch {
      // Surfaced, not swallowed. The reader pressed a button, and the
      // watchlist they may not look at until later is the only other place the
      // answer shows.
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  /** The button's footprint, so a skeleton standing in for it does not resize
   * the row it is in when the session resolves. */
  const shape = iconOnly
    ? size === "sm"
      ? "size-7"
      : "size-8"
    : size === "sm"
      ? "h-7 w-32"
      : "h-8 w-36"

  if (!mounted || isPending) {
    return <Skeleton className={cn("rounded-lg", shape, className)} />
  }

  if (!session) {
    const label = t("follow.signInCta")
    return (
      <Button asChild variant="outline" size={iconOnly ? "icon-sm" : size} className={className}>
        {/* `title` carries the longer reason; `aria-label` only where the text
            is not rendered, since it overrides content rather than adding to
            it — the rule components/sidebar-account.tsx states. */}
        <Link
          href="/sign-in"
          title={t("follow.signInHint")}
          aria-label={iconOnly ? label : undefined}
        >
          <BookmarkIcon aria-hidden />
          {iconOnly ? null : label}
        </Link>
      </Button>
    )
  }

  // Undefined means the query has not resolved. Rendering "Folgen" now would
  // claim the reader does not follow this member before knowing, and the label
  // would flip under a pointer already on its way to it.
  if (following === undefined) {
    return <Skeleton className={cn("rounded-lg", shape, className)} />
  }

  const label = saving ? t("follow.saving") : following ? t("follow.unfollow") : t("follow.follow")

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <Button
        type="button"
        // Filled when following, outlined when not: a change of *fill* rather
        // than only of colour, so the state survives greyscale and colour-vision
        // deficiency — the same reasoning the sidebar's gold rule carries.
        variant={following ? "secondary" : "outline"}
        size={iconOnly ? "icon-sm" : size}
        onClick={() => void toggle()}
        disabled={saving}
        // Icon-only, the glyph is all that is left, so the name has to say both
        // the action and who it is about — "Nicht mehr folgen" alone, repeated
        // down 25 rows, names 25 different people identically.
        aria-label={iconOnly ? `${label}: ${name}` : undefined}
        title={iconOnly ? `${label}: ${name}` : undefined}
      >
        {/* One shape in two states. A swap to a different mark would read as
            the button having changed identity rather than state. */}
        <BookmarkIcon aria-hidden className={following ? "fill-current" : undefined} />
        {iconOnly ? null : label}
      </Button>
      {failed ? (
        // `role="alert"` so the failure is announced. It replaces nothing on
        // screen, because the button has to stay usable for the retry — the
        // same shape components/sign-in-panel.tsx uses for a failed sign-in.
        <p role="alert" className="text-destructive text-xs">
          {t("follow.failed", { name })}
        </p>
      ) : null}
    </div>
  )
}
