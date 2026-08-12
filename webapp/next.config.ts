import type { NextConfig } from "next"

/**
 * No `/api/auth/*` rewrite here, deliberately — see the ⚠ below before adding
 * one back.
 *
 * This file used to carry a rewrite forwarding `/api/auth/:path*` to
 * `${NEXT_PUBLIC_CONVEX_SITE_URL}/api/auth/:path*`, alongside the route handler
 * at `app/api/auth/[...all]/route.ts` that does the same job. Two mechanisms
 * for one path, and the rewrite was the one that ran: measured on Next 16.2.12,
 * an `afterFiles` rewrite matching a path that also has a filesystem route
 * **wins**, and the route handler is never invoked.
 *
 * ⚠ That is the opposite of the usual "filesystem routes take precedence" rule,
 * which holds for `beforeFiles` and is what makes this worth a comment: the
 * dead-looking config entry was the live one, and the live-looking route
 * handler was dead.
 *
 * ## Why the rewrite could not stay
 *
 * Next's rewrite proxy sets `x-forwarded-host` to the *public* origin
 * (measured: a rewrite from localhost:3998 arrives upstream carrying
 * `x-forwarded-host: localhost:3998`). Convex's edge router — `convex-usher` —
 * resolves which deployment a request belongs to and reads that header. A value
 * that is not the deployment's own host names no deployment it knows, so the
 * request is rejected at ingress, before any route or any app code:
 *
 *   no header                                  → 200 {"ok":true}
 *   x-forwarded-host: whimsical-….convex.site  → 200
 *   x-forwarded-host: www.bundestracker.de     → 404, empty body
 *
 * That is the production outage this file caused: every `/api/auth/*` call on
 * www.bundestracker.de returned a bare 404 while the identical path on
 * whimsical-bandicoot-307.convex.site returned 200, and the sign-in UI sat on
 * "Redirecting" forever because `POST /api/auth/sign-in/social` 404'd too.
 *
 * The header is set by the proxy itself, so there is nothing to configure away:
 * `rewrites()` has no hook for outbound headers, and `headers()` applies to
 * responses this app serves rather than to a proxied hop's request. The rewrite
 * had to go, which is fine — the route handler was always the better mechanism
 * and was written first.
 *
 * ## What serves those paths now
 *
 * `app/api/auth/[...all]/route.ts`, through `lib/auth-forwarded-headers.ts`,
 * which forwards to Convex *without* the poisoned header and carries the public
 * origin on the `x-better-auth-*` pair the library restores inside the Convex
 * runtime. Better Auth still learns the real origin; the edge router no longer
 * sees a host it cannot resolve.
 *
 * ⚠ Do not reintroduce a rewrite for `/api/auth/:path*`. It would silently take
 * over from the route handler again — no error, no warning, just the same bare
 * 404 on every auth call in production, from a config entry that reads like
 * dead code.
 */
const nextConfig: NextConfig = {}

export default nextConfig
