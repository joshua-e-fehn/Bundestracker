/**
 * Whether the opening animation may run.
 *
 * §6 of the homepage research sets the rules and every one of them is a cost
 * paid by a real visitor rather than a preference: an opening animation on a
 * public data dashboard is charged to *every* visit, including the daily
 * returning reader who came for today's Abstimmungen.
 *
 *  1. **Once per session** — `sessionStorage`, so a repeat navigation goes
 *     straight to the page. Not `localStorage`: a reader coming back the next
 *     morning is a new visit and should see the site's own opening once, the
 *     same way a returning reader of a paper still sees the masthead. Session
 *     scope is what makes it "once" without making it "never again".
 *  2. **Never under `prefers-reduced-motion: reduce`** — skipped entirely,
 *     not shortened. §9: reduced motion is the resting state, and the resting
 *     state of a splash is its absence.
 *  3. **Never under `Save-Data`** — a reader who has told their browser to
 *     economise has told it about this too.
 *  4. **Never once the page is already being read** — see `STALE_AFTER_MS`. An
 *     opening that opens late is not an opening.
 *
 * ## Why this is a pure function of an explicit environment
 *
 * Because the alternative is four `typeof window === "undefined"` guards inside
 * a component that also has to run an animation, and because the gate is the
 * part with a wrong answer that nobody sees: it fails *open* — a splash that
 * runs when it should not is visible and annoying — but it can also fail
 * *closed*, which is invisible, and an animation nobody can reproduce is one
 * nobody can fix. Taking the environment as an argument is what lets both
 * directions be tested.
 */

/** What the gate needs to know about the reader's browser. Every field is
 * optional and absent means "could not tell", which is treated as no objection
 * — the conservative reading for reduced motion and save-data is that they are
 * off unless the browser says otherwise, which is what the media query itself
 * returns. */
export type SplashEnvironment = {
  /** `prefers-reduced-motion: reduce` matches. */
  reduceMotion?: boolean
  /** `navigator.connection.saveData`. */
  saveData?: boolean
  /** Whether this session has already been shown the splash. */
  alreadySeen?: boolean
  /**
   * How long the page has been up when the gate is asked, in milliseconds.
   * Absent means "could not tell", which is not an objection — see
   * `STALE_AFTER_MS`.
   */
  elapsedMs?: number
}

/**
 * How late is too late to open, in milliseconds.
 *
 * The gate runs in an effect, so it runs after hydration — and on a slow device
 * hydration is not fast. Measured against a production build of this app at
 * increasing CPU throttling, the overlay appeared at:
 *
 * | throttle | splash appears | splash leaves |
 * |----------|----------------|---------------|
 * | 1×       | 1.0 s          | 2.5 s         |
 * | 2×       | 1.5 s          | 3.0 s         |
 * | 4×       | 2.9 s          | 5.3 s         |
 * | 6×       | 4.5 s          | 8.1 s         |
 * | 10×      | 7.5 s          | 10.6 s        |
 *
 * At the bottom two rows the reader has been looking at the finished page for
 * seconds before a full-screen `bg-background` overlay drops over it — so it no
 * longer reads as an opening at all, but as the site breaking. Worse, it is
 * `fixed inset-0 z-100` above the header, so the reader's first click lands on
 * the overlay and dismisses it instead of following the link they aimed at.
 * That is the second, independent way this app produced "on a cold load the
 * first click does nothing"; the first was the hydration mismatch fixed in
 * components/user-menu.tsx, and the two were measured separately because they
 * have nothing in common but the symptom.
 *
 * 2500 ms sits above every fast-path measurement and below the two that are
 * too late — 4× still opens, 6× and 10× do not. A splash is a decoration, so
 * when in doubt it does not run: that failure is invisible, while the one it
 * replaces is a page that appears to be broken.
 */
export const STALE_AFTER_MS = 2500

/** The `sessionStorage` key. Namespaced like `bundestrack.locale` in
 * components/providers/locale-provider.tsx, so the two are recognisably one
 * app's keys rather than two habits. */
export const SPLASH_SESSION_KEY = "bundestrack.protokoll.splash"

/** Whether to run the opening animation. */
export function shouldRunSplash(environment: SplashEnvironment): boolean {
  if (environment.reduceMotion === true) return false
  if (environment.saveData === true) return false
  if (environment.alreadySeen === true) return false
  // Strictly greater: an unmeasurable elapsed time is `undefined`, which is not
  // a number and so not late — "could not tell" is not an objection, the same
  // reading the three checks above give an absent field.
  if (environment.elapsedMs !== undefined && environment.elapsedMs > STALE_AFTER_MS) return false
  return true
}

/**
 * The reader's browser, as the gate sees it.
 *
 * Returns an environment that refuses the splash when called outside a browser
 * — during SSR there is no session to have seen it and no media query to ask,
 * and a splash rendered on the server would be in the HTML *before* the gate
 * could run, which is the flash this exists to prevent. The component therefore
 * reads this in an effect and starts closed.
 *
 * Every access is guarded individually rather than behind one `try`: `saveData`
 * is a non-standard field on a non-standard object and is simply absent in
 * Firefox and Safari, while `sessionStorage` *throws* rather than returning
 * null when storage is disabled or a cookie policy blocks it. Those are
 * different failures and only the second one needs catching.
 */
export function readSplashEnvironment(): SplashEnvironment {
  if (typeof window === "undefined") return { alreadySeen: true }

  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection

  return {
    reduceMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    saveData: connection?.saveData === true,
    alreadySeen: hasSeenSplash(),
    elapsedMs: elapsedSinceNavigation(),
  }
}

/**
 * Milliseconds since this document started loading, or `undefined` where that
 * cannot be told.
 *
 * `performance.now()` is measured from the start of navigation, which is
 * exactly the clock this needs — time since the reader asked for the page,
 * rather than time since any particular script ran. It is guarded because
 * `performance` is absent in non-browser environments this module is also
 * imported into (the gate is a pure function with its own tests).
 */
function elapsedSinceNavigation(): number | undefined {
  if (typeof performance === "undefined" || typeof performance.now !== "function") return undefined
  return performance.now()
}

/** Whether this session has already run the splash. Treats an unreadable
 * `sessionStorage` as "seen" — a browser that refuses storage would otherwise
 * replay the animation on every navigation, which is the one failure mode worse
 * than never showing it. */
export function hasSeenSplash(): boolean {
  try {
    return window.sessionStorage.getItem(SPLASH_SESSION_KEY) !== null
  } catch {
    return true
  }
}

/** Records that this session has seen it. Silent on failure for the reason
 * above: a browser that cannot store this has already been handled by
 * `hasSeenSplash` returning true. */
export function markSplashSeen(): void {
  try {
    window.sessionStorage.setItem(SPLASH_SESSION_KEY, "1")
  } catch {
    // Storage disabled. Nothing to do — the read side already refuses.
  }
}
