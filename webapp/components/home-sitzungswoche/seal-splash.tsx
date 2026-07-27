"use client"

import { useEffect, useRef, useState } from "react"
import { BrandMark } from "@/components/brand-mark"

/**
 * "Der Adler entsteht" — the seal being struck, while the first queries fly.
 *
 * The ring draws itself on by `stroke-dashoffset`, the eagle fades in behind it,
 * one gold pass crosses, and the whole thing is gone in about half a second. The
 * motion is in app/globals.css; this component owns only *whether* it runs.
 *
 * ## It is a cost, so it is gated four ways
 *
 * §6 of the design research is blunt about this: an opening animation on a
 * public data dashboard is paid for by every visit, including the daily
 * returning reader, and it can delay LCP by covering the hero. So:
 *
 *  1. **Once per session.** `sessionStorage`, not `localStorage` — a reader who
 *     comes back tomorrow is a new visit and may well have forgotten the page;
 *     a reader who clicked through to an MP and back is mid-session and must
 *     not sit through it twice.
 *  2. **Never under reduced motion.** Skipped entirely rather than shortened,
 *     which §9 requires: a 500 ms animation is not made acceptable by being a
 *     200 ms animation.
 *  3. **Never on a metered connection.** `saveData` is Chrome-only (measured:
 *     no Firefox, no Safari), so this is a bonus rather than a guarantee — it
 *     costs one optional-chained read and helps the readers most likely to
 *     mind.
 *  4. **Dismissible.** Any key, click, touch or scroll ends it now.
 *
 * ## It never blocks data
 *
 * The Convex queries are fired by the page underneath and are already in flight
 * while this is on screen — the splash overlaps real loading rather than adding
 * to it. That is why it is an overlay rendered *beside* the content rather than
 * a gate rendered instead of it: nothing below waits on this component, and if
 * its timer never fired the page would still be complete underneath.
 *
 * ## Why the decision is in an effect and not in `useState`'s initialiser
 *
 * Reading `sessionStorage` or `matchMedia` during render would make the server
 * and client disagree — neither exists during SSR — and React would either warn
 * or silently keep the server's answer. So the first paint is *no splash*, and
 * the effect turns it on for the one visit that has earned it. That ordering
 * also means the failure mode is the harmless one: if this component broke
 * entirely, the reader would simply never see it.
 * components/providers/locale-provider.tsx resolves the same tension the same
 * way, and says so at length.
 */

const STORAGE_KEY = "bundestrack.sitzungswoche.seen"

/**
 * How long the seal holds before it leaves, in milliseconds.
 *
 * The animation itself is ~500 ms (ring 460, eagle trailing to 540, sheen to
 * 820 — see app/globals.css); this is that plus a beat to register as an image
 * rather than a flash. Comfortably inside §6's 900 ms ceiling, and the fade-out
 * runs on top rather than after.
 */
const HOLD_MS = 620

/** How long the fade-out lasts — must match `sitzung-splash-out` in
 * app/globals.css, since that is what actually paints it. Named here so the two
 * are changed together rather than drifting into a flash of empty overlay. */
const FADE_MS = 260

/**
 * Whether this visit should see the seal.
 *
 * Every check is defensive because every one of them can throw or be absent:
 * `sessionStorage` throws outright in a Safari private window, `matchMedia`
 * predates nothing but is worth guarding beside it, and `connection` exists in
 * one engine. A splash that crashes the page it decorates would be a poor trade.
 */
function shouldShowSeal(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false
    // `saveData` on a `NetworkInformation` that only Chromium ships. Optional
    // all the way down rather than feature-detected in a branch of its own.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (connection?.saveData === true) return false
    if (window.sessionStorage.getItem(STORAGE_KEY) !== null) return false
    window.sessionStorage.setItem(STORAGE_KEY, "1")
    return true
  } catch {
    // Storage disabled, or a privacy mode that throws on write. The reader gets
    // no splash, which is the right way to fail.
    return false
  }
}

export function SealSplash() {
  /** `null` is "not decided yet" — the SSR state and the first client frame.
   * Distinct from `false`, which is "decided, and this visit does not get
   * one": only the first renders nothing *and* may still change its mind. */
  const [visible, setVisible] = useState<boolean | null>(null)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const show = shouldShowSeal()
    setVisible(show)
    if (!show) return

    const dismiss = () => {
      setLeaving(true)
      // Unmounted after the fade rather than immediately, or the overlay
      // vanishes mid-animation and the whole thing reads as a flicker.
      timers.current.push(window.setTimeout(() => setVisible(false), FADE_MS))
    }

    timers.current.push(window.setTimeout(dismiss, HOLD_MS))

    // Any deliberate act ends it. `once` so the handlers cannot fire twice into
    // a second timer, and `passive` on the two that would otherwise cost the
    // scroller a non-passive listener.
    const options = { once: true, passive: true } as const
    window.addEventListener("keydown", dismiss, { once: true })
    window.addEventListener("pointerdown", dismiss, options)
    window.addEventListener("wheel", dismiss, options)
    window.addEventListener("touchstart", dismiss, options)

    return () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      timers.current = []
      window.removeEventListener("keydown", dismiss)
      window.removeEventListener("pointerdown", dismiss)
      window.removeEventListener("wheel", dismiss)
      window.removeEventListener("touchstart", dismiss)
    }
  }, [])

  if (visible !== true) return null

  return (
    // `aria-hidden` and `pointer-events-none`, which together are what make this
    // decoration rather than a dialog. It announces nothing (the page beneath is
    // already the accessible content and is already there), it traps no focus,
    // and it cannot swallow the click that dismisses it — the listener is on the
    // window, so a pointer-down goes to whatever is underneath as well.
    <div
      aria-hidden
      data-leaving={leaving}
      className="sitzung-splash pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-background"
    >
      <div className="relative">
        <BrandMark
          className="size-24 text-gold-brand"
          ringClassName="sitzung-seal-ring"
          markClassName="sitzung-seal-mark"
        />
        {/* The gold pass, on its own element over the mark. A separate layer
            because the sheen is a moving `background-position` and the mark is
            an SVG — one element cannot be both, and masking the gradient to the
            eagle's shape would cost a `mask-image` for an effect that reads
            fine as a square pass across a round seal. */}
        <span className="sitzung-seal-sheen absolute inset-0" />
      </div>
    </div>
  )
}
