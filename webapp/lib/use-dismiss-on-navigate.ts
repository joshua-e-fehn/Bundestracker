"use client"

import { usePathname } from "next/navigation"
import { useState } from "react"

/**
 * Open/closed state for a navigation overlay that dismisses itself on a route
 * change.
 *
 * Both navigation surfaces need exactly this and nothing more: the desktop
 * group menus (components/nav-desktop.tsx) and the mobile drawer
 * (components/nav-mobile.tsx). Neither Radix primitive closes on navigation on
 * its own — following a `<Link>` inside an open menu or dialog changes the
 * route and leaves the panel sitting over the page it just opened — and it is
 * not something either primitive *could* know about, since neither has any idea
 * what a route is.
 *
 * ## Why the panels are not wired to each link's `onClick`
 *
 * That was the old header's approach (`onClick={() => setMenuOpen(false)}` on
 * every row) and it has two holes. It covers only the links someone remembered
 * to wire — the search box's submit navigates too, and so does the wordmark —
 * and it does nothing for a navigation the reader did not start from the panel,
 * such as the browser's back button. Watching the pathname covers all three
 * cases with one rule that a new entry cannot forget to opt into.
 *
 * ## Why this adjusts state during render rather than in an effect
 *
 * This is React's own documented pattern for "reset state when a value
 * changes", and it is preferable here for a reason that is visible on screen:
 * an effect runs *after* the browser paints, so the panel would be rendered
 * once over the new page and then removed, which is a flash on every
 * navigation. Adjusting during render means React discards the in-progress
 * output and re-renders immediately with the panel closed — nothing is ever
 * painted open over the new route.
 *
 * It also happens to be what the linter wants. `useEffect(..., [pathname])`
 * with a body that only calls `setOpen(false)` reads `pathname` in its
 * dependency list but not in its body, so Biome's `useExhaustiveDependencies`
 * flags it as an unnecessary dependency — correctly, by its own rule, and the
 * suppression comment for it does not apply cleanly. Two independent reasons to
 * prefer the same shape is a good sign it is the right one.
 */
export function useDismissOnNavigate() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // The pathname this component last rendered against. Comparing it to the
  // current one is what turns "the route changed" into a render-time signal;
  // storing it in state rather than a ref is what makes the comparison happen
  // during render at all.
  const [renderedAt, setRenderedAt] = useState(pathname)

  if (pathname !== renderedAt) {
    setRenderedAt(pathname)
    // Only when it would actually change something. Calling `setOpen` on every
    // navigation while already closed — the common case, since most readers
    // navigate from the page rather than from an open panel — would queue a
    // re-render for nothing.
    if (open) setOpen(false)
  }

  // `pathname` is returned rather than left to a second `usePathname()` call in
  // the caller: both surfaces need it again for their active-state marks, and
  // one source keeps the panel's dismissal and the highlight reading the same
  // value in the same render.
  return { open, setOpen, pathname }
}
