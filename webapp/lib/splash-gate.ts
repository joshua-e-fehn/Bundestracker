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
}

/** The `sessionStorage` key. Namespaced like `bundestrack.locale` in
 * components/providers/locale-provider.tsx, so the two are recognisably one
 * app's keys rather than two habits. */
export const SPLASH_SESSION_KEY = "bundestrack.protokoll.splash"

/** Whether to run the opening animation. */
export function shouldRunSplash(environment: SplashEnvironment): boolean {
  if (environment.reduceMotion === true) return false
  if (environment.saveData === true) return false
  if (environment.alreadySeen === true) return false
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
  }
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
