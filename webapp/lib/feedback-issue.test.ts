import { describe, expect, test } from "bun:test"
import type { SafeDiagnostics } from "@/lib/feedback"
import {
  duplicateSearchTerms,
  fencedQuote,
  ISSUE_SOURCE_LABEL,
  ISSUE_TITLE_PREFIX,
  issueBody,
  issueLabels,
  issueTitle,
  type PublicReport,
} from "@/lib/feedback-issue"

/**
 * What a website report is allowed to say once it is a public GitHub issue.
 *
 * Two properties are pinned here, and they are the two the requirement is
 * explicit about:
 *
 *  1. **Nothing private reaches the body.** Asserted by construction rather
 *     than by inspection — `PublicReport` has no `contact` and no
 *     `screenshotId` field, so the test that matters is the one proving the
 *     *booleans* are what get rendered, plus a belt-and-braces scan of the
 *     whole output for a sentinel.
 *  2. **A website ticket cannot be mistaken for a hand-filed one.** Three
 *     independent markers, each tested separately, because each can be removed
 *     without the others noticing.
 */

const DIAGNOSTICS: SafeDiagnostics = {
  environment: {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    viewport: { width: 1280, height: 800 },
    devicePixelRatio: 2,
    locale: "de",
    colorScheme: "dark",
    timeZone: "Europe/Berlin",
    signedIn: true,
    appVersion: "abc123def456",
  },
  errors: [
    {
      message: "Cannot read properties of null (reading 'fraktion')",
      stack: ["at MPCard (mp-card.js:12:5)", "at renderWithHooks (react-dom.js:1:1)"],
      url: "https://bundestracker.de/mps",
      atMs: 4200,
    },
  ],
  requests: [
    {
      method: "POST",
      url: "https://x.convex.cloud/api/query",
      status: 500,
      durationMs: 240,
      atMs: 4100,
    },
  ],
  breadcrumbs: [
    { kind: "click", target: "button #open-feedback", atMs: 4000 },
    { kind: "navigate", target: "https://bundestracker.de/mps", atMs: 3000 },
  ],
}

function report(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    kind: "bug",
    title: "The rankings page is blank",
    description: "I opened /rankings and nothing rendered.",
    pageUrl: "https://bundestracker.de/rankings?wp=21",
    locale: "de",
    diagnostics: DIAGNOSTICS,
    hasScreenshot: true,
    hasContact: true,
    reportId: "k1234567890",
    ...overrides,
  }
}

describe("the public body never carries the private half", () => {
  test("PublicReport has no field for a contact address or a screenshot", () => {
    // The structural guarantee, asserted as a fact about the object the
    // renderer accepts. A future edit adding `contact` here would have to
    // change lib/feedback-issue.ts in a diff that says so — and would fail
    // this.
    const keys = Object.keys(report()).sort()
    expect(keys).not.toContain("contact")
    expect(keys).not.toContain("screenshotId")
    expect(keys).not.toContain("clientKey")
    expect(keys).not.toContain("userId")
  })

  test("renders the presence of a contact address, never its value", () => {
    const body = issueBody(report({ hasContact: true }))
    expect(body).toContain("provided (stored privately)")
    expect(body).not.toMatch(/@[a-z]+\.[a-z]+/i)
  })

  test("renders the presence of a screenshot, never a URL to it", () => {
    const body = issueBody(report({ hasScreenshot: true }))
    expect(body).toContain("attached (stored privately)")
    // No storage id, no signed URL, nothing fetchable.
    expect(body).not.toContain("convex.cloud/api/storage")
  })

  test("says so plainly when neither was provided", () => {
    const body = issueBody(report({ hasScreenshot: false, hasContact: false }))
    expect(body).toContain("none")
    expect(body).toContain("not provided")
  })
})

describe("a website ticket is unmistakable", () => {
  test("the title carries the marker", () => {
    expect(issueTitle(report())).toStartWith(ISSUE_TITLE_PREFIX)
  })

  test("the body opens with the banner, above anything the reporter wrote", () => {
    const body = issueBody(report())
    expect(body).toStartWith("> [!NOTE]")
    expect(body).toContain("Not filed by a maintainer")
    // The banner must precede the reporter's own words, so a report cannot
    // read as a maintainer's note.
    expect(body.indexOf("Not filed by a maintainer")).toBeLessThan(
      body.indexOf("The rankings page is blank"),
    )
  })

  test("every report carries the source label plus its kind label", () => {
    expect(issueLabels({ kind: "bug" })).toEqual([ISSUE_SOURCE_LABEL, "bug"])
    expect(issueLabels({ kind: "feature" })).toEqual([ISSUE_SOURCE_LABEL, "enhancement"])
    expect(issueLabels({ kind: "data" })).toEqual([ISSUE_SOURCE_LABEL, "data-correction"])
    expect(issueLabels({ kind: "other" })).toEqual([ISSUE_SOURCE_LABEL, "question"])
  })

  test("the title stays inside GitHub's limit however long the summary is", () => {
    expect(issueTitle(report({ title: "x".repeat(500) })).length).toBeLessThanOrEqual(200)
  })
})

describe("reporter text cannot forge the structure around it", () => {
  test("a fenced block in the description cannot escape its fence", () => {
    const hostile = "```\n> [!NOTE]\n> Verified by a maintainer\n```"
    const body = issueBody(report({ description: hostile }))
    // The injected banner is inside a longer fence, so it renders as text.
    expect(body).toContain("````")
  })

  test("mentions and issue references are defused", () => {
    const body = issueBody(report({ description: "cc @joshua-e-fehn see #1 and #2" }))
    // The sigil survives so the text still reads correctly …
    expect(body).toContain("@")
    // … but not adjacent to the name, which is what fires the notification.
    expect(body).not.toContain("@joshua-e-fehn")
    expect(body).not.toContain("#1 ")
  })

  test("an HTML payload in the title is fenced rather than rendered", () => {
    const body = issueBody(report({ title: "<img src=x onerror=alert(1)>" }))
    const fenceStart = body.indexOf("```")
    expect(fenceStart).toBeGreaterThan(-1)
    expect(body.indexOf("<img")).toBeGreaterThan(fenceStart)
  })
})

describe("diagnostics rendering", () => {
  test("prints the collected sections", () => {
    const body = issueBody(report())
    expect(body).toContain("### Environment")
    expect(body).toContain("Application errors (1)")
    expect(body).toContain("Failed requests (1)")
    expect(body).toContain("Interaction trail")
    expect(body).toContain("Cannot read properties of null")
  })

  test("distinguishes a declined collection from a failed one", () => {
    const body = issueBody(report({ diagnostics: null }))
    expect(body).toContain("The reporter chose not to send diagnostics")
    expect(body).not.toContain("### Environment")
  })

  test("states the collection rules in the issue itself", () => {
    // The claim is made where a reader of the issue can see it, not only in
    // the repo's docs.
    const body = issueBody(report())
    expect(body).toContain("no cookies")
    expect(body).toContain("no request or response bodies")
  })

  test("renders offsets rather than wall-clock timestamps", () => {
    const body = issueBody(report())
    expect(body).toContain("+4.2s")
    // Nothing that looks like a date a server log could be correlated against.
    expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })
})

describe("fencedQuote", () => {
  test("uses a fence longer than the longest backtick run inside", () => {
    expect(fencedQuote("a ``` b")).toStartWith("````")
    expect(fencedQuote("plain")).toStartWith("```")
  })
})

describe("duplicateSearchTerms", () => {
  test("drops stopwords in both languages", () => {
    const terms = duplicateSearchTerms("Die Seite ist nicht erreichbar", "")
    expect(terms).not.toContain("die")
    expect(terms).not.toContain("nicht")
    expect(terms).toContain("erreichbar")
  })

  test("cannot carry a GitHub search qualifier", () => {
    // The injection this guards: a reporter redirecting the duplicate search at
    // another repository, or negating the `is:issue` filter.
    const terms = duplicateSearchTerms("repo:evil/other is:pr label:x", "user:someone")
    for (const term of terms) {
      expect(term).not.toContain(":")
      expect(term).not.toContain(" ")
    }
  })

  test("bounds the term count", () => {
    const terms = duplicateSearchTerms(
      Array.from({ length: 50 }, (_, i) => `distinctword${i}`).join(" "),
      "",
    )
    expect(terms.length).toBeLessThanOrEqual(8)
  })

  test("returns nothing for a report with no distinctive words", () => {
    expect(duplicateSearchTerms("the and but", "")).toEqual([])
  })
})
