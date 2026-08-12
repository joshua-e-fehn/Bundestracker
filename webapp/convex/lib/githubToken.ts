/**
 * The GitHub credential the feedback publisher puts on the wire.
 *
 * Two modes, in this order of preference:
 *
 *  1. **A GitHub App installation** — `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`
 *     and `GITHUB_APP_PRIVATE_KEY`. The documented production mode. A short-lived
 *     installation token is minted on demand, so the only stored secret is the
 *     App's private key, the token on the wire expires in an hour, and issues are
 *     authored by the App rather than by a person.
 *  2. **A static token** — `GITHUB_FEEDBACK_TOKEN`. Retained because it is what
 *     the deployment may already carry and because it is what the stub-server
 *     verification in docs/verification/feedback-reporting.md drives; removing it
 *     would break a working configuration during the change that introduces the
 *     replacement, which is the one moment it must not break. It is a fallback,
 *     not the recommended path, and the documentation says so.
 *
 * `GITHUB_FEEDBACK_REPO` is required by both — a credential with nothing to
 * publish to is not a configuration.
 *
 * ## ⚠ What must never happen here
 *
 * No value read from the environment in this file may reach a return value, an
 * error message, a log line, or a stored document. `credentialFor` returns the
 * token to its immediate caller — which puts it in an `Authorization` header and
 * drops it — and every failure returns a fixed `reason` string from a closed
 * union. There is deliberately no `console` call in this file at all; a
 * `console.error(error)` on a failed mint is exactly how a private key ends up
 * in a deployment log, because the thrown error can quote its input.
 * lib/feedback-boundaries.test.ts asserts this by reading the source.
 */

import {
  appJwt,
  type CredentialProblem,
  keyFingerprint,
  readCredentials,
} from "../../lib/github-app"

/** Why no credential could be produced. Fixed strings, never a value. */
export type CredentialFailure =
  | CredentialProblem
  | "not-configured"
  | "repo-missing"
  | "repo-invalid"
  | "api-base-invalid"
  | "installation-token-refused"
  | "installation-token-unreachable"
  | "installation-token-malformed"

/**
 * `owner/name`, and nothing that can escape it.
 *
 * The value is interpolated straight into `/repos/${repo}/issues` and into the
 * `repo:` search qualifier. Unvalidated, a path traversal in the variable walks
 * out of the prefix and reaches a different endpoint entirely — `../../user/repos`
 * resolves to `https://api.github.com/user/repos/issues` — and a stray `?x=1`
 * turns the rest of the path into a query string. Nobody untrusted can set this,
 * so the realistic cause is a typo or a paste error; what makes it worth
 * checking is that every one of those failures is **silent**, producing a
 * well-formed request against the wrong resource.
 *
 * GitHub's own rules are narrower than this (no leading dot, length limits), but
 * this is the character class that matters: no slash beyond the single
 * separator, no dots that could form `..` segments *as a whole component*, no
 * `?`, `#`, `%`, or whitespace.
 */
const REPO_SHAPE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

/**
 * The configured repository, or why it is unusable.
 *
 * Checked in one place so `isPublishConfigured` and `credentialFor` cannot
 * disagree about what counts as configured — a widget that renders because the
 * repo "is set" while every publish fails on the same value is the worst of both.
 */
export function readRepo(): { repo: string } | { problem: CredentialFailure } {
  const raw = (process.env.GITHUB_FEEDBACK_REPO ?? "").trim()
  if (!raw) return { problem: "repo-missing" }
  if (!REPO_SHAPE.test(raw)) return { problem: "repo-invalid" }
  // A component of exactly `.` or `..` passes the character class above and is
  // still a traversal. Rejected explicitly rather than by a cleverer regex.
  const [owner, name] = raw.split("/")
  if ([owner, name].some((part) => part === "." || part === ".."))
    return { problem: "repo-invalid" }
  return { repo: raw }
}

/**
 * Whether `GITHUB_API_BASE` may be used.
 *
 * Unset is the normal case and means `api.github.com`. When it *is* set it
 * redirects both the issue POST and the **signed-JWT token mint**, so a
 * leftover value points a live installation-token request at whatever host it
 * names. The verification runbook tells operators to set it for stub runs,
 * which makes a stale value a documented workflow rather than a hypothetical.
 *
 * `https:` is therefore required — except for loopback, which is what a local
 * stub is and which cannot be reached from outside the deployment anyway.
 */
export function apiBaseIsAllowed(): boolean {
  return githubApiBase() !== null
}

/** GitHub's own API root, and the value a deployment that sets nothing uses. */
const DEFAULT_API_BASE = "https://api.github.com"

/**
 * The API root every outbound GitHub call must be built from, or `null` when the
 * configured one may not be used.
 *
 * ## Why this is the only reader, and why it returns null rather than a default
 *
 * `convex/feedback.ts` used to keep its own copy of this function, reading the
 * raw variable. That copy was not exploitable — every one of its callers runs
 * after `credentialFor` has already refused a disallowed base — but it held by
 * **call ordering**, which is a convention, while the same class of problem for
 * `GITHUB_FEEDBACK_REPO` was fixed by construction. A new function that called
 * the local copy without first asking for a credential, or a reordering of one
 * that does, would have reintroduced the unvalidated read with nothing to catch
 * it. One exported reader makes the guarantee structural in both variables.
 *
 * Falling back to `api.github.com` on a bad value would be worse than refusing:
 * an operator who set the variable meant to redirect these calls, and quietly
 * sending them to GitHub instead is a different wrong answer, not a recovery.
 * `null` forces every caller to have a branch for it, which is what makes the
 * refusal visible as `api-base-invalid` rather than silent.
 *
 * The trailing-slash strip stays here: it is the reason the value is normalised
 * at all, and a caller appending `/repos/…` to a base ending in `/` would
 * otherwise produce a double slash that GitHub does not route.
 */
export function githubApiBase(): string | null {
  const raw = process.env.GITHUB_API_BASE
  if (!raw) return DEFAULT_API_BASE

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  // Loopback is what a local stub is, and it cannot be reached from outside the
  // deployment — so `http:` is allowed there and nowhere else. `URL` lowercases
  // the hostname, so `LOCALHOST` matches.
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null

  return raw.replace(/\/+$/, "")
}

/**
 * A usable credential, or the reason there is none.
 *
 * Both arms declare `failure`, the success arm as `undefined`. That is what
 * makes `"failure" in credential` narrow — a union discriminated by the
 * *absence* of a property does not narrow under `in`, so the success arm would
 * otherwise keep the failure branch from typechecking at every call site.
 */
export type Credential =
  | { token: string; mode: "app" | "static"; failure?: undefined }
  | { token?: undefined; failure: CredentialFailure }

/**
 * Whether the deployment is wired up to publish at all.
 *
 * Presence only — this is called from a Convex *query* (`feedback:isConfigured`),
 * which cannot `fetch` and therefore cannot ask GitHub whether the credentials
 * are accepted. It answers "has an operator configured this", not "does it
 * work"; a configured-but-wrong credential surfaces as a `failed` report row
 * with a reason, which is where an operator can act on it.
 *
 * The App arm requires all three variables. Two out of three is a half-finished
 * setup, and treating it as configured would hide the mistake behind a form that
 * accepts reports and never publishes them.
 */
export function isPublishConfigured(): boolean {
  // The same validation `credentialFor` applies, not merely presence. A repo
  // that is set but malformed, or an API base that will be refused, means every
  // publish fails — rendering the form for that deployment would be the
  // "accepts reports and never publishes them" state this check exists to
  // prevent, arrived at by a different route.
  if ("problem" in readRepo()) return false
  if (!apiBaseIsAllowed()) return false
  const app = readCredentials({
    appId: process.env.GITHUB_APP_ID,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  })
  return "credentials" in app || Boolean(process.env.GITHUB_FEEDBACK_TOKEN)
}

/**
 * Which credential a cached token was minted under.
 *
 * All three parts, because any of them can change without the others. The cache
 * used to compare `installationId` alone, which made a **key rotation
 * invisible**: an operator responding to a suspected compromise replaces
 * `GITHUB_APP_PRIVATE_KEY` and leaves the installation the same — that is the
 * normal case, since it is the same installation — and every warm isolate went
 * on serving a token minted under the old key until the refresh margin was
 * reached, up to fifty-five minutes later. The same held for correcting a wrong
 * `GITHUB_APP_ID`.
 *
 * The key is represented by a SHA-256 of its normalized DER (`keyFingerprint`),
 * never by the key itself. Rotating to a different key changes the digest and
 * invalidates the cache; re-pasting the *same* key in another of the three
 * accepted encodings does not, because the fingerprint is taken after
 * normalization.
 */
type CacheIdentity = { appId: string; installationId: string; keyDigest: string }

/**
 * A cached installation token, or a recent failure to mint one.
 *
 * Module scope, which in Convex means "for the life of this action's isolate" —
 * shared by consecutive invocations that happen to land on the same instance and
 * lost otherwise. That is the right shape for this: it is a pure optimisation
 * over a token GitHub will re-issue on demand, so a cold isolate costs one extra
 * round-trip and nothing else. It is deliberately **not** a database row —
 * storing a live credential in a table would make every future reader of that
 * table a holder of it, and the table is not where a secret belongs.
 */
let cached: { identity: CacheIdentity; token: string; expiresAtMs: number } | null = null

/**
 * The last failed mint, so a broken credential is not retried per call.
 *
 * Without this, a misconfigured App — the exact state this module exists to
 * report — costs one outbound `POST /access_tokens` for **every** call that
 * reaches it, forever, because a failure stored nothing and the next call
 * started over. GitHub rate-limits installation-token creation, so a
 * persistently broken credential could throttle the App and take down
 * publishing for reports that had nothing wrong with them.
 *
 * Sixty seconds is short enough that an operator who fixes the variables sees
 * the fix within a minute rather than having to wait out a token lifetime, and
 * long enough that a hot loop costs one request per minute instead of one per
 * call. It is cleared outright when the credential changes, so a correction is
 * picked up immediately rather than after the floor expires.
 */
let lastFailure: { identity: CacheIdentity; failure: CredentialFailure; atMs: number } | null = null

/**
 * How long before expiry a cached token is considered spent.
 *
 * An installation token lives an hour. Five minutes of headroom means a token
 * is never handed out that could expire mid-request — publication is a POST that
 * may follow a search by some seconds, and a token that dies between them would
 * fail a report that had no other problem.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** How long a failed mint suppresses the next attempt. See `lastFailure`. */
const FAILURE_BACKOFF_MS = 60 * 1000

/** Whether two credential identities are the same one. */
function sameIdentity(a: CacheIdentity, b: CacheIdentity): boolean {
  return a.appId === b.appId && a.installationId === b.installationId && a.keyDigest === b.keyDigest
}

/**
 * Discards the cached token and any remembered failure.
 *
 * ⚠ **For tests.** It is a plain module function, not a Convex function, so
 * there is no way to call it from the CLI or the dashboard — an earlier version
 * of this comment offered it to "an operator rotating a key", which was not
 * something an operator could do.
 *
 * Rotation needs no such call now. The cache is keyed on the credential itself
 * (see `CacheIdentity`), so setting a new key invalidates it on the next
 * request; and a Convex isolate does not outlive an environment-variable change
 * for long in any case. If a deliberate flush is ever wanted from outside, this
 * should become an `internalMutation` rather than growing a second mechanism.
 */
export function resetTokenCache(): void {
  cached = null
  lastFailure = null
}

/**
 * The credential for an outbound GitHub call.
 *
 * `nowMs` is a parameter for the same reason it is one in lib/github-app.ts: the
 * cache's expiry logic is the part most worth testing, and testing it against a
 * real clock means either sleeping or asserting nothing.
 *
 * The App mode is tried whenever its variables are present, and a **failure to
 * mint does not fall back to the static token**. That is deliberate: silently
 * publishing as a different identity than the operator configured is worse than
 * not publishing, because it succeeds — the report appears, attributed to the
 * wrong account, and nothing surfaces the fact that the App is broken. A
 * deployment that has configured an App and cannot use it gets a `failed` row
 * naming the reason.
 */
export async function credentialFor(nowMs: number): Promise<Credential> {
  // Before any credential work: a value that cannot be published to makes the
  // rest moot, and it is a string comparison against an environment variable.
  const repo = readRepo()
  if ("problem" in repo) return { failure: repo.problem }
  if (!apiBaseIsAllowed()) return { failure: "api-base-invalid" }

  const app = readCredentials({
    appId: process.env.GITHUB_APP_ID,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  })

  if ("credentials" in app) {
    const identity: CacheIdentity = {
      appId: app.credentials.appId,
      installationId: app.credentials.installationId,
      keyDigest: await keyFingerprint(app.credentials.privateKeyPem),
    }

    if (
      cached &&
      sameIdentity(cached.identity, identity) &&
      cached.expiresAtMs - REFRESH_MARGIN_MS > nowMs
    ) {
      return { token: cached.token, mode: "app" }
    }

    // A credential that just failed is not retried on every call — see
    // `lastFailure`. Only for *this* identity: changing any part of the
    // credential is an operator correcting something, and must take effect now
    // rather than after the backoff.
    if (
      lastFailure &&
      sameIdentity(lastFailure.identity, identity) &&
      nowMs - lastFailure.atMs < FAILURE_BACKOFF_MS
    ) {
      return { failure: lastFailure.failure }
    }

    const minted = await mintInstallationToken(app.credentials, nowMs)
    if ("failure" in minted) {
      lastFailure = { identity, failure: minted.failure, atMs: nowMs }
      return minted
    }
    lastFailure = null
    cached = { identity, token: minted.token, expiresAtMs: minted.expiresAtMs }
    return { token: minted.token, mode: "app" }
  }

  // Only the *absence* of App configuration falls through to the static token.
  // A present-but-malformed App configuration is an operator error worth
  // reporting, not a reason to authenticate as somebody else.
  const appConfigured =
    process.env.GITHUB_APP_ID ||
    process.env.GITHUB_APP_INSTALLATION_ID ||
    process.env.GITHUB_APP_PRIVATE_KEY
  if (appConfigured) return { failure: app.problem }

  const staticToken = process.env.GITHUB_FEEDBACK_TOKEN
  if (staticToken) return { token: staticToken, mode: "static" }
  return { failure: "not-configured" }
}

/**
 * Exchanges an app JWT for an installation access token.
 *
 * `POST /app/installations/{id}/access_tokens` — the App authenticates as
 * itself with the JWT, and GitHub returns a token scoped to that installation's
 * repositories and permissions. Nothing about the request is caller-influenced:
 * the installation id comes from the environment and the JWT is signed here.
 *
 * Every failure is caught and reduced to a fixed reason. The response body is
 * never read on an error path — GitHub's error bodies can echo the request, and
 * the request carries a signed JWT.
 */
async function mintInstallationToken(
  credentials: Parameters<typeof appJwt>[0],
  nowMs: number,
): Promise<{ token: string; expiresAtMs: number } | { failure: CredentialFailure }> {
  let jwt: string
  try {
    jwt = await appJwt(credentials, nowMs)
  } catch (error) {
    // The message is one of the fixed `CredentialProblem` strings that
    // lib/github-app.ts throws; anything else is reduced rather than passed on.
    const message = error instanceof Error ? error.message : ""
    return {
      failure:
        message === "private-key-wrong-type" ? "private-key-wrong-type" : "private-key-unparseable",
    }
  }

  // Re-read rather than passed in: `credentialFor` has already refused a
  // disallowed base, so this cannot be null here — but reading it through the
  // one validated accessor means that stays true if this function is ever
  // called from somewhere else.
  const apiBase = githubApiBase()
  if (!apiBase) return { failure: "api-base-invalid" }

  try {
    const response = await fetch(
      `${apiBase}/app/installations/${credentials.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "bundestracker-feedback",
        },
      },
    )
    if (!response.ok) return { failure: "installation-token-refused" }

    const body = (await response.json()) as { token?: unknown; expires_at?: unknown }
    if (typeof body.token !== "string" || body.token.length === 0) {
      return { failure: "installation-token-malformed" }
    }
    // GitHub always sends `expires_at`, but a missing or unparseable one must
    // not produce `NaN` — which compares false against every bound and would
    // make the cache serve a token it believes is eternally fresh.
    const parsed = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN
    const expiresAtMs = Number.isFinite(parsed) ? parsed : nowMs + 60 * 60 * 1000
    return { token: body.token, expiresAtMs }
  } catch {
    return { failure: "installation-token-unreachable" }
  }
}
