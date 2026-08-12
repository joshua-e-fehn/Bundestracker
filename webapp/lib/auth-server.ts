import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs"
import { getToken as libraryGetToken } from "@convex-dev/better-auth/utils"
import { headers as nextHeaders } from "next/headers"
import { stripConvexIngressUnsafeHeaders } from "@/lib/auth-forwarded-headers"
import { requireConvexUrls } from "@/lib/convex-url"

/**
 * Server-side auth helpers, bound to this deployment.
 *
 * `requireConvexUrls` replaces the `!` assertions this used to carry. They made
 * the right claim — these two variables are not optional, and a missing one
 * should fail loudly at startup rather than as a confusing fetch error later —
 * but a non-null assertion only rules out `undefined`. The failure this build
 * actually had was a *defined* value naming the wrong deployment, which no `!`
 * can catch and which fails silently rather than loudly. See lib/convex-url.ts.
 *
 * This module is imported during `next build`'s page-data collection, so the
 * check runs at build time: a misconfigured deploy fails before it can serve.
 */
// Named one at a time rather than passing `process.env`: Next inlines
// `NEXT_PUBLIC_*` by matching the literal member expression in the source, so
// spreading the object would leave both values `undefined` in the browser
// bundle — the check would pass at build time and the client would get nothing.
const { cloudUrl, siteUrl } = requireConvexUrls({
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
})

/**
 * The Convex site URL this build proxies auth to, validated above.
 *
 * Exported so `app/api/auth/[...all]/route.ts` can bind its hop to the same
 * checked value rather than reading `process.env` a second time — the check is
 * what makes it trustworthy, and a second read would skip it.
 */
export const convexSiteUrl = siteUrl

// `handler` and `getToken` are deliberately not re-exported from the library.
// Both send `x-forwarded-host` naming the public origin, which Convex's edge
// router rejects at ingress — `handler` is what caused the outage, and
// `getToken` is the half that survived the first fix. Leaving either export in
// place would leave a one-import path back to it. `getToken` is replaced below.
//
// ⚠ The five re-exported here reach that same unsanitized path internally, via
// the library's `cachedGetToken`. All five are currently unused (verified by
// grep across app/, components/, lib/, convex/), so nothing is broken today —
// but wiring one onto a page would silently render signed-in readers as signed
// out in production while passing every gate locally. Give it a sanitized token
// first: `getToken()` below, passed to `fetchQuery`/`preloadQuery` directly.
export const {
  preloadAuthQuery,
  isAuthenticated,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl: cloudUrl,
  convexSiteUrl: siteUrl,
})

/**
 * The Convex JWT for the current request, or `undefined` when signed out.
 *
 * ## Why this is not the library's `getToken`
 *
 * The library's version (dist/nextjs/index.js:62-69) builds its headers from
 * Next's inbound `headers()` and deletes only `content-length`,
 * `transfer-encoding`, and `accept-encoding`. It never removes
 * `x-forwarded-host` — and on Vercel that header arrives already set to the
 * public origin, which is exactly the value Convex's edge router refuses.
 *
 * Measured against production, `GET /api/auth/convex/token`:
 *
 *   no header                              → 401  (Better Auth answering: no cookie)
 *   x-forwarded-host: www.bundestracker.de → 404  (refused at ingress)
 *
 * ⚠ The failure is silent, which is why it outlived the first fix. `betterFetch`
 * does not throw on a 404 — it returns no `data`, so the library yields
 * `{ token: undefined }`, indistinguishable from a genuinely signed-out reader.
 * Every signed-in server render would paint signed-out, forever, with a green
 * build and nothing in any log. `app/layout.tsx` even documents a null token as
 * "expected, not a failure", so the one comment that could have flagged it said
 * the opposite.
 *
 * ## Why it wraps rather than reimplements
 *
 * Unlike the `/api/auth/*` hop — where the poisoned headers are built inside the
 * library's own closure and cannot be reached — `@convex-dev/better-auth/utils`
 * exports `getToken(siteUrl, headers, opts)` taking the headers as an argument.
 * So the seam is public: sanitize what goes in, and the library's real token
 * logic still runs. No transcription, so no drift to guard against — unlike the
 * hop, which needs a test pinning it to the library's header set.
 *
 * Only the two unsafe headers are removed. The session cookie — the thing that
 * makes this request meaningful — is passed through untouched, as is everything
 * else. `getToken` sets `host` itself (dist/utils/index.js:42).
 */
export async function getToken(): Promise<string | undefined> {
  const inbound = new Headers(await nextHeaders())
  // Mirrors the library's own hop-by-hop handling (dist/nextjs/index.js:65-67);
  // `identity` rather than the hop's `application/json`, which is what the
  // library sends on this path.
  inbound.delete("content-length")
  inbound.delete("transfer-encoding")
  inbound.set("accept-encoding", "identity")

  // No options, which matches what the library would pass: `convexBetterAuthNextJs`
  // forwards its own `opts` here, and this build configures only `convexUrl` /
  // `convexSiteUrl` — neither of which is a `GetTokenOptions` field. With no
  // `jwtCache`, `getToken` takes its direct-fetch path (dist/utils/index.js:55),
  // exactly as it does today. Adding a cache later means adding it here too.
  const { token } = await libraryGetToken(siteUrl, stripConvexIngressUnsafeHeaders(inbound))
  return token
}
