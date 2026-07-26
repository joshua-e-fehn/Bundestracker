/**
 * The single source of truth for which routes are reachable without a session.
 *
 * On Bundestrack that is *every* route. The platform is a public dashboard of
 * public parliamentary data: browsing MPs, motions and activity scores never
 * requires an account. Signing in only adds personalisation — custom score
 * weightings and a follow list — so there is nothing here to gate.
 *
 * The list is kept, rather than collapsed to a `return true`, because the two
 * consumers still need somewhere to ask the question:
 *
 *  - `proxy.ts` (Next.js middleware) — passes everything through today.
 *  - `components/providers/auth-guard.tsx` — the client-side complement, which
 *    also handles session expiry while the app is open.
 *
 * When a genuinely private route arrives (an account settings page, say), it
 * is added by *omission*: drop "/" from this list, enumerate the public ones,
 * and both layers start gating without either being edited.
 *
 * Note the matcher only treats "/" as an exact match: for path "/" the prefix
 * test becomes startsWith("//"), which never fires for a normal pathname. So
 * "/" alone would not make the whole site public — the explicit `PUBLIC_PATHS`
 * entries below do that, and "/api" is among them because Better Auth's own
 * callback routes live under it and must stay reachable while signed out.
 */
export const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up", "/api"]

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}
