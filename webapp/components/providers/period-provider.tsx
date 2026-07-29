"use client"

import { createContext, useContext, useMemo } from "react"
import { periodLink } from "@/lib/period"

/**
 * The period the surrounding page is scoped to, for the links inside it.
 *
 * ## The problem this solves, and why it is not props
 *
 * Nine components build a link to an MP profile — the roster table, the roster
 * card, the rankings table, the party members table, the vote table, the
 * seating map, the feed item, the search result card, and the home page's feed
 * preview. On a page showing WP19, every one of those must produce
 * `/mps/…?wp=19`, or the reader clicks a name on the WP19 rankings and lands on
 * that person's WP21 profile — or on a 404, if they left in WP20.
 *
 * That is the "period context cannot silently drop" requirement, and threading
 * two more props through nine components would satisfy it exactly once. The
 * tenth link, added later by someone who did not read this note, would drop the
 * period and nothing would fail: the link works, it simply goes to the wrong
 * Bundestag. A context makes the *default* correct instead — a new link calls
 * `useMPHref` like its neighbours and inherits the page's period without
 * knowing the period exists.
 *
 * ## Absent provider means the current period
 *
 * The default value is "no period", which `periodLink` renders as a bare path.
 * That is exactly right for the surfaces that are not period-scoped and should
 * not become so: `/` and `/dashboard` are always the sitting Bundestag by
 * design, and their MP links should stay `/mps/bt-0001` rather than growing a
 * parameter that names the period they were already going to get.
 *
 * So this is opt-in per page rather than a provider in the root layout. Adding
 * it to app/layout.tsx would be the obvious move and would be wrong for the
 * same reason `?wp=21` is never written into a URL: it would make every link on
 * the site carry a period, including the ones whose whole meaning is "whatever
 * is current".
 *
 * ## `current` is here too, and it is what keeps URLs clean
 *
 * `periodLink` omits the parameter when the period *is* the current one, so a
 * page scoped to WP21 produces the same bare links it always did. Without
 * `current` in the context every link on the current period would carry
 * `?wp=21`, which is the pinning `lib/period.ts` exists to prevent — shipped
 * through the back door of a link builder rather than the address bar.
 */

type PeriodContextValue = {
  /** The period this subtree is about, or null where it is not period-scoped. */
  wahlperiode: number | null
  /** The sitting period, so links to it can omit the parameter. */
  current: number | null
}

const PeriodContext = createContext<PeriodContextValue>({ wahlperiode: null, current: null })

export function PeriodProvider({
  wahlperiode,
  current,
  children,
}: {
  wahlperiode: number | null
  current: number | null | undefined
  children: React.ReactNode
}) {
  const value = useMemo(
    // `?? null` folds `undefined` (still resolving) into "unknown", which
    // `periodLink` treats as "write the parameter". That is the safe direction:
    // an explicit `?wp=19` is never wrong, only more verbose, where omitting it
    // on a historical page would silently send the reader to the current one.
    () => ({ wahlperiode, current: current ?? null }),
    [wahlperiode, current],
  )
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
}

/** The period this subtree is scoped to. `null` outside a provider — see the
 * header for why that is the right default rather than an error. */
export function usePeriod(): PeriodContextValue {
  return useContext(PeriodContext)
}

/**
 * A link to one MP's profile, in this page's period.
 *
 * The function every list uses instead of building the string itself. It
 * encodes the id — `internalId` is a `bt-…` string that has never needed
 * escaping and encoding it anyway is what the nine call sites already did — and
 * appends the period only when there is one to append.
 *
 * A hook returning a function rather than a hook taking an id, because the
 * callers are inside `.map()` and a hook cannot be called there.
 */
export function useMPHref(): (internalId: string) => string {
  const { wahlperiode, current } = usePeriod()
  return useMemo(
    () => (internalId: string) =>
      periodLink(`/mps/${encodeURIComponent(internalId)}`, wahlperiode, current),
    [wahlperiode, current],
  )
}

/**
 * The same, for any in-app path — a party page from the roster, `/votes/[id]`
 * from a ballot list, `/seating` from the chamber preview.
 *
 * `useMPHref` is the specialisation because it is nine of the twelve call sites
 * and because it also owns the encoding; this is the general form for the rest.
 */
export function usePeriodHref(): (pathname: string) => string {
  const { wahlperiode, current } = usePeriod()
  return useMemo(
    () => (pathname: string) => periodLink(pathname, wahlperiode, current),
    [wahlperiode, current],
  )
}
