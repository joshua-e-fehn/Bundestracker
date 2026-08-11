import { describe, expect, test } from "bun:test"
import {
  ALLOWED_QUERY_KEYS,
  describeElement,
  firstPartyOrigins,
  isPlausibleEmail,
  LIMITS,
  sanitizeBreadcrumb,
  sanitizeEnvironment,
  sanitizeError,
  sanitizeRequest,
  sanitizeUrl,
  stripUrlsFromText,
  truncate,
  validateReport,
} from "@/lib/feedback"

/**
 * The privacy boundary, asserted as behaviour rather than as a comment.
 *
 * Every test here is written as a *negative*: a value that must not survive is
 * fed in, and the assertion is that it is absent from the output. That shape is
 * deliberate and it is the only shape that catches the failure this feature can
 * actually have. A positive test ("the page URL is recorded") passes just as
 * happily when the sanitizer is deleted; only `expect(result).not.toContain(
 * "secret-token")` fails when someone replaces `sanitizeUrl(args.pageUrl)` with
 * `args.pageUrl` because the sanitized one "was dropping a query parameter I
 * needed".
 *
 * The literal `SECRET` below is used everywhere a leak could occur, so a
 * grep for it across a failing output names the vector immediately.
 */

const SECRET = "s3cr3t-token-value"

/**
 * The deployed origin, as `sanitizeUrl` reads it to tell first-party from
 * foreign.
 *
 * Set here rather than mocked, because it is exactly the configuration the
 * function consults in production and a test that bypassed it would not be
 * testing the branch. Assigned before any import-time work runs — `sanitizeUrl`
 * reads `process.env` per call, not at module load, so this is sufficient.
 *
 * ⚠ Setting it here is also how this suite once hid a production regression,
 * which is why the `runtime configuration` block below exists. `sanitizeUrl`
 * runs in **two** runtimes — the browser and the Convex server, which re-runs it
 * on the assumption the caller skipped the browser — and `NEXT_PUBLIC_SITE_URL`
 * is a Next.js build-time variable that exists in only one of them. A suite that
 * sets it at module scope runs in a world the server never inhabits, and
 * `isFirstParty`'s localhost fallback meant development passed too. Every report
 * silently lost its path in production and nothing failed.
 */
process.env.NEXT_PUBLIC_SITE_URL = "https://bundestracker.de"

describe("sanitizeUrl", () => {
  test("drops the fragment entirely", () => {
    // The fragment is where an OAuth implicit-flow token lives. On this site it
    // is only ever an anchor, so there is nothing to trade away.
    expect(
      sanitizeUrl(`https://bundestracker.de/mps/bt-1?x=1#access_token=${SECRET}`),
    ).not.toContain(SECRET)
    expect(sanitizeUrl("https://bundestracker.de/mps#contact")).toBe("https://bundestracker.de/mps")
  })

  test("drops every query parameter outside the allowlist", () => {
    const url = sanitizeUrl(
      `https://bundestracker.de/rankings?wp=21&token=${SECRET}&code=${SECRET}&session=${SECRET}`,
    )
    expect(url).not.toContain(SECRET)
    expect(url).not.toContain("token")
    expect(url).not.toContain("code")
    expect(url).not.toContain("session")
    // …while keeping the navigation state that makes a report reproducible.
    expect(url).toContain("wp=21")
  })

  test("keeps exactly the allowlisted keys and no others", () => {
    const all = ALLOWED_QUERY_KEYS.map((key) => `${key}=v`).join("&")
    const url = sanitizeUrl(`https://bundestracker.de/mps?${all}&surprise=${SECRET}`)
    for (const key of ALLOWED_QUERY_KEYS) expect(url).toContain(`${key}=v`)
    expect(url).not.toContain("surprise")
  })

  test("strips credentials embedded in the authority", () => {
    const url = sanitizeUrl(`https://user:${SECRET}@bundestracker.de/mps`)
    expect(url).not.toContain(SECRET)
    expect(url).not.toContain("user")
  })

  test("refuses a scheme that is not http(s)", () => {
    // `javascript:` and `data:` carry their whole payload in the URL itself,
    // so there is no safe subset to keep.
    expect(sanitizeUrl(`javascript:alert('${SECRET}')`)).toBeNull()
    expect(sanitizeUrl(`data:text/html,${SECRET}`)).toBeNull()
    expect(sanitizeUrl("file:///home/reader/.ssh/id_rsa")).toBeNull()
  })

  test("returns null rather than passing an unparseable value through", () => {
    expect(sanitizeUrl("not a url")).toBeNull()
    expect(sanitizeUrl("")).toBeNull()
    expect(sanitizeUrl(null)).toBeNull()
    expect(sanitizeUrl(undefined)).toBeNull()
  })

  test("bounds the result", () => {
    const long = `https://bundestracker.de/${"a".repeat(1000)}`
    expect((sanitizeUrl(long) ?? "").length).toBeLessThanOrEqual(LIMITS.url)
  })

  /**
   * Foreign URLs, which the query allowlist was never written for.
   *
   * The collectors record **every failed request**, third-party ones included,
   * and `issueBody` publishes `requests[].url` into a public GitHub issue. The
   * path used to be reconstructed wholesale for any origin — fine for
   * `/mps/bt-0007`, whose segments are public identifiers, and not fine at all
   * for somebody else's server, where a path segment is an ordinary place to
   * put a session token or a reset nonce.
   */
  describe("foreign origins", () => {
    test("keeps the origin and drops the path", () => {
      const url = sanitizeUrl(`https://api.example.com/v1/session/${SECRET}`)
      expect(url).not.toContain(SECRET)
      expect(url).not.toContain("session")
      // The origin survives, because "the call to api.example.com failed" is
      // the entire diagnostic value of the record.
      expect(url).toContain("https://api.example.com")
    })

    test("drops a secret in any path position", () => {
      for (const path of [
        `/reset/${SECRET}`,
        `/${SECRET}/profile`,
        `/a/b/c/${SECRET}`,
        `/download/${SECRET}/file.pdf`,
      ]) {
        expect(sanitizeUrl(`https://files.example.com${path}`)).not.toContain(SECRET)
      }
    })

    test("does not apply the first-party query allowlist to a stranger", () => {
      // `?q=` is kept on this site because it is the search box, reasoned about
      // for this site's URL space. A third-party `q` is somebody else's field.
      const url = sanitizeUrl(`https://search.example.com/x?q=${SECRET}&wp=21`)
      expect(url).not.toContain(SECRET)
      expect(url).not.toContain("wp=21")
    })

    test("marks that something was removed", () => {
      // A bare origin would read as the whole URL to whoever triages the issue.
      expect(sanitizeUrl("https://api.example.com/v1/thing")).toBe("https://api.example.com/…")
    })

    test("keeps the path for localhost, so development reports stay useful", () => {
      expect(sanitizeUrl("http://localhost:3000/rankings?wp=21")).toBe(
        "http://localhost:3000/rankings?wp=21",
      )
    })

    test("a hostname merely containing 'localhost' is still foreign", () => {
      // `localhost.evil.com` is not localhost. A substring check here would be
      // an origin-confusion bug.
      const url = sanitizeUrl(`https://localhost.evil.com/steal/${SECRET}`)
      expect(url).not.toContain(SECRET)
      expect(url).toBe("https://localhost.evil.com/…")
    })
  })

  /**
   * The runtime this suite does not otherwise simulate.
   *
   * `sanitizeUrl` is re-run on the Convex server (convex/feedback.ts) over
   * values the browser already sanitized, and the server's output is what gets
   * stored and published. But the Convex deployment has no
   * `NEXT_PUBLIC_SITE_URL` — that is a Next.js build-time variable inlined into
   * the browser bundle — so the server pass classified the app's own URL as
   * foreign and stripped the path from every report. Silently, and in the safe
   * direction, which is why nothing noticed.
   *
   * These tests manipulate `process.env` directly and restore it, so they
   * assert the configuration each runtime actually has rather than the one the
   * suite happens to set at module scope.
   */
  describe("runtime configuration", () => {
    const saved = {
      next: process.env.NEXT_PUBLIC_SITE_URL,
      site: process.env.SITE_URL,
    }
    const restore = () => {
      process.env.NEXT_PUBLIC_SITE_URL = saved.next
      if (saved.site === undefined) delete process.env.SITE_URL
      else process.env.SITE_URL = saved.site
    }

    test("the Convex runtime keeps first-party paths via SITE_URL", () => {
      // THE regression. Only `SITE_URL` is set — exactly the Convex
      // deployment's configuration, where Better Auth already requires it.
      delete process.env.NEXT_PUBLIC_SITE_URL
      process.env.SITE_URL = "https://bundestracker.de"
      try {
        expect(sanitizeUrl("https://bundestracker.de/rankings?wp=20&metric=speeches")).toBe(
          "https://bundestracker.de/rankings?wp=20&metric=speeches",
        )
        // …and a stranger is still reduced, so the fix does not widen the rule.
        expect(sanitizeUrl(`https://api.example.com/v1/session/${SECRET}`)).toBe(
          "https://api.example.com/…",
        )
      } finally {
        restore()
      }
    })

    test("error text keeps first-party URLs on the server too", () => {
      // `stripUrlsFromText` routes through the same check, so the regression
      // reached error messages by the same path.
      delete process.env.NEXT_PUBLIC_SITE_URL
      process.env.SITE_URL = "https://bundestracker.de"
      try {
        expect(stripUrlsFromText("Cannot load https://bundestracker.de/mps/bt-0007 in list")).toBe(
          "Cannot load https://bundestracker.de/mps/bt-0007 in list",
        )
      } finally {
        restore()
      }
    })

    test("the browser runtime keeps first-party paths via NEXT_PUBLIC_SITE_URL", () => {
      delete process.env.SITE_URL
      process.env.NEXT_PUBLIC_SITE_URL = "https://bundestracker.de"
      try {
        expect(sanitizeUrl("https://bundestracker.de/mps?wp=21")).toBe(
          "https://bundestracker.de/mps?wp=21",
        )
      } finally {
        restore()
      }
    })

    test("sanitizing twice is stable, as the two-runtime design requires", () => {
      // The browser sanitizes, the server sanitizes again. A first-party URL
      // must survive both passes unchanged — the regression showed up precisely
      // as the second pass disagreeing with the first.
      process.env.NEXT_PUBLIC_SITE_URL = "https://bundestracker.de"
      process.env.SITE_URL = "https://bundestracker.de"
      try {
        const once = sanitizeUrl("https://bundestracker.de/rankings?wp=20&q=klima")
        expect(sanitizeUrl(once)).toBe(once)
        expect(once).toContain("/rankings")
      } finally {
        restore()
      }
    })

    test("with neither variable set, everything is foreign", () => {
      // The conservative default, asserted rather than assumed: a deployment
      // that forgot to configure an origin over-redacts, never under-redacts.
      delete process.env.NEXT_PUBLIC_SITE_URL
      delete process.env.SITE_URL
      try {
        expect(sanitizeUrl("https://bundestracker.de/rankings?wp=20")).toBe(
          "https://bundestracker.de/…",
        )
      } finally {
        restore()
      }
    })

    test("the two variables are independent — either alone is enough", () => {
      expect(firstPartyOrigins().length).toBeGreaterThan(0)
    })
  })
})

describe("stripUrlsFromText", () => {
  test("sanitizes a URL embedded in free text", () => {
    const text = `Failed to fetch https://api.example.com/v1/me?token=${SECRET} after 3 tries`
    const result = stripUrlsFromText(text)
    expect(result).not.toContain(SECRET)
    // The sentence around it survives — that is the part a maintainer reads.
    expect(result).toContain("Failed to fetch")
    expect(result).toContain("after 3 tries")
  })

  test("keeps trailing sentence punctuation out of the URL", () => {
    expect(stripUrlsFromText("see https://bundestracker.de/mps.")).toContain("/mps.")
  })
})

describe("sanitizeError", () => {
  test("strips a token out of the message", () => {
    const error = sanitizeError({
      message: `Request to https://convex.cloud/api?auth=${SECRET} failed`,
      stack: null,
      url: null,
      atMs: 0,
    })
    expect(error.message).not.toContain(SECRET)
  })

  test("strips URLs out of every stack frame and caps the count", () => {
    const frames = Array.from(
      { length: 40 },
      (_, i) => `    at fn${i} (https://app.example.com/bundle.js?token=${SECRET}:1:2)`,
    ).join("\n")
    const error = sanitizeError({ message: "boom", stack: frames, url: null, atMs: 0 })
    expect(error.stack.length).toBeLessThanOrEqual(LIMITS.stackFrames)
    expect(error.stack.join("\n")).not.toContain(SECRET)
  })

  test("is idempotent over its own output", () => {
    // convex/feedback.ts re-runs the sanitizers on data the browser already
    // sanitized, because a hand-written caller skipped the browser. A second
    // pass must not silently empty the stack — which is exactly what happened
    // when the frame filter only matched raw, indented V8 frames.
    const first = sanitizeError({
      message: "boom",
      stack: "Error: boom\n    at a (x.js:1:1)\n    at b (y.js:2:2)",
      url: "https://bundestracker.de/mps",
      atMs: 5,
    })
    const second = sanitizeError({ ...first, stack: first.stack.join("\n") })
    expect(second.stack).toEqual(first.stack)
    expect(second.stack.length).toBe(2)
    expect(second.message).toBe(first.message)
  })

  test("handles a Firefox-shaped stack", () => {
    const error = sanitizeError({
      message: "boom",
      stack: "fn@https://app.example.com/x.js:1:2\nother@https://app.example.com/y.js:3:4",
      url: null,
      atMs: 0,
    })
    expect(error.stack.length).toBe(2)
  })

  test("bounds the message", () => {
    const error = sanitizeError({ message: "x".repeat(5000), stack: null, url: null, atMs: 0 })
    expect(error.message.length).toBeLessThanOrEqual(LIMITS.errorMessage)
  })

  test("never produces a negative or non-numeric offset", () => {
    expect(sanitizeError({ atMs: -500 }).atMs).toBe(0)
    expect(sanitizeError({ atMs: Number.NaN }).atMs).toBe(0)
  })
})

describe("sanitizeRequest", () => {
  test("has no field for a body or a header, and sanitizes the URL", () => {
    const request = sanitizeRequest({
      method: "POST",
      url: `https://api.example.com/login?token=${SECRET}`,
      status: 401,
      durationMs: 120,
      atMs: 10,
    })
    expect(JSON.stringify(request)).not.toContain(SECRET)
    // The recorded shape is exactly these five keys — a body or a header could
    // only arrive by one being added, which this pins.
    expect(Object.keys(request).sort()).toEqual(["atMs", "durationMs", "method", "status", "url"])
  })

  test("normalises an unknown method rather than storing free text", () => {
    expect(sanitizeRequest({ method: `TRACE ${SECRET}` }).method).toBe("OTHER")
    expect(sanitizeRequest({ method: "get" }).method).toBe("GET")
  })

  test("reports a network failure as no status rather than as status 0", () => {
    // The distinction a maintainer needs: "the server said no" vs "the request
    // never arrived".
    expect(sanitizeRequest({ method: "GET", status: 0 }).status).toBeNull()
    expect(sanitizeRequest({ method: "GET", status: 500 }).status).toBe(500)
    expect(sanitizeRequest({ method: "GET", status: 9999 }).status).toBeNull()
  })
})

describe("describeElement", () => {
  const element = (attributes: Record<string, string>, tagName = "BUTTON") => ({
    tagName,
    getAttribute: (name: string) => attributes[name] ?? null,
  })

  test("never reads the accessible name, the text or the value", () => {
    const described = describeElement(
      element({
        "aria-label": `Follow ${SECRET}`,
        title: SECRET,
        placeholder: SECRET,
        value: SECRET,
        alt: SECRET,
      }),
    )
    expect(described).not.toContain(SECRET)
    expect(described).toBe("button")
  })

  test("keeps the opt-in identifier, the role and the type", () => {
    const described = describeElement(
      element({ "data-feedback-id": "submit-feedback", role: "button", type: "submit" }),
    )
    expect(described).toContain("button")
    expect(described).toContain("#submit-feedback")
    expect(described).toContain("role=button")
  })

  test("rejects an opt-in identifier carrying interpolated content", () => {
    // The escape hatch must not become the leak: an id built from a template
    // string holding a person's name fails the identifier shape and is dropped.
    const described = describeElement(element({ "data-feedback-id": `follow ${SECRET}!` }))
    expect(described).not.toContain(SECRET)
  })
})

describe("sanitizeBreadcrumb", () => {
  test("drops an unrecognised kind rather than storing it", () => {
    expect(sanitizeBreadcrumb({ kind: SECRET, target: "button", atMs: 1 })).toBeNull()
    expect(sanitizeBreadcrumb({ kind: "click", target: "button", atMs: 1 })?.kind).toBe("click")
  })

  test("sanitizes a URL that reached the target field", () => {
    const crumb = sanitizeBreadcrumb({
      kind: "navigate",
      target: `https://bundestracker.de/x?token=${SECRET}`,
      atMs: 1,
    })
    expect(crumb?.target).not.toContain(SECRET)
  })
})

describe("sanitizeEnvironment", () => {
  test("constrains every free-text field to a known shape", () => {
    const environment = sanitizeEnvironment({
      userAgent: "Mozilla/5.0",
      viewport: { width: 1280, height: 800 },
      devicePixelRatio: 2,
      locale: SECRET,
      colorScheme: SECRET,
      timeZone: `Europe/Berlin; ${SECRET}`,
      signedIn: true,
      appVersion: null,
    })
    expect(environment.locale).toBe("unknown")
    expect(environment.colorScheme).toBe("unknown")
    expect(environment.timeZone).toBe("unknown")
    expect(JSON.stringify(environment)).not.toContain(SECRET)
  })

  test("accepts the real values", () => {
    const environment = sanitizeEnvironment({
      userAgent: "Mozilla/5.0",
      viewport: { width: 1280, height: 800 },
      devicePixelRatio: 2,
      locale: "de",
      colorScheme: "dark",
      timeZone: "Europe/Berlin",
      signedIn: false,
      appVersion: "abc123",
    })
    expect(environment.locale).toBe("de")
    expect(environment.colorScheme).toBe("dark")
    expect(environment.timeZone).toBe("Europe/Berlin")
    expect(environment.signedIn).toBe(false)
  })

  test("signedIn is a boolean and never an identity", () => {
    // A truthy non-boolean (a user id, say) must not survive as one.
    expect(sanitizeEnvironment({ signedIn: "user_123" as unknown as boolean }).signedIn).toBe(false)
  })

  test("clamps hostile numbers", () => {
    const environment = sanitizeEnvironment({
      viewport: { width: 1e12, height: -5 },
      devicePixelRatio: 1e9,
    })
    expect(environment.viewport.width).toBeLessThanOrEqual(20000)
    expect(environment.viewport.height).toBe(0)
    expect(environment.devicePixelRatio).toBeLessThanOrEqual(5)
  })
})

describe("truncate", () => {
  test("marks a truncation rather than ending mid-value silently", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…")
    expect(truncate("abc", 5)).toBe("abc")
  })
})

describe("validateReport", () => {
  test("requires a title", () => {
    expect(validateReport({ title: "  ", description: "x", contact: "" })).toBe("title-missing")
    expect(validateReport({ title: "ab", description: "", contact: "" })).toBe("title-missing")
  })

  test("accepts an empty description and an empty contact", () => {
    // Both are optional, and a report with only a title is still a report.
    expect(
      validateReport({ title: "The rankings page is blank", description: "", contact: "" }),
    ).toBeNull()
  })

  test("rejects an implausible contact address", () => {
    expect(validateReport({ title: "A title", description: "", contact: "not-an-email" })).toBe(
      "contact-invalid",
    )
    expect(validateReport({ title: "A title", description: "", contact: "a@b.de" })).toBeNull()
  })

  test("bounds both text fields", () => {
    expect(
      validateReport({ title: "x".repeat(LIMITS.title + 1), description: "", contact: "" }),
    ).toBe("title-too-long")
    expect(
      validateReport({
        title: "A title",
        description: "x".repeat(LIMITS.description + 1),
        contact: "",
      }),
    ).toBe("description-too-long")
  })
})

describe("isPlausibleEmail", () => {
  test("rejects values that cannot be an address", () => {
    for (const value of ["", "a", "a@", "@b.de", "a b@c.de", "a@b", "a@b,c.de"]) {
      expect(isPlausibleEmail(value)).toBe(false)
    }
  })

  test("accepts ordinary addresses", () => {
    for (const value of ["a@b.de", "first.last@example.co.uk", "x+tag@mail.example.org"]) {
      expect(isPlausibleEmail(value)).toBe(true)
    }
  })
})
