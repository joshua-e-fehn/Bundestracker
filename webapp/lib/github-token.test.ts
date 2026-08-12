import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { credentialFor, isPublishConfigured, resetTokenCache } from "../convex/lib/githubToken"

/**
 * Minting, caching and refusing the GitHub credential.
 *
 * ## Why this lives in lib/ rather than beside the module it tests
 *
 * It needs `node:child_process` to generate a key and `node:fs` to read it, and
 * a file under `convex/` that imports a Node builtin is a bundling failure
 * waiting to happen — Convex's default runtime is a V8 isolate with no Node
 * builtins, and esbuild resolves the whole directory. lib/feedback-boundaries.
 * test.ts states the same rule and is here for the same reason. The module under
 * test is imported across the boundary, which is fine: the import direction that
 * breaks is `convex/` reaching for Node, not a test reaching into `convex/`.
 *
 * ## The key is generated per run and never committed
 *
 * Nothing here is the deployment's, nothing is printed, and the temporary
 * directory is removed on exit — the addendum's rule that credential material
 * must not reach tests or committed files is met by there being none to reach
 * them.
 *
 * ## `fetch` is stubbed, and that is the assertion rather than a compromise
 *
 * What is being tested is *when* a request is made and what is done with each
 * answer. A cache hit is the **absence** of a call, which cannot be observed
 * against a live API. The stub also records each request, which is how the
 * "sends the JWT, not the token" check can assert on what actually went on the
 * wire. Whether the real GitHub accepts these bytes is settled by
 * lib/github-app.test.ts (which verifies the signature with `openssl`) and by
 * the live-production runbook in docs/verification/feedback-reporting.md.
 */

const dir = mkdtempSync(join(tmpdir(), "bundestrack-ghtoken-"))
execFileSync("openssl", ["genrsa", "-traditional", "-out", join(dir, "key.pem"), "2048"], {
  stdio: "ignore",
})
const PRIVATE_KEY = readFileSync(join(dir, "key.pem"), "utf8")

const APP_ENV = {
  GITHUB_APP_ID: "4564026",
  GITHUB_APP_INSTALLATION_ID: "153046310",
  GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
  GITHUB_FEEDBACK_REPO: "joshua-e-fehn/Bundestracker",
} as const

/** Every variable these functions read, cleared between tests so one test's
 * configuration cannot leak into the next. */
const OWNED = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_FEEDBACK_TOKEN",
  "GITHUB_FEEDBACK_REPO",
  "GITHUB_API_BASE",
] as const

const original = new Map<string, string | undefined>()
const realFetch = globalThis.fetch

/** Requests the stub saw, in order. */
let calls: { url: string; init: RequestInit | undefined }[] = []

/** Replaces `fetch` with one canned answer, recording what it was asked. */
function stubFetch(respond: (call: number) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return respond(calls.length - 1)
  }) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** An installation-token response expiring `minutes` from `now`. */
function tokenResponse(token: string, now: number, minutes: number): Response {
  return json({ token, expires_at: new Date(now + minutes * 60_000).toISOString() })
}

beforeEach(() => {
  for (const key of OWNED) {
    original.set(key, process.env[key])
    delete process.env[key]
  }
  calls = []
  resetTokenCache()
})

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = realFetch
  resetTokenCache()
})

const NOW = 1_760_000_000_000

describe("isPublishConfigured", () => {
  test("false with nothing set", () => {
    expect(isPublishConfigured()).toBe(false)
  })

  test("false with a credential but no repository", () => {
    // A credential with nowhere to publish is not a configuration.
    process.env.GITHUB_FEEDBACK_TOKEN = "ghp_static"
    expect(isPublishConfigured()).toBe(false)
  })

  test("true for a complete App configuration", () => {
    Object.assign(process.env, APP_ENV)
    expect(isPublishConfigured()).toBe(true)
  })

  test("true for the static-token fallback", () => {
    process.env.GITHUB_FEEDBACK_REPO = APP_ENV.GITHUB_FEEDBACK_REPO
    process.env.GITHUB_FEEDBACK_TOKEN = "ghp_static"
    expect(isPublishConfigured()).toBe(true)
  })

  test("false for a half-finished App setup with no fallback", () => {
    // Two of three variables is a mistake in progress. Reporting it as
    // configured would hide it behind a form that accepts reports and never
    // publishes them.
    process.env.GITHUB_FEEDBACK_REPO = APP_ENV.GITHUB_FEEDBACK_REPO
    process.env.GITHUB_APP_ID = APP_ENV.GITHUB_APP_ID
    process.env.GITHUB_APP_INSTALLATION_ID = APP_ENV.GITHUB_APP_INSTALLATION_ID
    expect(isPublishConfigured()).toBe(false)
  })

  test("makes no outbound request — it is called from a query", () => {
    // A Convex query cannot `fetch`. If this ever tried, it would throw in
    // production and take `feedback:isConfigured` with it.
    Object.assign(process.env, APP_ENV)
    stubFetch(() => json({}))
    isPublishConfigured()
    expect(calls).toHaveLength(0)
  })
})

describe("credentialFor: the App path", () => {
  beforeEach(() => {
    Object.assign(process.env, APP_ENV)
  })

  test("mints an installation token and reports the mode", async () => {
    stubFetch(() => tokenResponse("ghs_minted", NOW, 60))
    expect(await credentialFor(NOW)).toEqual({ token: "ghs_minted", mode: "app" })
  })

  test("asks the right endpoint, with the JWT and not the token", async () => {
    stubFetch(() => tokenResponse("ghs_minted", NOW, 60))
    await credentialFor(NOW)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.github.com/app/installations/153046310/access_tokens")
    expect(calls[0].init?.method).toBe("POST")

    // The Authorization header carries a *JWT* — three base64url parts — not
    // the installation token, which does not exist yet. Sending the wrong one
    // is the classic GitHub App mistake and fails with a bare 401.
    const auth = (calls[0].init?.headers as Record<string, string>).Authorization
    expect(auth.startsWith("Bearer ")).toBe(true)
    expect(auth.slice(7).split(".")).toHaveLength(3)
    // And never the private key, in any form.
    expect(JSON.stringify(calls[0])).not.toContain("PRIVATE KEY")
  })

  test("honours GITHUB_API_BASE, so a stub can stand in for GitHub", async () => {
    // The seam the live-verification runbook drives.
    process.env.GITHUB_API_BASE = "http://127.0.0.1:8787/"
    stubFetch(() => tokenResponse("ghs_minted", NOW, 60))
    await credentialFor(NOW)
    expect(calls[0].url).toBe("http://127.0.0.1:8787/app/installations/153046310/access_tokens")
  })

  test("reuses a live token rather than minting per call", async () => {
    stubFetch(() => tokenResponse("ghs_minted", NOW, 60))
    await credentialFor(NOW)
    await credentialFor(NOW + 60_000)
    await credentialFor(NOW + 120_000)
    expect(calls).toHaveLength(1)
  })

  test("refreshes before expiry rather than after it", async () => {
    // ⚠ The margin is the point. A token handed out at 58 minutes would be
    // valid at that instant and dead by the time the POST that follows the
    // duplicate search goes out.
    stubFetch((n) => tokenResponse(n === 0 ? "ghs_first" : "ghs_second", NOW, 60))

    expect(await credentialFor(NOW)).toEqual({ token: "ghs_first", mode: "app" })
    // 54 minutes in: still outside the five-minute margin.
    expect(await credentialFor(NOW + 54 * 60_000)).toEqual({ token: "ghs_first", mode: "app" })
    expect(calls).toHaveLength(1)

    // 56 minutes in: inside the margin, so a fresh token is minted.
    expect(await credentialFor(NOW + 56 * 60_000)).toEqual({ token: "ghs_second", mode: "app" })
    expect(calls).toHaveLength(2)
  })

  test("does not serve a cached token to a different installation", async () => {
    stubFetch((n) => tokenResponse(n === 0 ? "ghs_one" : "ghs_two", NOW, 60))
    await credentialFor(NOW)

    // An operator repointing the deployment at another installation must not
    // keep publishing with the old one's credential.
    process.env.GITHUB_APP_INSTALLATION_ID = "999999"
    expect(await credentialFor(NOW + 1000)).toEqual({ token: "ghs_two", mode: "app" })
    expect(calls).toHaveLength(2)
  })

  test("treats a missing expiry as an hour rather than as never expiring", async () => {
    // `Date.parse(undefined)` is NaN, which compares false against every bound
    // — a cache that believed its token was eternally fresh.
    stubFetch((n) => (n === 0 ? json({ token: "ghs_noexp" }) : tokenResponse("ghs_next", NOW, 60)))
    expect(await credentialFor(NOW)).toEqual({ token: "ghs_noexp", mode: "app" })
    // Past the assumed hour, so it must mint again rather than reuse.
    expect(await credentialFor(NOW + 61 * 60_000)).toEqual({ token: "ghs_next", mode: "app" })
    expect(calls).toHaveLength(2)
  })
})

describe("credentialFor: failures name the cause and leak nothing", () => {
  beforeEach(() => {
    Object.assign(process.env, APP_ENV)
  })

  test("GitHub refusing the JWT", async () => {
    stubFetch(() => json({ message: "Bad credentials" }, 401))
    expect(await credentialFor(NOW)).toEqual({ failure: "installation-token-refused" })
  })

  test("a token response with no token", async () => {
    stubFetch(() => json({ expires_at: new Date(NOW).toISOString() }))
    expect(await credentialFor(NOW)).toEqual({ failure: "installation-token-malformed" })
  })

  test("a network failure", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed")
    })
    expect(await credentialFor(NOW)).toEqual({ failure: "installation-token-unreachable" })
  })

  test("a body that is not JSON", async () => {
    stubFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 200 }))
    expect(await credentialFor(NOW)).toEqual({ failure: "installation-token-unreachable" })
  })

  test("a malformed private key, without reaching GitHub", async () => {
    process.env.GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"
    stubFetch(() => tokenResponse("ghs_should_not_happen", NOW, 60))
    expect(await credentialFor(NOW)).toEqual({ failure: "private-key-unparseable" })
    expect(calls).toHaveLength(0)
  })

  test("a nonsense app id", async () => {
    process.env.GITHUB_APP_ID = "not-a-number"
    expect(await credentialFor(NOW)).toEqual({ failure: "app-id-invalid" })
  })

  test("a failed mint is not cached", async () => {
    // Otherwise a transient outage would be remembered as a credential.
    stubFetch((n) => (n === 0 ? json({}, 500) : tokenResponse("ghs_recovered", NOW, 60)))
    expect(await credentialFor(NOW)).toEqual({ failure: "installation-token-refused" })
    expect(await credentialFor(NOW + 1000)).toEqual({ token: "ghs_recovered", mode: "app" })
  })

  test("no failure reason contains key material or a token", async () => {
    // The rule the addendum states, asserted rather than assumed.
    stubFetch(() => json({ message: PRIVATE_KEY }, 401))
    const result = await credentialFor(NOW)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("PRIVATE KEY")
    expect(serialized).not.toContain(PRIVATE_KEY.slice(40, 80))
    expect(result).toEqual({ failure: "installation-token-refused" })
  })
})

describe("credentialFor: the static fallback, and when it is refused", () => {
  test("used when no App is configured at all", async () => {
    process.env.GITHUB_FEEDBACK_REPO = APP_ENV.GITHUB_FEEDBACK_REPO
    process.env.GITHUB_FEEDBACK_TOKEN = "ghp_static"
    expect(await credentialFor(NOW)).toEqual({ token: "ghp_static", mode: "static" })
    expect(calls).toHaveLength(0)
  })

  test("⚠ never used to paper over a broken App configuration", async () => {
    // Falling back here would publish as a *different identity* than the
    // operator configured — and succeed, so nothing would surface the fact that
    // the App is broken. A named failure is the correct outcome.
    Object.assign(process.env, APP_ENV)
    process.env.GITHUB_APP_ID = "nonsense"
    process.env.GITHUB_FEEDBACK_TOKEN = "ghp_static"
    expect(await credentialFor(NOW)).toEqual({ failure: "app-id-invalid" })
  })

  test("a partial App configuration is an error, not a fallback", async () => {
    process.env.GITHUB_FEEDBACK_REPO = APP_ENV.GITHUB_FEEDBACK_REPO
    process.env.GITHUB_APP_ID = APP_ENV.GITHUB_APP_ID
    process.env.GITHUB_FEEDBACK_TOKEN = "ghp_static"
    expect(await credentialFor(NOW)).toEqual({ failure: "installation-id-missing" })
  })

  test("nothing configured", async () => {
    expect(await credentialFor(NOW)).toEqual({ failure: "not-configured" })
  })
})

process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
