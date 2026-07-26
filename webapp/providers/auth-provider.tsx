"use client"

import type { AuthClient } from "@convex-dev/better-auth/react"
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"
import { ConvexReactClient } from "convex/react"
import { authClient } from "@/lib/auth-client"

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

/**
 * Convex client + Better Auth session, for the whole tree.
 *
 * Note this lives in `providers/`, while the other four providers live in
 * `components/providers/`. Both paths were specified for the scaffold, so the
 * split is deliberate rather than accidental — but it is still two homes for
 * one kind of thing, and consolidating on `components/providers/` would be a
 * one-import change (only app/layout.tsx names this module).
 *
 * One provider rather than two because they are not independent: the Convex
 * client needs the auth token to attach it to queries, and `initialToken` is
 * how the server-rendered pass hands it over so the first paint is not
 * signed-out. `getToken()` (lib/auth-server.ts) reads it in the root layout.
 *
 * A null token is normal here, not a failure — most Bundestrack visitors are
 * signed out, and every query has a signed-out answer.
 */
export function AuthProvider({
  children,
  initialToken,
}: {
  children: React.ReactNode
  initialToken?: string | null
}) {
  return (
    // The cast works around an upstream variance bug in
    // @convex-dev/better-auth 0.12.5: the exported `AuthClient` type is a union
    // of two `createAuthClient` instantiations, and *nothing* an app can write
    // is assignable to it — the package's own documented usage
    // (`createAuthClient({ plugins: [convexClient()] })`) fails too. Verified
    // against node_modules/@convex-dev/better-auth/dist/react/index.d.ts:15.
    //
    // Confined to this one boundary on purpose. The alternative — widening the
    // plugin array to `BetterAuthClientPlugin[]` where the client is built —
    // typechecks here but collapses `useSession().data` to `never` for every
    // consumer, trading a local cast for lost inference across the app. Drop
    // this when upstream fixes the type; `lib/auth-client.ts` needs no change.
    <ConvexBetterAuthProvider
      client={convex}
      authClient={authClient as unknown as AuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  )
}
