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

import { appJwt, type CredentialProblem, readCredentials } from "../../lib/github-app"

/** Why no credential could be produced. Fixed strings, never a value. */
export type CredentialFailure =
  | CredentialProblem
  | "not-configured"
  | "installation-token-refused"
  | "installation-token-unreachable"
  | "installation-token-malformed"

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
  if (!process.env.GITHUB_FEEDBACK_REPO) return false
  const app = readCredentials({
    appId: process.env.GITHUB_APP_ID,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  })
  return "credentials" in app || Boolean(process.env.GITHUB_FEEDBACK_TOKEN)
}

/**
 * A cached installation token.
 *
 * Module scope, which in Convex means "for the life of this action's isolate" —
 * shared by consecutive invocations that happen to land on the same instance and
 * lost otherwise. That is the right shape for this: it is a pure optimisation
 * over a token GitHub will re-issue on demand, so a cold isolate costs one extra
 * round-trip and nothing else. It is deliberately **not** a database row —
 * storing a live credential in a table would make every future reader of that
 * table a holder of it, and the table is not where a secret belongs.
 */
let cached: { token: string; expiresAtMs: number; installationId: string } | null = null

/**
 * How long before expiry a cached token is considered spent.
 *
 * An installation token lives an hour. Five minutes of headroom means a token
 * is never handed out that could expire mid-request — publication is a POST that
 * may follow a search by some seconds, and a token that dies between them would
 * fail a report that had no other problem.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** Discards any cached token. For tests, and for an operator rotating a key
 * without waiting out the hour. */
export function resetTokenCache(): void {
  cached = null
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
  const app = readCredentials({
    appId: process.env.GITHUB_APP_ID,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  })

  if ("credentials" in app) {
    if (
      cached &&
      cached.installationId === app.credentials.installationId &&
      cached.expiresAtMs - REFRESH_MARGIN_MS > nowMs
    ) {
      return { token: cached.token, mode: "app" }
    }
    const minted = await mintInstallationToken(app.credentials, nowMs)
    if ("failure" in minted) return minted
    cached = {
      token: minted.token,
      expiresAtMs: minted.expiresAtMs,
      installationId: app.credentials.installationId,
    }
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

  try {
    const response = await fetch(
      `${githubApiBase()}/app/installations/${credentials.installationId}/access_tokens`,
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

/**
 * The GitHub API root.
 *
 * Duplicated from convex/feedback.ts rather than imported, because importing it
 * would make that module and this one mutually dependent for one line. Kept
 * byte-identical deliberately; `lib/feedback-boundaries.test.ts` asserts the two
 * agree, so a change to either that leaves the other behind fails a test rather
 * than silently pointing the token mint at a different host from the calls it
 * authenticates.
 */
function githubApiBase(): string {
  return (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/+$/, "")
}
