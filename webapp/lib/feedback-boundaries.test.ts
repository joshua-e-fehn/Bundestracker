import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The guarantees that are properties of the *source* rather than of any
 * function's output.
 *
 * This is an unusual kind of test and it is used deliberately and narrowly.
 * Some of what the feedback feature promises is not a value anything returns —
 * "the diagnostics validator contains no `v.any()`", "the publishing query
 * never selects the contact column", "the retention sweep is actually wired to
 * a cron" — and every one of those is a promise whose breach would be both
 * invisible in review and severe: an address published to a public issue
 * tracker, or a table of strangers' emails growing without bound.
 *
 * A source assertion is a blunt instrument. It is used here only where the
 * alternative is no assertion at all, and never where a behavioural test would
 * do — the behavioural half lives in lib/feedback.test.ts and
 * lib/feedback-issue.test.ts, which is where the bulk of the coverage is.
 * `components/sidebar-account.test.ts` reaches for the same technique to pin
 * the hydration contract, for the same reason.
 *
 * ⚠ These tests read files by path. A rename of the modules they name breaks
 * them loudly, which is correct: the guarantee moved, and someone has to say
 * where to.
 */

const root = new URL("../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")

/**
 * Source with comments removed.
 *
 * Required, not cosmetic. These modules document what they refuse to read —
 * "`event.key` is never recorded", "never touches `init.headers`" — so a naive
 * scan for a forbidden identifier matches the *prose promising it is absent*
 * and fails on a correct file. Stripping comments first is what makes the
 * assertion about the code rather than about the documentation of the code.
 *
 * A regex is enough here because these files contain no string literal holding
 * `//` or `/*`, which the test for each guarantee would surface anyway by
 * failing.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

const schemaSource = read("convex/schema.ts")
const feedbackSource = read("convex/feedback.ts")
const diagnosticsCode = code("lib/diagnostics.ts")
const screenshotSource = read("lib/screenshot.ts")

/** The `safeDiagnostics` validator, as source text. */
function safeDiagnosticsBlock(): string {
  const start = schemaSource.indexOf("export const safeDiagnostics")
  expect(start).toBeGreaterThan(-1)
  const end = schemaSource.indexOf("\n})", start)
  return schemaSource.slice(start, end)
}

describe("the diagnostics validator stays closed", () => {
  test("contains no open-ended validator", () => {
    // `v.any()` or `v.record()` anywhere in this shape would re-open every
    // vector the feature exists to close: a client could then attach a cookie
    // jar under a key nobody anticipated, and it would validate.
    const block = safeDiagnosticsBlock()
    expect(block).not.toContain("v.any(")
    expect(block).not.toContain("v.record(")
    expect(block).not.toContain("v.bytes(")
  })

  test("declares no field for anything forbidden", () => {
    const block = safeDiagnosticsBlock().toLowerCase()
    for (const forbidden of [
      "cookie",
      "localstorage",
      "sessionstorage",
      "authorization",
      "requestbody",
      "responsebody",
      "formdata",
      "fieldvalue",
      "password",
    ]) {
      expect(block).not.toContain(forbidden)
    }
  })
})

describe("the collectors never read a forbidden surface", () => {
  test("nothing in the browser collectors touches cookies or storage", () => {
    // The strongest of the protections: a sanitizer can only remove what was
    // collected, so a collector that never reads `document.cookie` has nothing
    // to remove. `localStorage` appears in the widget (for the rate-limit key
    // it *writes*) but must not appear here, where the reading happens.
    expect(diagnosticsCode).not.toContain("document.cookie")
    expect(diagnosticsCode).not.toContain("localStorage")
    expect(diagnosticsCode).not.toContain("sessionStorage")
  })

  test("the fetch wrapper never reads headers or bodies", () => {
    expect(diagnosticsCode).not.toContain("init?.headers")
    expect(diagnosticsCode).not.toContain("init.headers")
    expect(diagnosticsCode).not.toContain("response.text()")
    expect(diagnosticsCode).not.toContain("response.json()")
    expect(diagnosticsCode).not.toContain("response.body")
    expect(diagnosticsCode).not.toContain("response.headers")
    // …while still recording the one field that makes a failure actionable.
    expect(diagnosticsCode).toContain("response.status")
  })

  test("the key listener records that typing happened, never what was typed", () => {
    // `event.key` here would be a keylogger. The breadcrumb records the element
    // shape and nothing else.
    expect(diagnosticsCode).not.toContain("event.key")
    expect(diagnosticsCode).toContain('kind: "keydown"')
  })

  test("no collector reads an element's content or accessible name", () => {
    for (const forbidden of [".value", "textContent", "innerText", "aria-label", "placeholder"]) {
      expect(diagnosticsCode).not.toContain(forbidden)
    }
  })
})

describe("the screenshot redacts before it rasterises", () => {
  test("form controls and account surfaces are redacted unconditionally", () => {
    const start = screenshotSource.indexOf("const ALWAYS_REDACT")
    expect(start).toBeGreaterThan(-1)
    // `\n]` rather than `]`: the array's first entry is itself a bracketed
    // attribute selector, so the first bare `]` is inside element zero.
    const block = screenshotSource.slice(start, screenshotSource.indexOf("\n]", start))
    for (const selector of ["input", "textarea", "select", "data-feedback-account"]) {
      expect(block).toContain(selector)
    }
    // The forward-compatibility marker the requirement asks for.
    expect(block).toContain("REDACT_ATTRIBUTE")
  })

  test("redaction happens before the canvas is drawn", () => {
    // The ordering is the whole guarantee: once pixels exist there is no undo.
    const capture = screenshotSource.slice(
      screenshotSource.indexOf("export async function captureScreenshot"),
    )
    const redact = capture.indexOf("applyRedactions")
    const draw = capture.indexOf("drawImage")
    expect(redact).toBeGreaterThan(-1)
    expect(draw).toBeGreaterThan(redact)
  })

  test("the report widget itself is dropped from the capture", () => {
    expect(screenshotSource).toContain("data-feedback-widget")
  })
})

describe("the publishing path cannot read the private half", () => {
  test("getReportForPublication does not select the contact column", () => {
    // The narrowest enforcement point: the action that talks to GitHub is
    // handed an object that never had an address in it.
    const start = feedbackSource.indexOf("export const getReportForPublication")
    const end = feedbackSource.indexOf("export const recordPublication")
    expect(start).toBeGreaterThan(-1)
    const block = feedbackSource.slice(start, end)
    expect(block).toContain("hasContact")
    // `contact: row.contact` would be the leak; `row.contact !== null` is the
    // boolean and is expected.
    expect(block).not.toMatch(/contact:\s*row\.contact\b/)
    expect(block).not.toMatch(/screenshotId:\s*row\.screenshotId\b/)
  })

  test("a rejected report stores no reporter text", () => {
    // Otherwise being refused becomes a way to write arbitrary content into
    // the table.
    const start = feedbackSource.indexOf("if (rejection) {")
    const end = feedbackSource.indexOf(
      "return { accepted: false, reportId: null, reason: rejection }",
    )
    expect(start).toBeGreaterThan(-1)
    const block = feedbackSource.slice(start, end)
    expect(block).toContain('title: ""')
    expect(block).toContain('description: ""')
    expect(block).toContain("contact: null")
  })

  test("the userId is read from the session and never from an argument", () => {
    // The rule convex/userPreferences.ts states: a `userId` argument would let
    // a caller attribute their report to somebody else.
    const argsStart = feedbackSource.indexOf("const submissionArgs = {")
    const argsEnd = feedbackSource.indexOf("honeypot: v.string()", argsStart)
    expect(argsStart).toBeGreaterThan(-1)
    expect(feedbackSource.slice(argsStart, argsEnd)).not.toContain("userId")
    expect(feedbackSource).toContain("userId: await getUserId(ctx)")
  })

  test("the GitHub repository is never taken from the caller", () => {
    // `findDuplicates` interpolates a `repo:` qualifier. It must come from the
    // environment, or a caller could redirect the search.
    expect(feedbackSource).toContain("process.env.GITHUB_FEEDBACK_REPO")
    const dupStart = feedbackSource.indexOf("export const findDuplicates")
    const dupEnd = feedbackSource.indexOf("// --- publication")
    const block = feedbackSource.slice(dupStart, dupEnd)
    // Matched as a pattern rather than as a string literal: the text being
    // asserted about *is* an interpolation, and writing it as a literal trips
    // `noTemplateCurlyInString` on a file that is deliberately quoting source.
    expect(block).toMatch(/`repo:\$\{repo\}/)
    expect(block).not.toMatch(/repo:\$\{args\./)
  })

  test("an upstream error body is never stored", () => {
    // A GitHub error response echoes the request, and the request carries the
    // reporter's text — storing it would duplicate the report into a field
    // nothing sanitizes.
    // A pattern, for the reason given above.
    expect(feedbackSource).toMatch(/github-http-\$\{response\.status\}/)
    expect(feedbackSource).not.toContain("await response.text()")
  })

  test("diagnostics are re-sanitized on the server, not merely validated", () => {
    // The validator proves the shape; only re-running the sanitizers proves the
    // values. A hand-written caller satisfies the schema with a full URL in
    // `requests[].url`.
    expect(feedbackSource).toContain("resanitize(args.diagnostics)")
    expect(feedbackSource).toContain("sanitizeUrl(args.pageUrl)")
  })
})

describe("retention is actually scheduled", () => {
  test("the sweep is registered as a cron", () => {
    // A retention window nothing enforces is a comment. This is the assertion
    // that catches the sweep being written and never wired up.
    expect(read("convex/crons.ts")).toContain("internal.feedback.sweepExpiredReports")
  })

  test("the sweep deletes the screenshot before the row", () => {
    // The other order leaves a live file with nothing pointing at it, which is
    // the failure that never gets noticed.
    const block = feedbackSource.slice(feedbackSource.indexOf("export const sweepExpiredReports"))
    const deleteFile = block.indexOf("ctx.storage.delete")
    const deleteRow = block.indexOf("ctx.db.delete")
    expect(deleteFile).toBeGreaterThan(-1)
    expect(deleteRow).toBeGreaterThan(deleteFile)
  })
})
