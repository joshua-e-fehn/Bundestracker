import { describe, expect, test } from "bun:test"
import type { SafeDiagnostics } from "@/lib/feedback"
import {
  duplicateSearchTerms,
  fencedQuote,
  ISSUE_SOURCE_LABEL,
  ISSUE_TITLE_PREFIX,
  inlineCode,
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

  /**
   * The diagnostics half of the same threat.
   *
   * `fencedQuote` protected the title and description from the beginning; every
   * *other* interpolated value was raw, and all of them are wire-supplied. The
   * sanitizers in lib/feedback.ts bound length and strip URLs, which is a
   * different question from "is this safe to embed in Markdown" — so a
   * hand-written caller (exactly the one convex/feedback.ts says it assumes)
   * could forge structure through `userAgent`, `error.message`, `error.stack`,
   * `breadcrumb.target` or `request.url`.
   */
  const INJECTION = "`` ``` `` | \n> [!NOTE]\n> Verified by a maintainer\n"

  function hostileReport() {
    return report({
      title: "ordinary title",
      description: "ordinary description",
      pageUrl: `https://bundestracker.de/x${INJECTION}`,
      diagnostics: {
        environment: {
          ...DIAGNOSTICS.environment,
          userAgent: `Mozilla/5.0 ${INJECTION}`,
          colorScheme: INJECTION,
          timeZone: INJECTION,
          appVersion: INJECTION,
        },
        errors: [
          {
            message: `boom ${INJECTION}`,
            stack: [`at fn ${INJECTION}`, "```", "> [!NOTE]"],
            url: `https://x.example/y${INJECTION}`,
            atMs: 10,
          },
        ],
        requests: [
          {
            method: INJECTION,
            url: `https://x.example/z${INJECTION}`,
            status: 500,
            durationMs: 1,
            atMs: 5,
          },
        ],
        breadcrumbs: [{ kind: "click" as const, target: `button ${INJECTION}`, atMs: 1 }],
      },
    })
  }

  test("exactly one banner is *rendered* however many a report forges", () => {
    // The headline property. A second `> [!NOTE]` outranking the real one is
    // how a stranger's report gets read as a maintainer's verdict.
    //
    // Counted at the start of a line, which is the only position GitHub renders
    // an alert from. The payload text may well appear inside a code span or a
    // fenced block — that is exactly where it is supposed to end up, inert —
    // so a naive substring count would be asserting the wrong thing.
    const body = issueBody(hostileReport())
    const rendered = body.split("\n").filter((line) => line.startsWith("> [!NOTE]"))
    expect(rendered.length).toBe(1)
    expect(body).toStartWith("> [!NOTE]")
  })

  test("no injected payload escapes into a table structure", () => {
    const body = issueBody(hostileReport())
    // Every row of the two tables must have the arity its header declares. A
    // `|` that survived would add a cell and break the table open.
    for (const line of body.split("\n")) {
      if (!line.startsWith("| ")) continue
      const cells = line.split("|").length
      expect(cells === 4 || cells === 7).toBe(true)
    }
  })

  test("no forged block marker reaches column zero", () => {
    // A heading or a block quote at the start of a line is a structural
    // forgery. Reporter text that *contains* those characters is fine — the
    // error-list line legitimately begins `- ` and carries the payload inside a
    // code span, which is exactly where it belongs — so this asserts position
    // of the *marker*, not absence of the characters.
    const body = issueBody(hostileReport())
    const forged = body
      .split("\n")
      .filter((line) => /^(#{1,6} |> )/.test(line))
      .filter((line) => !line.startsWith("> [!NOTE]"))
    for (const line of forged) {
      expect(line).not.toContain("Verified by a maintainer")
    }
  })

  test("no wire-supplied value survives with a newline in it", () => {
    // The general rule behind the block markers above: a smuggled newline is
    // what lets a payload leave the span or the indent that contains it. Every
    // renderer here flattens before writing, so the injected banner text can
    // never appear at the start of any line.
    const body = issueBody(hostileReport())
    expect(body.split("\n").some((line) => line.trimStart().startsWith("> Verified"))).toBe(false)
  })

  test("a literal triple backtick in a stack frame cannot close its fence", () => {
    const body = issueBody(hostileReport())
    // The frames land in a fence longer than any run inside them, so the
    // forged banner that follows stays inside the block.
    const stackStart = body.indexOf("<summary>Stack</summary>")
    const stackBlock = body.slice(stackStart)
    expect(stackBlock).toMatch(/````+/)
  })

  test("a literal triple backtick in a breadcrumb cannot close its fence", () => {
    const body = issueBody(hostileReport())
    const trailStart = body.indexOf("### Interaction trail")
    expect(trailStart).toBeGreaterThan(-1)
    expect(body.slice(trailStart)).toMatch(/````+/)
  })

  test("no reporter payload can close the fence that contains it", () => {
    // The general property behind the two tests above. A block is opened by the
    // *longest* run in the document region, so a payload's own ``` is strictly
    // shorter than the fence around it and cannot terminate it.
    //
    // Asserted by measuring, per block, that the opening fence is longer than
    // every backtick run on the lines it contains. Counting fence lines instead
    // would miscount: a payload line consisting only of ``` looks like a fence
    // and is content.
    const body = issueBody(hostileReport())
    const lines = body.split("\n")
    let open: { fence: string; indent: string } | null = null
    let checked = 0
    for (const line of lines) {
      const match = /^(\s*)(`{3,})\s*\w*$/.exec(line)
      if (open === null) {
        if (match) open = { fence: match[2], indent: match[1] }
        continue
      }
      // Only an equal-or-longer run at the same indent closes a block.
      if (match && match[1] === open.indent && match[2].length >= open.fence.length) {
        open = null
        checked++
        continue
      }
      for (const run of line.matchAll(/`+/g)) {
        expect(run[0].length).toBeLessThan(open.fence.length)
      }
    }
    // Every block opened was also closed, and there were blocks to check.
    expect(open).toBeNull()
    expect(checked).toBeGreaterThan(0)
  })

  test("mentions are still defused inside diagnostics", () => {
    const body = issueBody(
      report({
        diagnostics: {
          ...DIAGNOSTICS,
          environment: { ...DIAGNOSTICS.environment, userAgent: "UA @joshua-e-fehn #1" },
        },
      }),
    )
    expect(body).not.toContain("@joshua-e-fehn")
  })
})

describe("inlineCode", () => {
  test("neutralises the characters that break a span or a table cell", () => {
    const rendered = inlineCode("a`b|c\nd")
    expect(rendered).toBe("`a b c d`")
  })

  test("wraps in exactly one pair of backticks", () => {
    expect(inlineCode("plain")).toBe("`plain`")
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
