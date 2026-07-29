"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { sidebarCookieAssignment } from "@/lib/sidebar-state"

/**
 * The app shell's one piece of shared state: is the desktop sidebar expanded.
 *
 * Deliberately much smaller than shadcn's `SidebarProvider`, which the
 * reference implementation (Fiscalis) uses. That component carries a second
 * `openMobile` state and a `useIsMobile` media-query hook so one `<Sidebar>`
 * can render as a rail on desktop and as a sheet on a phone. This site does not
 * need either, because it already has a *separate, deliberate* mobile pattern
 * — `components/nav-mobile.tsx`, a drawer opened from the header — and keeping
 * two independent components is the point rather than an omission:
 *
 *  - The drawer shows every destination flat and open, because it scrolls and
 *    has no width budget. The sidebar collapses to icons, because it is
 *    permanently on screen and competing with the content for width. Those are
 *    different answers to different problems, and one component parameterised
 *    by viewport would have to hold both.
 *  - `useIsMobile` decides which to render in *JavaScript*, from
 *    `matchMedia`, which the server cannot evaluate. That makes the first paint
 *    a guess: shadcn's hook returns `undefined` until mount, so the sidebar is
 *    absent from the server HTML and appears on hydration. Here the split is a
 *    CSS media query (`lg:`), so both surfaces are in the HTML and the browser
 *    picks one before any script runs.
 *
 * What is kept from the reference is the part that matters: one shell wrapping
 * the whole app, a persisted collapse state, and `Ctrl/⌘+B` to toggle it.
 */

type SidebarContextValue = {
  /** Whether the desktop sidebar shows labels (`true`) or is an icon rail. */
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

/**
 * Reads the shell state.
 *
 * Throws rather than returning a default when there is no provider. A silent
 * default would mean a trigger button that renders, looks live, and does
 * nothing when pressed — the failure mode is a control that lies, and it would
 * only be found by a human clicking it. The root layout mounts the provider, so
 * the throw is a wiring error at development time and never a reader's problem.
 */
export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext)
  if (!context) throw new Error("useSidebar must be used inside <SidebarProvider>")
  return context
}

/** The key that toggles the sidebar, with Ctrl (or ⌘ on a Mac). shadcn's own
 * shortcut, kept because it is the one a reader arriving from any other app
 * built on the same primitive will already have in their fingers. */
const TOGGLE_KEY = "b"

export function SidebarProvider({
  /** The state the server rendered with, read from the cookie in
   * `app/layout.tsx`. This is what makes the first paint correct rather than a
   * default that snaps — see lib/sidebar-state.ts. */
  defaultExpanded,
  children,
}: {
  defaultExpanded: boolean
  children: React.ReactNode
}) {
  const [expanded, setExpandedState] = useState(defaultExpanded)

  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next)
    // Written here rather than in an effect on `expanded`, so the cookie is a
    // consequence of the reader's action and not of the state existing. An
    // effect would also write it on mount for every visitor, including the ones
    // who never touched the control — turning a first visit into a stored
    // preference nobody expressed.
    //
    // The Cookie Store API the lint rule points at is unimplemented in Safari
    // and Firefox, so taking it would mean this preference is silently not
    // persisted for a large share of readers — and it is async, which would
    // turn a synchronous click handler into a promise for a one-line write.
    // Assignment here is additive rather than destructive: it sets this one key
    // and leaves the auth cookies sharing the domain untouched, which is the
    // actual hazard the rule exists for.
    // biome-ignore lint/suspicious/noDocumentCookie: unsupported in Safari/Firefox; see above
    document.cookie = sidebarCookieAssignment(next)
  }, [])

  const toggle = useCallback(() => setExpanded(!expanded), [expanded, setExpanded])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== TOGGLE_KEY || (!event.metaKey && !event.ctrlKey)) return
      // Not while the reader is typing. ⌘B is bold in every rich-text field
      // ever written, and the search box is one keystroke from the sidebar on
      // every page — swallowing it globally would be this component reaching
      // into inputs it has nothing to do with.
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggle])

  const value = useMemo(() => ({ expanded, setExpanded, toggle }), [expanded, setExpanded, toggle])

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}
