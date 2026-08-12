"use client"

import { useQuery } from "convex/react"
import { useEffect, useState } from "react"
import { api } from "@/convex/_generated/api"

/**
 * Whether to offer the report control to this reader, on this deployment.
 *
 * Three controls open the same sheet — the footer button, the sidebar row and
 * the mobile drawer row — and all three must appear and disappear together. One
 * hook rather than three copies of the same three-part condition, because a copy
 * that drifted would be a control that renders for a reader the handlers will
 * refuse, which is precisely the failure this feature's gate exists to prevent.
 *
 * Returns `false` unless **all three** hold:
 *
 *  - the query has resolved (`undefined` while loading renders nothing rather
 *    than flashing a control that may not belong there),
 *  - the deployment can publish, and
 *  - the reader has a session **that the Convex deployment itself accepts**.
 *
 * That last point is why the signed-in half comes from the server's answer
 * rather than from `authClient.useSession()`, which several other components in
 * this directory read. Better Auth's browser store can hold a session Convex
 * will not authorise — an expired or revoked one — and rendering from the
 * browser's opinion would produce a control whose every call throws
 * "Not authenticated". Rendering from the server's opinion means the control
 * appears exactly when the calls behind it will be authorised.
 *
 * ## ⚠ The first client render must match the server's
 *
 * The same hydration contract as `components/sidebar-account.tsx`, and load-
 * bearing for the same reason: `isConfigured` is a Convex query that is
 * `undefined` on the server and can be resolved by the client's first paint.
 * Returning `null` from one render and a `<button>` from the next at the same
 * position is a differing element type, which throws React #418, regenerates the
 * tree, and in React 19 detaches `<head>`. `mounted` is set from an effect, and
 * effects do not run until hydration has committed, so the first client render
 * is pinned to the server's branch.
 *
 * ## This is a rendering hint, never the gate
 *
 * The gate is `requireUserId` inside each handler in convex/feedback.ts. A
 * caller who never loads this page reaches exactly the same wall.
 */
export function useFeedbackAvailable(): boolean {
  const status = useQuery(api.feedback.isConfigured, {})

  // See the ⚠ above: a hydration guard, not a loading flag.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return mounted && status?.configured === true && status.signedIn === true
}
