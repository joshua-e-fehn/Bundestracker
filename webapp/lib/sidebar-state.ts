/**
 * Where the desktop sidebar's expanded/collapsed choice is kept.
 *
 * A cookie rather than `localStorage`, and that is the whole reason this file
 * exists as its own module: the choice has to be readable on the **server**, in
 * `app/layout.tsx`, before the first byte of HTML is written.
 *
 * ## Why not localStorage
 *
 * `localStorage` is only reachable after hydration. A reader who had collapsed
 * the sidebar would get the expanded 16 rem shell in the server HTML, see it
 * painted, and watch it snap to the 3.5 rem rail a beat later — with every
 * page's content column jumping 200 px left as it did. That is the same class
 * of bug as the theme flash `ThemeColorSync` exists for, except it moves layout
 * rather than colour, which is worse. next-themes solves it with a blocking
 * inline script; a cookie solves it with no script at all, because the server
 * already knows the answer while it is rendering.
 *
 * The reference implementation (Fiscalis) writes the same cookie but never
 * reads it on the server — it hardcodes `defaultOpen = true` — so it has
 * exactly this flash. Reading it is the part worth taking.
 *
 * ## Why the parsing is a pure function
 *
 * Because it runs in two different worlds. The server sees Next's parsed
 * `cookies()` store; the client sees the raw `document.cookie` string it wrote.
 * Taking the value as an argument is what lets one rule answer for both, and
 * what lets the "absent means expanded" default be tested rather than asserted
 * in two places that could drift.
 */

/** The cookie's name. Prefixed because this is a first-party UI preference and
 * not something a reader should have to distinguish from the auth cookies that
 * share the domain. */
export const SIDEBAR_COOKIE = "bt_sidebar"

/** A year. This is a deliberate, low-stakes preference about the reader's own
 * screen, and re-collapsing the sidebar every session would be the site
 * forgetting something it was told. Session scope is right for the splash
 * (lib/splash-gate.ts explains why); it is wrong here, for the mirror-image
 * reason — the splash is an event, this is a setting. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Whether the sidebar should render expanded, given whatever the cookie said.
 *
 * Absent, malformed, or anything other than the literal `"collapsed"` means
 * expanded. That default is the conservative one in the direction that matters:
 * a first-time reader must see the navigation with its words, not a column of
 * nine icons they have to hover to read. Failing *open* is the safe failure for
 * navigation, so the collapsed state is opt-in and has to say so exactly.
 */
export function sidebarExpanded(cookieValue: string | undefined | null): boolean {
  return cookieValue !== "collapsed"
}

/** The value to store for a given state. The inverse of `sidebarExpanded`, kept
 * beside it so the two spellings cannot drift apart. */
export function sidebarCookieValue(expanded: boolean): string {
  return expanded ? "expanded" : "collapsed"
}

/**
 * The full `document.cookie` assignment for a state.
 *
 * `SameSite=Lax` because this is a same-site UI preference that no cross-site
 * request has any business carrying, and `path=/` because the sidebar is on
 * every route — a cookie scoped to the path it was toggled on would make the
 * setting apply to one section of the site and not the rest, which reads as the
 * preference being forgotten at random.
 */
export function sidebarCookieAssignment(expanded: boolean): string {
  return `${SIDEBAR_COOKIE}=${sidebarCookieValue(expanded)}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`
}
