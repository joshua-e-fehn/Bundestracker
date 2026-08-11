"use client"

/**
 * The browser-side collectors: what actually watches the page, and what it
 * refuses to look at.
 *
 * `lib/feedback.ts` decides what a diagnostic is *allowed* to contain. This
 * decides what is *observed at all*, which is the stronger of the two
 * protections and the reason the module exists separately. A sanitizer can only
 * remove what was collected; a collector that never reads `document.cookie` has
 * nothing to remove. Every rule below is therefore stated as an absence:
 *
 *  - the fetch/XHR wrapper reads `response.status` and never `response.body`,
 *    and it never touches `init.headers` — so an `Authorization` header is not
 *    seen, not hashed, not counted;
 *  - the click listener reads `event.target`'s tag and role and never its
 *    `value`, `textContent` or accessible name;
 *  - the key listener records that a key was pressed and never *which* key,
 *    because a keystroke log is a password log;
 *  - nothing here reads `document.cookie`, `localStorage`, `sessionStorage`,
 *    or any form control's value.
 *
 * ## One buffer, installed once, bounded forever
 *
 * The collectors run for the life of the page whether or not anyone opens the
 * report widget, because a bug that has already happened is the one worth
 * reporting — a collector that starts when the form opens has, by definition,
 * missed the thing. That makes unbounded growth the risk, so every buffer is a
 * fixed-size ring (`LIMITS` in lib/feedback.ts) and the whole session is capped
 * in bytes when it is submitted.
 *
 * ## Why patching `fetch` is acceptable here
 *
 * Monkey-patching a global is normally a smell. It is used here because the
 * alternatives do not answer the question: `PerformanceObserver` with
 * `resource` entries sees timing but not status, so it cannot tell a 500 from a
 * 200, and Convex's client does not expose a request hook. The patch is
 * installed once, delegates unconditionally, records nothing on the success
 * path beyond a status number, and rethrows the original error untouched — so
 * the app behaves identically whether it is installed or not.
 */

import {
  describeElement,
  LIMITS,
  type SafeBreadcrumb,
  type SafeDiagnostics,
  type SafeError,
  type SafeRequest,
  sanitizeError,
  sanitizeRequest,
  sanitizeUrl,
} from "@/lib/feedback"

/** A fixed-size ring. Pushes past `max` drop the oldest entry. */
class Ring<T> {
  private items: T[] = []
  constructor(private readonly max: number) {}
  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max)
  }
  all(): T[] {
    return [...this.items]
  }
  clear(): void {
    this.items = []
  }
}

/** When the collectors were installed. Every `atMs` is relative to this, so
 * nothing recorded is a wall-clock timestamp — see `SafeError.atMs`. */
let sessionStart = 0

const errors = new Ring<SafeError>(LIMITS.errors)
const requests = new Ring<SafeRequest>(LIMITS.requests)
const breadcrumbs = new Ring<SafeBreadcrumb>(LIMITS.breadcrumbs)

let installed = false

function since(): number {
  return Math.max(0, Math.round(performance.now() - sessionStart))
}

/**
 * Installs every collector. Idempotent, and safe to call from an effect in
 * more than one component.
 *
 * Returns a teardown for symmetry with React's effect contract, but the
 * intended lifetime is the page: tearing down would mean a bug happening
 * between two mounts is invisible.
 */
export function installDiagnostics(): () => void {
  if (installed || typeof window === "undefined") return () => {}
  installed = true
  sessionStart = performance.now()

  // --- uncaught errors ----------------------------------------------------

  const onError = (event: ErrorEvent) => {
    errors.push(
      sanitizeError({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : null,
        url: window.location.href,
        atMs: since(),
      }),
    )
  }

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason
    errors.push(
      sanitizeError({
        // A rejection reason is any value. `String()` on a plain object gives
        // "[object Object]", which is useless but harmless — and far better
        // than `JSON.stringify`, which would serialise an arbitrary object
        // graph that may hold anything at all.
        message:
          reason instanceof Error ? reason.message : `Unhandled rejection: ${String(reason)}`,
        stack: reason instanceof Error ? reason.stack : null,
        url: window.location.href,
        atMs: since(),
      }),
    )
  }

  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)

  // --- failed requests ----------------------------------------------------

  const originalFetch = window.fetch
  // Typed as the bare call signature rather than `typeof window.fetch`: the DOM
  // lib declares `fetch` with a `preconnect` static hanging off it, which an
  // arrow function cannot satisfy. The static is copied across below, so the
  // installed global keeps the full shape at runtime — this annotation is only
  // about what the literal itself has to prove.
  const patchedFetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const started = performance.now()
    // `init.headers` is deliberately never read. The method comes from `init`
    // or the Request, both of which are enums-in-practice.
    const method =
      (typeof init?.method === "string" ? init.method : undefined) ??
      (input instanceof Request ? input.method : "GET")
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : String(input)
    try {
      const response = await originalFetch(input, init)
      // Only failures are recorded. A successful request is not a diagnostic,
      // and recording every one would turn the buffer into a browsing history.
      if (!response.ok) {
        requests.push(
          sanitizeRequest({
            method,
            url,
            // `.status` only. The body is never read — reading it would also
            // consume the stream and break the app.
            status: response.status,
            durationMs: performance.now() - started,
            atMs: since(),
          }),
        )
      }
      return response
    } catch (error) {
      requests.push(
        sanitizeRequest({
          method,
          url,
          // No response at all: DNS failure, offline, CORS rejection, abort.
          status: null,
          durationMs: performance.now() - started,
          atMs: since(),
        }),
      )
      // Rethrown untouched: the app's own error handling must see exactly what
      // it would have seen without this wrapper.
      throw error
    }
  }
  // Carry over anything hanging off the original (`fetch.preconnect` in current
  // DOM lib versions) so replacing the global does not remove capability from
  // the page. `Object.assign` rather than naming the property, because the set
  // is browser-dependent and this must not need editing when it grows.
  window.fetch = Object.assign(patchedFetch, originalFetch) as typeof window.fetch

  // --- breadcrumbs --------------------------------------------------------

  const onClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    breadcrumbs.push({
      kind: "click",
      // Shape only. See `describeElement` for why the accessible name is
      // excluded even though it would be more useful.
      target: describeElement(target),
      atMs: since(),
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // ⚠ `event.key` is never recorded — that is a keylogger. Only the fact
    // that typing happened, and into what kind of element, which is enough to
    // reconstruct "was typing in the search box when it froze".
    const target = event.target
    breadcrumbs.push({
      kind: "keydown",
      target: target instanceof Element ? describeElement(target) : "unknown",
      atMs: since(),
    })
  }

  let lastPath = window.location.pathname
  const onNavigate = () => {
    if (window.location.pathname === lastPath) return
    lastPath = window.location.pathname
    breadcrumbs.push({
      kind: "navigate",
      // The sanitized URL, so a route change cannot smuggle a query string in
      // through the breadcrumb trail.
      target: sanitizeUrl(window.location.href) ?? "unknown",
      atMs: since(),
    })
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  const onResize = () => {
    // Debounced: a drag-resize fires continuously and would flush the ring.
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      breadcrumbs.push({
        kind: "resize",
        target: `${window.innerWidth}×${window.innerHeight}`,
        atMs: since(),
      })
    }, 300)
  }

  // `capture: true` so a breadcrumb is recorded even when a handler below
  // stops propagation — which the sheet and dropdown primitives both do.
  window.addEventListener("click", onClick, { capture: true, passive: true })
  window.addEventListener("keydown", onKeyDown, { capture: true, passive: true })
  window.addEventListener("popstate", onNavigate)
  window.addEventListener("resize", onResize, { passive: true })
  // App Router navigations do not fire `popstate`, so the path is also checked
  // on every click — cheap, and it catches a `<Link>` push.
  window.addEventListener("click", onNavigate, { capture: true, passive: true })

  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
    window.removeEventListener("click", onClick, { capture: true })
    window.removeEventListener("keydown", onKeyDown, { capture: true })
    window.removeEventListener("click", onNavigate, { capture: true })
    window.removeEventListener("popstate", onNavigate)
    window.removeEventListener("resize", onResize)
    clearTimeout(resizeTimer)
    // Only restore if nothing else patched over us in the meantime; clobbering
    // a later wrapper would be worse than leaving ours in place.
    if (window.fetch === patchedFetch) window.fetch = originalFetch
    installed = false
  }
}

/** The build this page was served from, when the deployment exposes one.
 * Vercel sets `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`; a local build has none, and
 * null is the honest answer rather than a fabricated "dev". */
function appVersion(): string | null {
  const sha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  return sha ? sha.slice(0, 12) : null
}

/**
 * A snapshot of everything collected so far, sanitized and bounded.
 *
 * Takes the two facts it cannot observe — the app's display language and
 * whether the reader is signed in — as arguments rather than reading them from
 * a store, so this module stays free of React and can be unit-tested.
 */
export function collectDiagnostics(input: { locale: string; signedIn: boolean }): SafeDiagnostics {
  const resolvedScheme =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light"
  return {
    environment: {
      userAgent:
        typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, LIMITS.userAgent),
      viewport: {
        width: typeof window === "undefined" ? 0 : window.innerWidth,
        height: typeof window === "undefined" ? 0 : window.innerHeight,
      },
      devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
      locale: input.locale,
      colorScheme: resolvedScheme,
      timeZone: safeTimeZone(),
      signedIn: input.signedIn,
      appVersion: appVersion(),
    },
    errors: errors.all(),
    requests: requests.all(),
    breadcrumbs: breadcrumbs.all(),
  }
}

function safeTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown"
  } catch {
    return "unknown"
  }
}

/** The current page, sanitized. Exposed here so the widget has one import for
 * everything it collects. */
export function currentPageUrl(): string | null {
  if (typeof window === "undefined") return null
  return sanitizeUrl(window.location.href)
}

/** Drops everything collected. Called after a successful submission so a second
 * report in the same session does not re-send the first one's errors. */
export function clearDiagnostics(): void {
  errors.clear()
  requests.clear()
  breadcrumbs.clear()
}

// --- the anonymous client key --------------------------------------------

/** Where the anonymous rate-limit key lives. Not a cookie: a cookie is sent on
 * every request to this origin, and this value has no business travelling with
 * anything but a report. See the `clientKey` note in convex/schema.ts for what
 * it does and does not stop. */
const CLIENT_KEY_STORAGE = "bundestrack.feedback.client"

/**
 * A stable random identifier for this browser.
 *
 * Created on first use and reused after. Deliberately random rather than
 * derived from anything about the device: a fingerprint would be both more
 * effective as a limiter and a tracking identifier, which is not a trade this
 * feature is entitled to make on a reader's behalf.
 *
 * Lives here rather than in the widget because it is not rendering. It reads
 * and writes `localStorage`, mints a UUID, and decides what this browser is
 * called to three separate backend functions — a browser-side *capability*,
 * which is what this module holds, sitting beside the collectors that answer
 * the same kind of question. A component that owns identity storage is a
 * component that has to be mounted before anything else can ask.
 *
 * ⚠ The one thing this module does that no other collector does: it **writes**
 * to `localStorage`. That is deliberate and is why `lib/feedback-boundaries.test.ts`
 * scopes its "no storage access" assertion to the collectors above rather than
 * to the file — a rule about what is *read* from the reader's browser, not
 * about a key this feature mints for itself.
 */
export function clientKey(): string {
  if (typeof window === "undefined") return "server"
  try {
    const existing = window.localStorage.getItem(CLIENT_KEY_STORAGE)
    if (existing) return existing
    const minted = crypto.randomUUID()
    window.localStorage.setItem(CLIENT_KEY_STORAGE, minted)
    return minted
  } catch {
    // Private mode, or storage disabled. A per-session key still bounds a
    // runaway loop, and the deployment cap covers the rest.
    return "ephemeral"
  }
}
