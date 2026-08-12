import { describe, expect, test } from "bun:test"
import {
  CONVEX_INGRESS_UNSAFE_HEADERS,
  convexAuthForwardHeaders,
  convexAuthRouteHandlers,
} from "./auth-forwarded-headers"

/**
 * The proxy hop that serves `/api/auth/*` from the Vercel origin.
 *
 * Written against the observed production failure: every same-origin auth route
 * returned 404 while the identical route on whimsical-bandicoot-307.convex.site
 * returned 200. The cause is a header, not a route and not an environment
 * variable — see lib/auth-forwarded-headers.ts.
 *
 * The offline group is the regression proper. The live group reaches the real
 * deployment and is opt-in, because a test that silently depends on the network
 * fails for the wrong reason when the network is what broke.
 */

const SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://whimsical-bandicoot-307.convex.site"
const PUBLIC_ORIGIN = "https://www.bundestracker.de"

/** What Vercel hands the route handler for a same-origin auth request. */
function incomingRequest(path = "/api/auth/ok", init: RequestInit = {}): Request {
  return new Request(`${PUBLIC_ORIGIN}${path}`, {
    headers: { accept: "*/*", "user-agent": "regression-test" },
    ...init,
  })
}

describe("convexAuthForwardHeaders", () => {
  const forward = (incoming: Headers = new Headers()) =>
    convexAuthForwardHeaders(incoming, new URL(`${PUBLIC_ORIGIN}/api/auth/ok`), SITE)

  test("does not send the header Convex's edge router rejects", () => {
    // The whole bug in one assertion. With `x-forwarded-host: www.bundestracker.de`
    // on the wire, every route on the deployment 404s at ingress — including
    // /api/pipeline/health, which is not a Better Auth route at all.
    expect(forward().get("x-forwarded-host")).toBeNull()
    expect(forward().get("x-forwarded-proto")).toBeNull()
  })

  test("strips an inbound x-forwarded-* pair rather than passing it through", () => {
    // Vercel's own proxy may set these before the handler ever runs, naming the
    // public origin exactly as the library would. Not setting them is not
    // enough; they have to be removed.
    const incoming = new Headers({
      "x-forwarded-host": "www.bundestracker.de",
      "x-forwarded-proto": "https",
    })
    expect(forward(incoming).get("x-forwarded-host")).toBeNull()
    expect(forward(incoming).get("x-forwarded-proto")).toBeNull()
  })

  test("carries the public origin on the x-better-auth-* pair", () => {
    // `restoreOriginalForwardedHeaders` (dist/client/create-client.js:5-19)
    // re-derives x-forwarded-* from these *inside* Convex, past the edge
    // router. Dropping them too would fix the 404 by making Better Auth forget
    // which origin it serves — sign-in would mint callbacks for the wrong host.
    expect(forward().get("x-better-auth-forwarded-host")).toBe("www.bundestracker.de")
    expect(forward().get("x-better-auth-forwarded-proto")).toBe("https")
  })

  test("addresses the request to the Convex deployment", () => {
    expect(forward().get("host")).toBe("whimsical-bandicoot-307.convex.site")
  })

  test("drops hop-by-hop headers", () => {
    // undici rejects an outbound `transfer-encoding: chunked`, and a stale
    // content-length contradicts the body actually sent.
    const incoming = new Headers({
      "transfer-encoding": "chunked",
      "content-length": "99",
      connection: "keep-alive",
    })
    for (const name of ["transfer-encoding", "content-length", "connection"]) {
      expect(forward(incoming).get(name)).toBeNull()
    }
  })

  test("does not touch x-forwarded-for — it names the client, not the host", () => {
    // Convex resolves deployments from the host headers only, and Better Auth
    // records this one as the session IP. Stripping it would be an unrelated
    // regression smuggled in by an adjacent-looking fix.
    const incoming = new Headers({ "x-forwarded-for": "203.0.113.7" })
    expect(forward(incoming).get("x-forwarded-for")).toBe("203.0.113.7")
  })

  test("preserves the caller's other headers", () => {
    const incoming = new Headers({ cookie: "better-auth.session=abc", accept: "*/*" })
    expect(forward(incoming).get("cookie")).toBe("better-auth.session=abc")
    expect(forward(incoming).get("accept")).toBe("*/*")
  })

  test("does not mutate the incoming headers", () => {
    const incoming = new Headers({ "x-forwarded-host": "www.bundestracker.de" })
    forward(incoming)
    expect(incoming.get("x-forwarded-host")).toBe("www.bundestracker.de")
  })

  test("names both halves of the unsafe pair", () => {
    // Measured: `x-forwarded-host` alone is what 404s — sending only
    // `x-forwarded-proto: https` still returns 200. The proto is stripped
    // because the library sets the two as a pair from one source, and leaving a
    // proto that names the public origin behind a host that no longer does is a
    // contradiction the next reader would have to re-derive.
    expect([...CONVEX_INGRESS_UNSAFE_HEADERS]).toEqual(["x-forwarded-host", "x-forwarded-proto"])
  })
})

describe("convexAuthRouteHandlers", () => {
  /** Captures the outbound request without touching the network. */
  function captureOutbound() {
    const calls: Request[] = []
    const fetchSpy = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(new Request(typeof input === "string" ? input : input.toString(), init))
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return { calls, fetchSpy }
  }

  /**
   * Runs one request through the handler with `fetch` stubbed.
   *
   * The stub is installed and removed around a single await, sequentially —
   * acceptable in a test, and precisely the pattern rejected for the
   * implementation, where concurrent requests would interleave the restore.
   */
  async function runHandler(method: "GET" | "POST", request: Request) {
    const { calls, fetchSpy } = captureOutbound()
    const original = globalThis.fetch
    globalThis.fetch = fetchSpy as typeof globalThis.fetch
    try {
      const response = await convexAuthRouteHandlers(SITE)[method](request)
      return { response, outbound: calls[0] }
    } finally {
      globalThis.fetch = original
    }
  }

  test("forwards GET to the same path on the Convex site URL", async () => {
    const { outbound } = await runHandler("GET", incomingRequest("/api/auth/get-session"))
    expect(outbound.url).toBe(`${SITE}/api/auth/get-session`)
  })

  test("preserves the query string", async () => {
    const { outbound } = await runHandler(
      "GET",
      incomingRequest("/api/auth/callback/google?code=abc&state=xyz"),
    )
    expect(outbound.url).toBe(`${SITE}/api/auth/callback/google?code=abc&state=xyz`)
  })

  test("the outbound request carries no x-forwarded-host", async () => {
    const { outbound } = await runHandler("GET", incomingRequest())
    expect(outbound.headers.get("x-forwarded-host")).toBeNull()
    expect(outbound.headers.get("x-better-auth-forwarded-host")).toBe("www.bundestracker.de")
  })

  test("forwards a POST body", async () => {
    const body = JSON.stringify({ provider: "google" })
    const { outbound } = await runHandler(
      "POST",
      incomingRequest("/api/auth/sign-in/social", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    )
    expect(outbound.method).toBe("POST")
    expect(await outbound.text()).toBe(body)
  })

  test("returns the upstream response", async () => {
    const { response } = await runHandler("GET", incomingRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})

/**
 * The live half — the assertion that actually failed in production.
 *
 * Opt-in via CONVEX_LIVE_AUTH_TEST=1: it depends on the deployment being up and
 * on outbound network.
 *
 *   CONVEX_LIVE_AUTH_TEST=1 bun test lib/auth-forwarded-headers.test.ts
 */
const LIVE = process.env.CONVEX_LIVE_AUTH_TEST === "1"

describe.if(LIVE)("against the live Convex deployment", () => {
  /** The exact header set the library sends — dist/nextjs/index.js:30-39. */
  function librarysHeaders() {
    return new Headers({
      accept: "*/*",
      "accept-encoding": "application/json",
      host: new URL(SITE).host,
      "x-forwarded-host": "www.bundestracker.de",
      "x-forwarded-proto": "https",
      "x-better-auth-forwarded-host": "www.bundestracker.de",
      "x-better-auth-forwarded-proto": "https",
    })
  }

  test("the library's header set reproduces the production 404", async () => {
    const response = await fetch(`${SITE}/api/auth/ok`, {
      headers: librarysHeaders(),
      redirect: "manual",
    })
    // The production symptom exactly: rejected at ingress, so no body and none
    // of the CORS headers a real auth response carries.
    expect(response.status).toBe(404)
    expect(response.headers.get("content-type")).toBeNull()
  }, 30_000)

  test("the same header set 404s a non-auth route too", async () => {
    // /api/pipeline/health answers 401 without a key. Getting 404 instead is
    // what proves the rejection happens at the edge, before any of our code —
    // this route has nothing to do with Better Auth.
    const response = await fetch(`${SITE}/api/pipeline/health`, {
      headers: librarysHeaders(),
      redirect: "manual",
    })
    expect(response.status).toBe(404)
  }, 30_000)

  test("our headers reach Better Auth", async () => {
    const response = await fetch(`${SITE}/api/auth/ok`, {
      headers: convexAuthForwardHeaders(
        new Headers({ accept: "*/*" }),
        new URL(`${PUBLIC_ORIGIN}/api/auth/ok`),
        SITE,
      ),
      redirect: "manual",
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  }, 30_000)

  test("get-session is answered rather than 404ing", async () => {
    const response = await fetch(`${SITE}/api/auth/get-session`, {
      headers: convexAuthForwardHeaders(
        new Headers({ accept: "*/*" }),
        new URL(`${PUBLIC_ORIGIN}/api/auth/get-session`),
        SITE,
      ),
      redirect: "manual",
    })
    // 200 null — no cookie was sent, so there is no session. The point is that
    // the auth layer answers at all.
    expect(response.status).toBe(200)
  }, 30_000)
})
