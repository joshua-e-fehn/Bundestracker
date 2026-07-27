"use client"

import { useEffect, useState } from "react"
import { useReducedMotion } from "framer-motion"

/**
 * The opening animation: the federal rule draws itself across the viewport,
 * then becomes the page's top edge.
 *
 * Concept L3 from §6 of the design research — "Schwarz-Rot-Gold (The Rule
 * Draws)" — chosen for this page because Concept C is the restrained one and a
 * 630-dot hemicycle assembling would be the loudest thing on a page whose whole
 * argument is restraint. The rule is already the site's one flag reference (see
 * `federal-rule` in app/globals.css); this animates the element the header
 * carries anyway rather than introducing a motif for the splash alone.
 *
 * Two `transform`s on one gradient-painted element, ~600 ms, no media, no
 * network. Both composite off the main thread.
 *
 * ## Every rule from §6 is enforced here, and they are not optional
 *
 * A splash on a public data dashboard is a cost paid by every visit, including
 * the daily returning reader's. So:
 *
 *  1. **Once per session** (`sessionStorage`). A reader who navigates to
 *     `/mps` and back does not see it twice.
 *  2. **Never blocks data.** This renders *over* the page, which is mounted and
 *     whose Convex subscriptions are already open underneath — the splash
 *     overlaps real loading instead of adding to it. There is no gate: the page
 *     is not waiting on this component for anything.
 *  3. **Skipped entirely under `prefers-reduced-motion`**, not shortened. §9:
 *     reduced motion is the resting state, and the resting state of an opening
 *     animation is not having one.
 *  4. **Skipped on `saveData`.** A reader on a metered connection has said what
 *     they want and it is not this.
 *  5. **Dismissible.** Any key, click, touch or scroll ends it immediately.
 *
 * ## Why it does not cover the page
 *
 * It is a 3 px line on a transparent backdrop, so the hero is painted and
 * readable underneath from the first frame. §8 notes that a splash covering the
 * hero *delays LCP*, and this one cannot: there is nothing behind it to occlude.
 * That is most of why L3 was the right pick for this concept — the cheapest
 * splash is the one that is not a splash screen at all.
 *
 * ## Why it renders nothing on the server
 *
 * `sessionStorage` and `matchMedia` do not exist there, and guessing wrong in
 * either direction is worse than waiting a frame: a server-rendered line would
 * flash for readers who should never see it, and hydrating a "seen" state as
 * "unseen" would mismatch. So the first client effect decides, and until it
 * does this is `null` — costing nothing, since the animation is decoration and
 * the page beneath it is already complete.
 */

/** Session-scoped, and the key is namespaced like `bundestrack.locale` in
 * components/providers/locale-provider.tsx. */
const STORAGE_KEY = "bundestrack.home-c.splash"

/**
 * How long the whole thing lasts, in milliseconds — the draw plus the drop into
 * place plus the fade.
 *
 * Comfortably inside §6's 900 ms budget. Long enough to be seen as a deliberate
 * gesture, short enough that a reader who came for today's votes does not
 * register having waited.
 */
const SPLASH_MS = 620

/**
 * `navigator.connection` is not in the DOM lib's `Navigator` — it is a draft
 * spec that Chrome and Chromium ship and Safari and Firefox do not. Declared
 * narrowly here rather than cast to `any`: what is used is one optional boolean,
 * and this states exactly that.
 */
type MaybeSaveData = Navigator & { connection?: { saveData?: boolean } }

function shouldPlay(): boolean {
  // Any of these being unavailable means "not a browser that can tell me", and
  // the safe answer to that is to skip rather than to play.
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY) !== null) return false
    if ((navigator as MaybeSaveData).connection?.saveData === true) return false
    return true
  } catch {
    // `sessionStorage` throws outright in a partitioned or storage-blocked
    // context (Safari private browsing has historically done so). A reader
    // whose browser will not let this be remembered would otherwise get the
    // animation on every single navigation, which is precisely the cost rule 1
    // exists to prevent.
    return false
  }
}

export function RuleSplash() {
  const reduceMotion = useReducedMotion()
  // Three states rather than a boolean: `null` is "not decided yet" (the server
  // render and the first client render), which must not be confused with
  // "decided: do not play". Same three-state discipline as `useRevealOnScroll`.
  const [playing, setPlaying] = useState<boolean | null>(null)

  useEffect(() => {
    // `useReducedMotion` returns `null` server-side and resolves on the client,
    // so this waits for a real answer rather than treating `null` as false.
    if (reduceMotion === null) return
    if (reduceMotion || !shouldPlay()) {
      setPlaying(false)
      return
    }

    // Marked seen when it *starts*, not when it finishes. A reader who
    // navigates away mid-animation has seen it, and the alternative replays it
    // on their return — the one case where "once per session" would visibly
    // fail.
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "1")
    } catch {
      // Already handled above for the read; a write that fails after a
      // successful read is not worth a second branch. The animation plays once
      // now and the next navigation decides again.
    }

    setPlaying(true)

    const end = () => setPlaying(false)
    const timer = window.setTimeout(end, SPLASH_MS)
    // Rule 5. `once` so each listener removes itself, and passive on the two
    // that would otherwise cost the scroller a frame.
    const options = { once: true, passive: true } as const
    window.addEventListener("keydown", end, options)
    window.addEventListener("pointerdown", end, options)
    window.addEventListener("scroll", end, options)
    window.addEventListener("wheel", end, options)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("keydown", end)
      window.removeEventListener("pointerdown", end)
      window.removeEventListener("scroll", end)
      window.removeEventListener("wheel", end)
    }
  }, [reduceMotion])

  if (playing !== true) return null

  return (
    // `pointer-events-none` so it cannot swallow the click that dismisses it.
    // `aria-hidden` for the reason components/hero-animation.tsx gives about
    // every decorative mark on this site: it carries no information, so
    // announcing it would be announcing nothing.
    <div aria-hidden className="pointer-events-none fixed inset-0 z-100">
      {/* Two elements, two animations, because they are two motions on the same
          axis and one element cannot carry two `transform` animations — the
          same constraint components/hero-animation.tsx documents for the coin's
          spin and bob.

          The lift is on the *full-height* wrapper rather than on the rule, so
          it can travel exactly half the container with `translateY(-50%)`. The
          obvious alternative, `-50vh` on the rule itself, is subtly wrong on a
          phone: `vh` is the *large* viewport height, which is taller than the
          fixed container while the URL bar is showing, so the rule would
          overshoot the top edge by the height of that bar. A percentage of the
          wrapper cannot disagree with the wrapper. */}
      <div className="rule-splash-lift absolute inset-0">
        <div className="rule-splash-draw federal-rule absolute inset-x-0 top-1/2 h-[3px]" />
      </div>
    </div>
  )
}
