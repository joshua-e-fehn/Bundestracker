/**
 * What a bug report is allowed to say, decided once and shared by every caller.
 *
 * This module is the privacy boundary of the feedback feature. Everything else
 * — the widget, the Convex mutation, the GitHub action — is plumbing around the
 * rules here, and the rules are pure functions so they can be tested without a
 * DOM, without a deployment and without a network. That is the point: the
 * failure mode of a diagnostics collector is not a crash, it is a report that
 * quietly carries a reader's session token into a public issue tracker, and
 * nothing about the page looks wrong while it happens.
 *
 * ## The rule is an allowlist, and it is scoped to this app's own URL space
 *
 * Every function below names the fields it keeps and drops the rest. Not one of
 * them names fields to *remove*, because a denylist is a promise about a set
 * that grows: the day a new query parameter, a new header or a new Error
 * subclass appears, a denylist silently starts passing it through and no test
 * fails. `sanitizeError` keeps a message it has already stripped URLs out of;
 * `describeElement` keeps a tag name and a role. Anything unrecognised does not
 * survive.
 *
 * ⚠ For URLs the allowlist governs the query **and only on first-party URLs**.
 * This paragraph used to say "everywhere, without exception", which was false
 * and was load-bearing in the wrong direction — the path was reconstructed
 * wholesale for every origin, and the collectors record failed requests to
 * *third-party* servers, where a path segment is an ordinary place to keep a
 * secret. A foreign URL is now reduced to its origin; see `sanitizeUrl`.
 *
 * ## What is never collected, at any layer
 *
 * Cookies, `localStorage` / `sessionStorage`, `Authorization` headers, request
 * and response bodies, form-field values, and raw URL query/hash data. There is
 * no code path that reads any of them — not a redacted one, not a hashed one.
 * The safest handling of a secret is not to hold it, so the collectors in
 * lib/diagnostics.ts never touch those surfaces at all and these functions are
 * the second line rather than the first.
 *
 * ## Why the sanitizers live here and not beside their collectors
 *
 * Because the same rule has three callers at three trust levels — the browser
 * that collects, the Convex mutation that stores, and the action that publishes
 * — and a rule applied at only one of them is a rule an attacker chooses not to
 * go through. `convex/feedback.ts` re-runs `sanitizeUrl` on values the client
 * already sanitised, on the assumption that the client is a hostile,
 * hand-written HTTP request rather than this app's own widget. Sharing the
 * function is what makes "re-run it on the server" cheap enough to actually do.
 */

// --- limits ---------------------------------------------------------------

/**
 * Ceilings on everything a stranger can type or cause to be recorded.
 *
 * These are bounds on *storage*, so they are stated here rather than in the
 * Convex validators alone: a validator rejects an oversized field, which is the
 * right answer for a hand-written request but the wrong one for a reader whose
 * console happened to log a 40 kB stack trace. Truncation is applied first, at
 * the edge, and the validator's own limit sits above it as the backstop for a
 * caller that skipped the edge.
 */
export const LIMITS = {
  /** A title is a subject line. Longer than this is a description. */
  title: 120,
  /** Long enough for a reproduction with steps; short enough that the whole
   * body renders in a GitHub issue without a scrollbar. */
  description: 4000,
  /** An email address. RFC 5321 puts the practical maximum at 254. */
  contact: 254,
  /** One error message, after URL stripping. */
  errorMessage: 300,
  /** Stack frames kept per error. Enough to name the failing component and its
   * two callers, which is what makes a report actionable; not the whole tree. */
  stackFrames: 8,
  /** One stack frame line. */
  stackFrame: 200,
  /** Errors kept. The interesting one is almost always the first, and a
   * render loop can produce thousands. */
  errors: 10,
  /** Failed requests kept. */
  requests: 10,
  /** Interaction breadcrumbs kept — the ring buffer's size. */
  breadcrumbs: 20,
  /** One breadcrumb's rendered description. */
  breadcrumb: 120,
  /** A sanitized URL, after the query has been reduced to known keys. */
  url: 300,
  /** `navigator.userAgent`. */
  userAgent: 350,
  /** The screenshot, as stored bytes. A 1280-wide WebP of a dense page lands
   * around 120 kB; 1.5 MB is generous enough for a 4K display and small enough
   * that a thousand of them is not a storage bill. */
  screenshotBytes: 1_500_000,
} as const

/** Truncates to `max`, marking that it happened. An unmarked truncation reads
 * as a complete value that happens to end oddly, which is how a half-URL gets
 * treated as the whole URL by whoever reads the issue. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

// --- URLs -----------------------------------------------------------------

/**
 * The query parameters a Bundestrack URL is allowed to carry into a report.
 *
 * An allowlist of *this app's own* navigation state, not a filter over what a
 * URL might hold. These six are the parameters the site itself puts in the bar
 * — the period selector, the roster filters, the search box — and they are what
 * make a bug report reproducible: "the rankings page" is not a reproduction,
 * "`/rankings?wp=20&metric=speeches`" is.
 *
 * ⚠ `q` is the search *query*, which is text a reader typed. It is kept
 * deliberately and it is the one judgement call in this file. The reasoning:
 * on this site the search box takes a politician's name, a policy topic or a
 * profession — it is the primary way the product is used, a search that returns
 * nothing is the single most likely thing to be reported, and the term is
 * already in the URL the reader is looking at. It is *not* a free-text field
 * that has ever held a credential, and the site has no such field. If one is
 * ever added, it must not be added to this list.
 *
 * Everything else — `token`, `code`, `state`, `session`, an OAuth callback's
 * whole payload — is dropped by not being named here, which is why this is a
 * list of six strings and not a regex for things that look like secrets.
 */
export const ALLOWED_QUERY_KEYS = ["wp", "metric", "month", "fraktion", "land", "q"] as const

/** Query keys whose *value* is dropped while their presence is kept. None
 * today; the mechanism exists so a future parameter can be reported as
 * "present" without its content. */
const VALUE_REDACTED_QUERY_KEYS: readonly string[] = []

/**
 * Whether a URL belongs to this app.
 *
 * The distinction matters because `sanitizeUrl`'s allowlist was written for
 * *this site's* URL space — six known navigation parameters, and a path built
 * from route segments that are public identifiers. Neither claim holds for
 * somebody else's server.
 *
 * ## ⚠ Two variables, because this module runs in two runtimes
 *
 * `sanitizeUrl` is deliberately re-run on the server (convex/feedback.ts), on
 * the assumption that the caller skipped the browser. So `isFirstParty` has to
 * answer the same question in the **Convex** runtime as in the browser — and
 * `NEXT_PUBLIC_SITE_URL` alone cannot, because it is a Next.js *build-time*
 * variable inlined into the browser bundle and set on Vercel. It does not exist
 * on the Convex deployment.
 *
 * Reading only that name therefore classified the app's own URL as foreign on
 * every server-side pass, and the second pass is the one whose output is stored
 * and published: every report lost its path and its allowlisted query — the
 * difference `ALLOWED_QUERY_KEYS` itself calls "a reproduction" versus "not a
 * reproduction". It failed safe (over-redaction, never a leak) and it failed
 * silently, and no test saw it because the suite set the browser variable and
 * localhost is matched in development regardless.
 *
 * `SITE_URL` is the same origin under the name the **Convex** deployment
 * already carries it: Better Auth requires it, `.env.example` documents it as
 * "the real deployed origin in production", and `betterAuth/auth.ts` uses it as
 * the trusted CORS origin. Consulting both is what makes one rule hold in both
 * places.
 *
 * Both absent still means "treat everything as foreign" — the conservative
 * direction, and now a configuration error rather than the default state.
 */
export function firstPartyOrigins(): string[] {
  return [process.env.NEXT_PUBLIC_SITE_URL, process.env.SITE_URL].filter((value): value is string =>
    Boolean(value),
  )
}

function isFirstParty(url: URL): boolean {
  for (const configured of firstPartyOrigins()) {
    try {
      if (url.origin === new URL(configured).origin) return true
    } catch {
      // A malformed variable is not a reason to trust a foreign origin.
    }
  }
  // Localhost, so a development report is not reduced to an origin and made
  // useless. Never a wildcard: a hostname *containing* "localhost" is not it.
  return url.hostname === "localhost" || url.hostname === "127.0.0.1"
}

/**
 * A URL reduced to what is safe to publish.
 *
 * ## First-party: origin, path, and the allowlisted query
 *
 * The hash is dropped **entirely and always**. On this site a fragment is an
 * anchor (`#contact`, `#data`), which is worth nothing in a report, and the
 * fragment is also where OAuth implicit-flow tokens live in the general case.
 * Trading a jump-link for a class of credential leak is not a close call.
 *
 * Credentials in the authority component (`https://user:pass@host`) are
 * stripped — `URL` parses them into their own fields, so reassembling from
 * `origin` drops them by construction rather than by a rule to remember.
 *
 * ## Foreign: the origin, and nothing else
 *
 * ⚠ This is the part that used to be wrong, and the module header used to claim
 * otherwise: the path was reconstructed wholesale for *every* origin. That is
 * fine for `/mps/bt-0007`, whose segments are public identifiers — and not fine
 * at all for somebody else's server, where a path segment is a perfectly normal
 * place to put a secret (`/v1/session/<token>`, `/reset/<nonce>`, the signature
 * component of a pre-signed URL).
 *
 * It matters because these URLs are not hypothetical. The fetch wrapper in
 * lib/diagnostics.ts records **every failed request**, third-party ones
 * included, and `issueBody` publishes `requests[].url` into a public GitHub
 * issue. So a foreign URL keeps its origin — which is the whole diagnostic
 * value, "the call to api.example.com failed" — and loses the path and the
 * query. The `?q=` judgement call in `ALLOWED_QUERY_KEYS` was reasoned about
 * for this site's search box, and stops applying here for the same reason.
 *
 * A string that does not parse returns `null` rather than being passed through:
 * an unparseable URL is not something to publish on the theory that it is
 * probably harmless.
 */
export function sanitizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  // Anything that is not the web. `javascript:` and `data:` carry their whole
  // payload in the URL, and a `file:` path names the reader's disk.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null

  if (!isFirstParty(url)) {
    // The ellipsis says "there was more here", so a maintainer reading the
    // issue does not take the bare origin for the whole URL.
    return truncate(`${url.origin}/…`, LIMITS.url)
  }

  const kept = new URLSearchParams()
  for (const key of ALLOWED_QUERY_KEYS) {
    const value = url.searchParams.get(key)
    if (value === null) continue
    kept.set(key, VALUE_REDACTED_QUERY_KEYS.includes(key) ? "[redacted]" : value)
  }

  const query = kept.toString()
  // `origin` + `pathname`, never `href`: `href` carries the hash and the full
  // query, which is the thing this function exists to remove.
  const base = `${url.origin}${url.pathname}`
  return truncate(query ? `${base}?${query}` : base, LIMITS.url)
}

/**
 * Replaces every URL inside a free-text string with its sanitized form.
 *
 * The case this exists for: an Error message is free text that routinely embeds
 * a URL — `Failed to fetch https://api.example.com/x?token=abc` is the shape of
 * a hundred library errors — so sanitising the *fields* of a diagnostic while
 * publishing its message verbatim would leave the leak open in the one place
 * nobody inspects.
 *
 * A URL that fails `sanitizeUrl` is replaced with a marker rather than left in
 * place. Leaving it would defeat the function for exactly the inputs that most
 * deserve it.
 */
export function stripUrlsFromText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>()[\]]+/gi, (match) => {
    // Trailing punctuation belongs to the sentence, not the URL.
    const trimmed = match.replace(/[.,;:!?]+$/, "")
    const suffix = match.slice(trimmed.length)
    return `${sanitizeUrl(trimmed) ?? "[url]"}${suffix}`
  })
}

// --- errors ---------------------------------------------------------------

/** One captured application error, after sanitisation. */
export type SafeError = {
  /** The error's message, URL-stripped and truncated. */
  message: string
  /** Frames, innermost first: function name and sanitized location only. */
  stack: string[]
  /** Sanitized URL of the page the error happened on. */
  url: string | null
  /** Milliseconds since the report's session began — a relative offset, not a
   * wall clock, so nothing here is a timestamp that could be correlated
   * against server logs to re-identify an anonymous reporter. */
  atMs: number
}

/**
 * A stack frame reduced to "what code, in what file, at what line".
 *
 * Stack frames from a source-mapped Next.js build carry the bundle URL, which
 * on a preview deployment is a long path with a build hash and, in some
 * loaders, a query string. `sanitizeUrl` handles the query; this keeps the rest
 * short enough that eight frames do not dwarf the reader's own description.
 *
 * V8 and SpiderMonkey disagree about the shape (`at fn (url:1:2)` vs
 * `fn@url:1:2`), so this deliberately does not try to parse into fields. It
 * strips URLs wherever they appear and truncates, which is correct for both and
 * for whatever a third engine does.
 */
function sanitizeFrame(frame: string): string {
  return truncate(stripUrlsFromText(frame.trim()), LIMITS.stackFrame)
}

/**
 * An error reduced to what a maintainer can act on.
 *
 * ## Why the message is kept at all
 *
 * Dropping it entirely was the safer option and was rejected. An error without
 * its message is `Error` plus a line number in a minified bundle, which does not
 * survive the next deploy — the report becomes unactionable, which is the whole
 * reason the feature exists. The message is what names the failing invariant
 * ("Cannot read properties of null (reading 'fraktion')"), and on this site the
 * errors that reach a reader come from React, Convex and the app's own throws,
 * none of which interpolate reader input.
 *
 * What is *not* kept is the part of a message that can be attacker- or
 * reader-controlled without bound: embedded URLs are sanitized by
 * `stripUrlsFromText`, and the whole thing is capped. That is the compromise —
 * bounded, URL-free text, rather than all-or-nothing.
 */
export function sanitizeError(input: {
  message?: string | null
  stack?: string | null
  url?: string | null
  atMs?: number | null
}): SafeError {
  const message = truncate(
    stripUrlsFromText(String(input.message ?? "").trim()) || "Unknown error",
    LIMITS.errorMessage,
  )
  const stack = String(input.stack ?? "")
    .split("\n")
    // Keeps frames, drops the message line a V8 stack opens with — it is
    // already kept above, and repeating it wastes one of the eight.
    //
    // Both spellings, and both *states*: a raw V8 frame arrives indented
    // (`    at fn (…)`) while a frame this function has already produced has
    // been trimmed (`at fn (…)`). Anchoring on `^\s*at\s` rather than on `\s at`
    // matches both, which is what makes `sanitizeError` idempotent over its own
    // output — convex/feedback.ts runs it a second time on data the browser
    // already sanitized, and a filter that only matched raw stacks would
    // silently drop every frame on that second pass.
    .filter((line) => /^\s*at\s/.test(line) || line.includes("@"))
    .slice(0, LIMITS.stackFrames)
    .map(sanitizeFrame)
    .filter(Boolean)
  return {
    message,
    stack,
    url: sanitizeUrl(input.url),
    atMs: Math.max(0, Math.round(Number(input.atMs ?? 0)) || 0),
  }
}

// --- failed requests ------------------------------------------------------

/** One failed network request, after sanitisation. Metadata only — there is no
 * field here for a request or response body, by construction. */
export type SafeRequest = {
  method: string
  url: string | null
  /** HTTP status, or null when the request never got one (DNS, offline, CORS,
   * abort). Null is the interesting case: it distinguishes "the server said no"
   * from "the request never arrived", which are different bugs. */
  status: number | null
  durationMs: number
  atMs: number
}

/** The methods worth recording, spelled out so a hand-written request cannot
 * put arbitrary text in this field. Anything else is recorded as `OTHER`. */
const KNOWN_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

/**
 * A failed request reduced to metadata.
 *
 * Bodies are absent from the type, so there is no field to fill in later
 * without a schema change that a reviewer would see. Headers likewise: the
 * requirement names `Authorization` specifically, and the way to guarantee an
 * `Authorization` header is never recorded is to have nowhere to put any header
 * at all.
 *
 * The URL goes through `sanitizeUrl`, which matters more here than anywhere
 * else — an API URL is exactly where a token appears as a query parameter, and
 * this app's own Convex endpoints are called with query strings.
 */
export function sanitizeRequest(input: {
  method?: string | null
  url?: string | null
  status?: number | null
  durationMs?: number | null
  atMs?: number | null
}): SafeRequest {
  const method = String(input.method ?? "").toUpperCase()
  const status = Number(input.status)
  return {
    method: KNOWN_METHODS.includes(method) ? method : "OTHER",
    url: sanitizeUrl(input.url),
    // A status outside the HTTP range is not a status. `0` in particular is
    // what XHR reports for a network failure, and it must read as "no
    // response" rather than as a status code.
    status: Number.isFinite(status) && status >= 100 && status <= 599 ? Math.round(status) : null,
    durationMs: Math.max(0, Math.round(Number(input.durationMs ?? 0)) || 0),
    atMs: Math.max(0, Math.round(Number(input.atMs ?? 0)) || 0),
  }
}

// --- interaction breadcrumbs ---------------------------------------------

/** One recorded interaction. A shape, never a content. */
export type SafeBreadcrumb = {
  /** What happened: a click, a route change, a viewport resize. */
  kind: "click" | "keydown" | "navigate" | "resize"
  /** What it happened to, as a structural description — see `describeElement`. */
  target: string
  atMs: number
}

/**
 * Describes an element by its *shape*, never by its content.
 *
 * The rule, stated so a test can assert it: the output is built from the tag
 * name, an explicit `data-feedback-id`, the ARIA role, and the element's own
 * `type`. It never reads `textContent`, `value`, `placeholder`, `title`,
 * `alt`, or `aria-label`.
 *
 * ⚠ `aria-label` is the interesting exclusion, because it is the obvious field
 * to reach for and is what most breadcrumb libraries use. It is excluded here
 * because on this site an accessible name is routinely a person's name — every
 * MP card, every follow button, every seat in the hemicycle — and a breadcrumb
 * trail reading "clicked: Follow Anna Beispiel" turns a bug report into a
 * record of who a reader was looking at. That the name is public data does not
 * make the *reader's browsing* public data.
 *
 * `data-feedback-id` is the escape hatch: a component that wants to be
 * identifiable in a breadcrumb opts in with a hand-written, content-free id.
 * That keeps the useful half of labels without the leak, and it is an
 * allowlist — an element that has not opted in gets its tag and role only.
 */
export function describeElement(el: {
  tagName?: string | null
  getAttribute?: (name: string) => string | null
}): string {
  const tag = String(el.tagName ?? "unknown").toLowerCase()
  const attr = (name: string): string | null => {
    try {
      return el.getAttribute?.(name) ?? null
    } catch {
      return null
    }
  }
  // Hand-written, content-free, and constrained to an identifier shape so an
  // attribute holding interpolated content cannot ride out through here.
  const id = attr("data-feedback-id")
  const safeId = id && /^[a-z0-9:_-]{1,40}$/i.test(id) ? id : null
  const role = attr("role")
  const safeRole = role && /^[a-z]{1,20}$/i.test(role) ? role : null
  const type = tag === "input" || tag === "button" ? attr("type") : null
  const safeType = type && /^[a-z]{1,15}$/i.test(type) ? type : null

  const parts = [tag]
  if (safeType) parts.push(`[${safeType}]`)
  if (safeRole) parts.push(`role=${safeRole}`)
  if (safeId) parts.push(`#${safeId}`)
  return truncate(parts.join(" "), LIMITS.breadcrumb)
}

/** Coerces a breadcrumb from the wire into the shape above, dropping an
 * unrecognised `kind` rather than storing free text. */
export function sanitizeBreadcrumb(input: {
  kind?: string | null
  target?: string | null
  atMs?: number | null
}): SafeBreadcrumb | null {
  const kind = String(input.kind ?? "")
  if (kind !== "click" && kind !== "keydown" && kind !== "navigate" && kind !== "resize") {
    return null
  }
  return {
    kind,
    target: truncate(stripUrlsFromText(String(input.target ?? "")), LIMITS.breadcrumb),
    atMs: Math.max(0, Math.round(Number(input.atMs ?? 0)) || 0),
  }
}

// --- environment ----------------------------------------------------------

/** The browser/app environment, as a fixed set of fields. */
export type SafeEnvironment = {
  userAgent: string
  /** CSS pixels. Fingerprinting-adjacent, and kept anyway: a layout bug that
   * only happens at 320 px is unreproducible without it. */
  viewport: { width: number; height: number }
  devicePixelRatio: number
  /** The app's own display language, not `navigator.languages` — the app
   * setting is what decides which strings rendered, and the full language list
   * is one of the strongest passive fingerprinting surfaces there is. */
  locale: string
  /** "light" or "dark" — the resolved theme, since several reported bugs are
   * contrast bugs in one theme only. */
  colorScheme: string
  /** IANA zone name. */
  timeZone: string
  /** Whether the reporter was signed in. A boolean, never an identity: it
   * separates "broken for everyone" from "broken for signed-in readers", which
   * is the only thing a maintainer needs. */
  signedIn: boolean
  /** The app build this happened on, when the deployment exposes one. */
  appVersion: string | null
}

const COLOR_SCHEMES = ["light", "dark"]

/** Coerces an environment block from the wire. Every field is clamped or
 * matched against a known set; nothing is passed through as free text except
 * the user agent, which is truncated. */
export function sanitizeEnvironment(input: {
  userAgent?: string | null
  viewport?: { width?: number | null; height?: number | null } | null
  devicePixelRatio?: number | null
  locale?: string | null
  colorScheme?: string | null
  timeZone?: string | null
  signedIn?: boolean | null
  appVersion?: string | null
}): SafeEnvironment {
  const clampPx = (value: unknown): number => {
    const n = Math.round(Number(value))
    return Number.isFinite(n) ? Math.max(0, Math.min(20000, n)) : 0
  }
  const dpr = Number(input.devicePixelRatio)
  const colorScheme = String(input.colorScheme ?? "")
  const locale = String(input.locale ?? "")
  const timeZone = String(input.timeZone ?? "")
  return {
    userAgent: truncate(String(input.userAgent ?? "").trim(), LIMITS.userAgent),
    viewport: {
      width: clampPx(input.viewport?.width),
      height: clampPx(input.viewport?.height),
    },
    devicePixelRatio: Number.isFinite(dpr)
      ? Math.max(0.5, Math.min(5, Math.round(dpr * 100) / 100))
      : 1,
    locale: /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale) ? locale : "unknown",
    colorScheme: COLOR_SCHEMES.includes(colorScheme) ? colorScheme : "unknown",
    // An IANA zone name, matched by shape. Free text here would be a small
    // injection surface in a Markdown issue body.
    timeZone: /^[A-Za-z][A-Za-z0-9+\-_]*(\/[A-Za-z0-9+\-_]+)*$/.test(timeZone)
      ? truncate(timeZone, 60)
      : "unknown",
    signedIn: input.signedIn === true,
    appVersion: input.appVersion ? truncate(String(input.appVersion), 60) : null,
  }
}

// --- the report -----------------------------------------------------------

/** What kind of report this is. Drives the GitHub label and the form's copy. */
export const FEEDBACK_KINDS = ["bug", "feature", "data", "other"] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value)
}

/** The diagnostics half of a report — everything collected rather than typed. */
export type SafeDiagnostics = {
  environment: SafeEnvironment
  errors: SafeError[]
  requests: SafeRequest[]
  breadcrumbs: SafeBreadcrumb[]
}

/**
 * Whether a typed report is submittable, and why not.
 *
 * Returns the *reason* rather than a boolean so the form can name the field —
 * a disabled submit button with no explanation is the accessibility failure
 * this avoids, and the same rule runs on the server where the reason becomes
 * the 400.
 */
export type ValidationError =
  | "title-missing"
  | "title-too-long"
  | "description-too-long"
  | "contact-invalid"

/**
 * A contact address, if it is one.
 *
 * Deliberately a shape check and not an RFC 5322 parser: the address is never
 * validated by sending to it, it is optional, and the only thing that matters
 * is that a value which cannot possibly be an address is rejected rather than
 * stored. Over-strict rejection of an exotic-but-legal address costs a reporter
 * nothing — the field is optional and the report goes through without it.
 */
export function isPlausibleEmail(value: string): boolean {
  if (value.length > LIMITS.contact) return false
  return /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/.test(value)
}

/** Validates the typed half of a report. Diagnostics are not validated here:
 * they are *sanitized*, which cannot fail. */
export function validateReport(input: {
  title: string
  description: string
  contact: string
}): ValidationError | null {
  const title = input.title.trim()
  if (title.length < 3) return "title-missing"
  if (title.length > LIMITS.title) return "title-too-long"
  if (input.description.length > LIMITS.description) return "description-too-long"
  const contact = input.contact.trim()
  if (contact && !isPlausibleEmail(contact)) return "contact-invalid"
  return null
}
