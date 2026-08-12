"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

/**
 * Who may open the report sheet, and whether it is open.
 *
 * The sheet itself lives in exactly one place — `components/feedback-widget.tsx`,
 * mounted once by the footer — while three controls open it: the footer's own
 * button, the sidebar's navigation row, and the mobile drawer's. This holds the
 * one boolean between them.
 *
 * ## Why the navigation entry is not a link to a page
 *
 * A report is filed *about the page you are on*. The widget's own header spells
 * this out: navigating to a `/feedback` route to file it would lose the context
 * for the reporter, who can no longer see the thing they are describing, and for
 * the diagnostic collectors, whose breadcrumb trail would end with "navigated to
 * /feedback" and whose screenshot would be of the form. So the navigation entry
 * opens the sheet in place, and there is no route to add.
 *
 * That is why this is a provider rather than a `NavItem` with an `href`. It is
 * the same reason `SidebarProvider` exists — one piece of shell state with
 * consumers that are not each other's children — and it is deliberately the same
 * shape, down to throwing rather than defaulting.
 *
 * ## What this does *not* decide
 *
 * Whether the control should exist at all. `feedback:isConfigured` answers that,
 * and each control asks it independently: this provider is mounted for everyone,
 * including signed-out readers on a deployment with no GitHub credentials, and
 * holds `false` harmlessly. Putting the eligibility check here would mean the
 * provider had to subscribe to Convex and the session, which would make every
 * page in the app re-render on an auth change for a boolean most of them do not
 * read.
 */

type FeedbackContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  /** Opens the sheet. The verb the navigation rows call, so a row does not have
   * to know that `true` is the open state. */
  openFeedback: () => void
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

/**
 * Reads the report sheet's state.
 *
 * Throws rather than returning a default, for the reason `useSidebar` gives: a
 * silent default would be a navigation row that renders, looks live, and does
 * nothing when pressed. The root layout mounts the provider, so the throw is a
 * wiring error at development time and never a reader's problem.
 */
export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext)
  if (!context) throw new Error("useFeedback must be used inside <FeedbackProvider>")
  return context
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const openFeedback = useCallback(() => setOpen(true), [])
  const value = useMemo(() => ({ open, setOpen, openFeedback }), [open, openFeedback])
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}
