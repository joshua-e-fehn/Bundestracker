/**
 * The `/api/auth/*` proxy hop, and the header that made it 404 in production.
 *
 * ## The bug this exists to fix
 *
 * Two things forwarded `/api/auth/*` to Convex, and *both* poisoned the same
 * header. The one that actually ran in production was the `next.config.ts`
 * rewrite — an `afterFiles` rewrite beats a filesystem route at the same path
 * on Next 16.2.12, so the route handler beside this file was dead code. That
 * rewrite is gone (see next.config.ts), and this module is what the now-live
 * route handler forwards through.
 *
 * The header is the same either way, which is why removing the rewrite alone
 * would not have been a fix. Next's rewrite proxy sets `x-forwarded-host` to
 * the public origin, and so does the library's handler:
 * `convexBetterAuthNextJs` (node_modules/@convex-dev/better-auth/dist/nextjs/
 * index.js:26-51) sets *four* headers naming it before forwarding:
 *
 *   x-forwarded-host              www.bundestracker.de
 *   x-forwarded-proto             https
 *   x-better-auth-forwarded-host  www.bundestracker.de
 *   x-better-auth-forwarded-proto https
 *
 * The `x-better-auth-*` pair is the library's own channel: `registerRoutes`
 * calls `restoreOriginalForwardedHeaders` (dist/client/create-client.js:5-19,
 * :249) which copies them back onto `x-forwarded-*` *inside* the Convex
 * runtime, before handing the request to Better Auth. So the auth layer learns
 * the true public origin either way — that pair is how it is meant to travel.
 *
 * The `x-forwarded-*` pair, sent on the wire, is the problem. Convex's edge
 * router (`convex-usher`) resolves which deployment a request belongs to, and
 * it reads `x-forwarded-host`. A value that is not this deployment's own host
 * names no deployment it knows, so the request is rejected *at ingress* —
 * before any route, any app code, any Better Auth handler.
 *
 * Measured against production (whimsical-bandicoot-307), the same GET:
 *
 *   no header                                  → 200 {"ok":true}
 *   x-forwarded-host: whimsical-….convex.site  → 200
 *   x-forwarded-host: www.bundestracker.de     → 404, empty body
 *
 * It is not specific to auth: the same header 404s `/api/pipeline/health`,
 * which is our own route and has nothing to do with Better Auth. That is the
 * observation that located the fault at the edge rather than in the app.
 *
 * ## Why the 404 was hard to place
 *
 * It has `content-length: 0`, no `content-type`, and none of the CORS headers
 * every real auth response carries — because it never reached the code that
 * would add them. Both forwarding paths return the upstream response verbatim,
 * so it arrives at the browser wearing `server: Vercel` while carrying Convex's
 * `convex-usher` and `via: 1.1 Caddy`. The status came from Convex and the
 * envelope from Vercel, which is what made a header problem read as a routing
 * one — and neither implicated file had been touched since the scaffold commit,
 * because neither had to be: the rewrite was poisoning the header from the day
 * it was written, and only started mattering once auth was used in production.
 *
 * ⚠ **It is also not an environment-variable problem**, which is the other
 * thing it looks like. Every value is correct: the URL the handler builds is
 * exactly `https://whimsical-bandicoot-307.convex.site/api/auth/ok`, and
 * `SITE_URL` on the deployment is `https://www.bundestracker.de`. Replacing
 * `NEXT_PUBLIC_CONVEX_SITE_URL` and redeploying does not move it, because the
 * rejected request is well-formed and correctly addressed — it is refused for
 * *whose origin it claims to be*, not for where it is going.
 *
 * ## Why this reimplements the hop instead of wrapping it
 *
 * The headers are set inside the library's own closure, on a `Headers` object
 * it builds and hands straight to `fetch`. Nothing about the inbound `Request`
 * controls them: both host headers are written from `requestUrl.host`, so
 * rewriting the request to satisfy the edge router would set
 * `x-better-auth-forwarded-host` to the Convex host too — fixing the 404 by
 * telling Better Auth it is serving `convex.site`, which is the origin its
 * callbacks and trusted-origin checks would then use. The two headers must
 * disagree, and the library derives them from one source.
 *
 * The other way in is to intercept `globalThis.fetch` around the call. That was
 * tried and rejected: a route handler runs per request and may run concurrently
 * with itself, so save-and-restore interleaves — the second call captures the
 * first's override as "the original" and reinstalls it on the way out, leaving
 * a permanent interceptor on every `fetch` in the isolate. Patching a global to
 * fix a header is also invisible to anyone reading the route.
 *
 * So this forwards the request itself. It is a transcription of
 * dist/nextjs/index.js:26-51 minus the two headers, which is a real cost — a
 * change to the library's forwarding semantics will not arrive here on its own,
 * and `lib/auth-forwarded-headers.test.ts` pins the header set the library
 * builds so that divergence shows up as a failing test rather than as a second
 * outage. The alternative was owning a global mutation with a known race.
 *
 * `x-forwarded-for` is deliberately not touched: Convex's router does not
 * resolve deployments from it (it names the client, not the host), and Better
 * Auth reads it to record the session IP.
 */

/**
 * The headers a proxied hop must not assert to Convex's edge router.
 *
 * `x-forwarded-host` is the causal one — measured, `x-forwarded-proto: https`
 * on its own still returns 200. The proto is stripped with it because the
 * library derives both from a single source, and a proto still naming the
 * public origin behind a host that no longer does is a contradiction rather
 * than a fix.
 */
export const CONVEX_INGRESS_UNSAFE_HEADERS = ["x-forwarded-host", "x-forwarded-proto"] as const

/**
 * Hop-by-hop headers that must not be re-sent on a new request.
 *
 * Kept from the library's own list (dist/nextjs/index.js:31-33): undici rejects
 * an outbound `transfer-encoding: chunked`, and a stale `content-length`
 * contradicts the body actually being sent.
 */
const HOP_BY_HOP_HEADERS = ["transfer-encoding", "content-length", "connection"] as const

/**
 * The headers to send to Convex for a request that arrived at `requestUrl`.
 *
 * Exported for the test, which asserts both halves of the contract: the
 * ingress-hostile pair is absent, and the `x-better-auth-*` pair carrying the
 * real public origin is present.
 */
export function convexAuthForwardHeaders(incoming: Headers, requestUrl: URL, siteUrl: string): Headers {
  const headers = new Headers(incoming)

  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name)
  }
  // Deleted rather than never-set: the inbound request may carry its own pair
  // from Vercel's proxy, naming the public origin exactly as the library would.
  for (const name of CONVEX_INGRESS_UNSAFE_HEADERS) {
    headers.delete(name)
  }

  headers.set("accept-encoding", "application/json")
  headers.set("host", new URL(siteUrl).host)
  // The library's own channel for the public origin, restored onto
  // `x-forwarded-*` inside the Convex runtime, past the edge router.
  headers.set("x-better-auth-forwarded-host", requestUrl.host)
  headers.set("x-better-auth-forwarded-proto", requestUrl.protocol.replace(/:$/, ""))

  return headers
}

/**
 * Proxies one `/api/auth/*` request to Better Auth inside Convex.
 *
 * `redirect: "manual"` because the OAuth flow answers with 302s that belong to
 * the browser, not to this hop — following them here would resolve the sign-in
 * redirect server-side and return the provider's page instead of sending the
 * reader to it.
 */
async function proxyToConvexAuth(request: Request, siteUrl: string): Promise<Response> {
  const requestUrl = new URL(request.url)
  const target = `${siteUrl}${requestUrl.pathname}${requestUrl.search}`

  const init: RequestInit = {
    method: request.method,
    headers: convexAuthForwardHeaders(request.headers, requestUrl, siteUrl),
    redirect: "manual",
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.arrayBuffer()
    if (body.byteLength > 0) {
      init.body = body
    }
  }

  return fetch(target, init)
}

/** The `{ GET, POST }` shape a Next route module exports. */
export type RouteHandlers = {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

/**
 * The route handlers for `/api/auth/*`, bound to a Convex site URL.
 *
 * Takes the URL as an argument rather than reading the environment, so the test
 * can exercise the hop without one — `lib/auth-server.ts` is where the value is
 * validated, once, for the whole build.
 */
export function convexAuthRouteHandlers(siteUrl: string): RouteHandlers {
  return {
    GET: (request: Request) => proxyToConvexAuth(request, siteUrl),
    POST: (request: Request) => proxyToConvexAuth(request, siteUrl),
  }
}
