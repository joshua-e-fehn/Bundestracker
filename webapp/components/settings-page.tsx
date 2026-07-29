"use client"

import { useMutation, useQuery } from "convex/react"
import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { MPCard } from "@/components/mp-card"
import { PageHeading } from "@/components/page-heading"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { WeightControls } from "@/components/weight-controls"
import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"
import { isLocale, LOCALE_LABELS, LOCALES, type Locale } from "@/lib/i18n"
import { DEFAULT_WEIGHTS, resolveWeights, type ScoreWeights } from "@/lib/scoring"
import { watchlistGap } from "@/lib/watchlist"

/**
 * `/settings` — the one place a reader's saved choices live.
 *
 * The route the audit of 2026-07-29 found missing (GAP-007) under a backend
 * that had been finished and uncalled since it was written: four public
 * `userPreferences` functions with no caller, holding the two things the site
 * has advertised an account for in both languages all along — custom score
 * weightings, and a list of followed members.
 *
 * ## It reuses the controls rather than restating them
 *
 * The sliders are `components/weight-controls.tsx`, the same component the MP
 * profile's score panel renders, and the rows in the watchlist are `MPCard`,
 * the same card the rankings and the home page's boards use. Neither is
 * re-implemented here — a second set of sliders would be a second definition of
 * what a weight's range is, and a bespoke follow row would be a second answer
 * to what an MP looks like in a list.
 *
 * What is genuinely new here is only the *page*: which choices belong together,
 * and what each of them says when it is empty.
 *
 * ## Signed out it is a page, not a redirect
 *
 * `/settings` is on `PUBLIC_PATHS` (lib/auth-routes.ts) like every other route
 * on this site, and that is deliberate rather than an omission. The list is
 * gated by *omission* by design, so leaving `/settings` off it would have
 * `AuthGuard` redirect a signed-out reader to `/sign-in` — a bounce with no
 * explanation, from a link they can see in the navigation. Instead the page
 * renders and says what an account holds, which is the same position
 * `components/mp-score-panel.tsx` takes for the sliders and
 * `components/sign-in-panel.tsx` takes for the whole flow.
 *
 * ## Language is saved in two places on purpose
 *
 * The toggle in the footer and the drawer writes `localStorage`
 * (components/providers/locale-provider.tsx) — that is what makes the choice
 * survive a reload for the signed-out majority, and it stays the source of
 * truth for the current tab. `userPreferences.preferredLocale` is the column
 * that was already in the schema for this and had no writer; setting it here
 * carries the choice to another device. The select writes both, and the "no
 * preference" option clears the stored column without touching the tab's own
 * language, because "I have not chosen" and "I chose German" are different
 * states and only the first should follow a browser that speaks English.
 */
export function SettingsPage({ wahlperiode }: { wahlperiode: number }) {
  const { data: session, isPending } = authClient.useSession()

  /**
   * ⚠ A hydration guard, not a loading flag.
   *
   * The same contract as components/sidebar-account.tsx and
   * components/providers/auth-guard.tsx: the server has no session, so its HTML
   * always holds the skeleton; on the client Better Auth can resolve before
   * React hydrates, and putting a different element type into that slot on the
   * first client render makes React throw #418, regenerate the tree and — in
   * React 19 — detach `<head>`, after which the reader's next click dies with a
   * null `removeChild`. Effects do not run until hydration commits, which is
   * what pins the first client render to the server's branch.
   *
   * Guarded by components/sidebar-account.test.ts, which reads every file that
   * branches on `authClient.useSession()`.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="flex flex-col gap-8">
      <PageHeading titleKey="settings.title" subtitleKey="settings.subtitle" />

      {!mounted || isPending ? (
        <SettingsSkeleton />
      ) : session ? (
        <div className="flex flex-col gap-6">
          <WeightsSection />
          <LanguageSection />
          <WatchlistSection wahlperiode={wahlperiode} />
        </div>
      ) : (
        <SignedOut />
      )}
    </div>
  )
}

/** Three cards' worth of space, so the page does not reflow when the session
 * resolves into either branch. */
function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}

/**
 * What an account is for, for a reader who has not got one.
 *
 * Names the two things exactly, in the same words `auth.benefits` uses on the
 * sign-in page — including the fact that everything else is readable without
 * one. A settings page that said only "please sign in" would imply the account
 * unlocks the site, which is the opposite of how this site works.
 */
function SignedOut() {
  const { t } = useLocale()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.signedOutTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
          {t("settings.signedOutBody")}
        </p>
        <Button asChild>
          <Link href="/sign-in">
            {t("auth.signIn")}
            <ArrowRightIcon />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * The saved weightings.
 *
 * The profile's score panel is where a reader *discovers* the sliders, beside
 * the number they change; this is where the saved set is edited on its own —
 * the same control, a different question. So the state here starts from what is
 * stored rather than from the defaults, and the extra affordance is the one the
 * panel has no room for: deleting the saved set entirely.
 *
 * That deletion is `customWeights: null`, which the mutation distinguishes from
 * a saved set that happens to equal the defaults — an explicit `null` clears,
 * an omitted key leaves alone (convex/userPreferences.ts). The distinction is
 * load-bearing rather than pedantic: a reader who saved the defaults keeps them
 * if those defaults later change, and a reader who cleared follows the new ones.
 */
function WeightsSection() {
  const { t, locale } = useLocale()
  const preferences = useQuery(api.userPreferences.getPreferences, {})
  const savePreferences = useMutation(api.userPreferences.updatePreferences)

  const [draft, setDraft] = useState<ScoreWeights | null>(null)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "cleared" | "failed">("idle")

  // Adopts the stored weights once they arrive, and only while untouched — the
  // same null guard components/mp-score-panel.tsx uses, and for the same
  // reason: without it a slow query would snap a slider back mid-drag.
  const saved = preferences?.customWeights ?? null
  useEffect(() => {
    if (saved) setDraft((current) => current ?? resolveWeights(saved))
  }, [saved])

  if (preferences === undefined) {
    return <Skeleton className="h-64 rounded-xl" />
  }

  const weights = draft ?? resolveWeights(saved)
  const hasSaved = preferences.customWeights !== null

  async function save(next: ScoreWeights | null) {
    setState("saving")
    try {
      await savePreferences({ customWeights: next })
      if (next === null) {
        // The draft goes with the stored set, or the sliders would keep showing
        // values that are no longer saved anywhere.
        setDraft(null)
        setState("cleared")
      } else {
        setState("saved")
      }
    } catch {
      setState("failed")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.weights.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
          {t("settings.weights.description")}
        </p>
        <p className="text-muted-foreground text-xs">
          {hasSaved ? t("settings.weights.usingCustom") : t("settings.weights.usingDefaults")}
        </p>

        <WeightControls
          weights={weights}
          locale={locale}
          onChange={(next) => {
            setDraft(next)
            setState("idle")
          }}
          // The sliders' own reset moves them back to the defaults *without*
          // saving; "delete saved weightings" below is the one that writes. Two
          // buttons because they are two different acts, and collapsing them
          // would make a reader who only wanted to see the default view lose
          // what they had stored.
          onReset={() => {
            setDraft({ ...DEFAULT_WEIGHTS })
            setState("idle")
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={() => void save(weights)}
            disabled={state === "saving"}
          >
            {state === "saving" ? t("weights.saving") : t("weights.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void save(null)}
            // Nothing to delete when nothing is stored — and the label would
            // otherwise promise an act with no effect.
            disabled={!hasSaved || state === "saving"}
          >
            {t("settings.weights.clear")}
          </Button>
          {state === "saved" ? (
            <span className="text-muted-foreground text-xs">{t("weights.saved")}</span>
          ) : null}
          {state === "cleared" ? (
            <span className="text-muted-foreground text-xs">{t("settings.weights.cleared")}</span>
          ) : null}
          {state === "failed" ? (
            <span role="alert" className="text-destructive text-xs">
              {t("weights.saveFailed")}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

/** The value the select carries for "I have not chosen" — a `<select>` holds a
 * string, and the stored column holds `null`. */
const NO_LOCALE_PREFERENCE = "auto"

/**
 * The saved language.
 *
 * The same choice the footer's and drawer's `LocaleToggle` makes, with the half
 * that toggle cannot do: writing it to the account so it reaches another
 * device. Both are set here — the provider's `localStorage` key is what the
 * current tab reads, and the column is what a new one inherits.
 */
function LanguageSection() {
  const { t, locale, setLocale } = useLocale()
  const preferences = useQuery(api.userPreferences.getPreferences, {})
  const savePreferences = useMutation(api.userPreferences.updatePreferences)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle")

  if (preferences === undefined) {
    return <Skeleton className="h-40 rounded-xl" />
  }

  const stored = preferences.preferredLocale

  async function choose(value: string) {
    const next: Locale | null = isLocale(value) ? value : null
    setState("saving")
    try {
      await savePreferences({ preferredLocale: next })
      // Only when a language was actually named. Clearing the stored preference
      // is not a request to change the language of the page you are reading —
      // it says "stop pinning it", and switching the tab to something else at
      // that moment would be a change nobody asked for.
      if (next) setLocale(next)
      setState("saved")
    } catch {
      setState("failed")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.language.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
          {t("settings.language.description")}
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-locale">{t("nav.language")}</Label>
          <Select
            value={stored ?? NO_LOCALE_PREFERENCE}
            onValueChange={(value) => void choose(value)}
            disabled={state === "saving"}
          >
            <SelectTrigger id="settings-locale" className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LOCALE_PREFERENCE}>
                {t("settings.language.followBrowser")}
              </SelectItem>
              {LOCALES.map((value) => (
                // Each language named in itself, as `LOCALE_LABELS` does for
                // the toggle — a picker that names languages in a language you
                // may not read is not much of a picker.
                <SelectItem key={value} value={value}>
                  {LOCALE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {state === "saved" ? (
          <p className="text-muted-foreground text-xs">{t("settings.language.saved")}</p>
        ) : null}
        {state === "failed" ? (
          <p role="alert" className="text-destructive text-xs">
            {t("weights.saveFailed")}
          </p>
        ) : null}
        {/* The current language, for the case the two disagree: a reader who
            has cleared the stored preference is still reading *some* language,
            and the select no longer names it. */}
        <p className="text-muted-foreground text-xs">{LOCALE_LABELS[locale]}</p>
      </CardContent>
    </Card>
  )
}

/**
 * The watchlist: the MPs this reader follows.
 *
 * Two queries rather than one, and the pair is the point. `getFollowedMPs`
 * resolves the roster rows for a period and **skips anyone not sitting in it**
 * (convex/userPreferences.ts), which is right for the list — a placeholder row
 * for a member who left in 2021 would be a gap rendered as a person.
 * `getPreferences` holds the raw ids, so the difference between the two counts
 * is exactly the set that was skipped, and the note below says so rather than
 * letting the list be quietly shorter than the number of people followed.
 *
 * The cards carry `showHeatmap`, which the roster page deliberately does not:
 * that is a query per card, fine for the handful of people one person follows
 * and not for 630 rows. A watchlist is the surface where the twelve-week strip
 * is most worth its cost — it is the reason someone is following.
 */
function WatchlistSection({ wahlperiode }: { wahlperiode: number }) {
  const { t } = useLocale()
  const followed = useQuery(api.userPreferences.getFollowedMPs, { wahlperiode })
  const preferences = useQuery(api.userPreferences.getPreferences, {})

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.watchlist.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
          {t("settings.watchlist.description")}
        </p>

        {followed === undefined ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : followed.length === 0 ? (
          <EmptyWatchlist />
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {followed.map((mp) => (
                <MPCard
                  key={mp.internalId}
                  mpInternalId={mp.internalId}
                  name={mp.name}
                  fraktion={mp.fraktion}
                  photoUrl={mp.photoUrl}
                  photoCredit={mp.photoCredit}
                  showHeatmap
                />
              ))}
            </div>
            <NotSittingNote
              followedIds={preferences?.followedMpIds.length}
              shown={followed.length}
              wahlperiode={wahlperiode}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Nobody followed yet.
 *
 * Says *how* to follow, because the control is on another page entirely — an
 * empty state that only reports emptiness leaves a reader to guess whether the
 * feature exists. The link goes to the roster rather than to the rankings: the
 * question behind an empty watchlist is "who is my member", and `/mps` is the
 * page that answers it.
 */
function EmptyWatchlist() {
  const { t } = useLocale()

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border/60 border-dashed p-5">
      <p className="font-medium text-sm">{t("settings.watchlist.empty")}</p>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
        {t("settings.watchlist.emptyHint")}
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/mps">
          {t("settings.watchlist.browse")}
          <ArrowRightIcon />
        </Link>
      </Button>
    </div>
  )
}

/**
 * How many followed members this period does not show.
 *
 * Renders nothing when the two counts agree, which is the ordinary case. The
 * arithmetic is `watchlistGap` in lib/watchlist.ts rather than inline here —
 * it has three cases and two of them (an in-flight count, and a difference
 * that can legitimately go negative) are wrong in ways a reader would never
 * report, so it belongs where it can be tested.
 */
function NotSittingNote({
  followedIds,
  shown,
  wahlperiode,
}: {
  followedIds: number | undefined
  shown: number
  wahlperiode: number
}) {
  const { t } = useLocale()
  const gap = watchlistGap(followedIds, shown)
  if (gap.kind === "none") return null

  return (
    <p className="text-muted-foreground text-xs leading-relaxed">
      {gap.kind === "one"
        ? t(gap.key, { wahlperiode })
        : t(gap.key, { count: gap.count, wahlperiode })}
    </p>
  )
}
