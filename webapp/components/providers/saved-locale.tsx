"use client"

import { useQuery } from "convex/react"
import { useEffect } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { api } from "@/convex/_generated/api"

/**
 * Applies the language saved on a signed-in reader's account.
 *
 * Renders nothing. It exists because `userPreferences.preferredLocale` has been
 * in the schema, in the validator and in the mutation's arguments since the
 * table was written, with **no writer and no reader** — the same class of
 * finished-and-uncalled backend the 2026-07-29 audit counted nineteen of. The
 * settings page is the writer; this is the reader, and without it the control
 * would store a value that never did anything, which is a worse outcome than
 * not offering the control at all.
 *
 * ## Why a component rather than a hook inside `LocaleProvider`
 *
 * The provider is above `AuthProvider`'s Convex client in the tree only by
 * accident of ordering — but more importantly it must work with no Convex at
 * all. `LocaleProvider` is what makes the site render in a language; wiring a
 * `useQuery` into it would make every page's text depend on the backend being
 * reachable, so an unreachable deployment would take out the language rather
 * than one section. This sits *inside* both providers, subscribes on its own,
 * and can fail without taking anything with it.
 *
 * ## Precedence, and why this cannot fight the toggle
 *
 * `adoptSavedLocale` applies the value only when localStorage holds no choice
 * (components/providers/locale-provider.tsx). So a reader who has pressed the
 * toggle in this browser is never overridden — including immediately after
 * pressing it, since the settings page writes localStorage through `setLocale`
 * in the same act that writes the column.
 *
 * `null` — the documented default and what "no preference" clears the column to
 * — is not a language, so nothing is applied. That is the state in which the
 * browser's own list should decide, which rule 3 has already done by the time
 * this query resolves.
 */
export function SavedLocaleSync() {
  const { adoptSavedLocale } = useLocale()
  // Signed out this resolves to the defaults, `preferredLocale: null`, and the
  // effect below does nothing — no branch on the session needed, and so no
  // hydration hazard of the kind components/sidebar-account.tsx guards: this
  // component renders `null` in every state.
  const preferences = useQuery(api.userPreferences.getPreferences, {})
  const saved = preferences?.preferredLocale ?? null

  useEffect(() => {
    if (saved) adoptSavedLocale(saved)
  }, [saved, adoptSavedLocale])

  return null
}
