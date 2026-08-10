/**
 * What a website-originated report looks like once it is a GitHub issue.
 *
 * Two things are decided here, and they are the two things the requirement is
 * most specific about:
 *
 *  1. **A website ticket is unmistakably not one Joshua filed by hand.** The
 *     title carries a marker, the body opens with a banner, and the issue
 *     carries a machine label. Any one of the three is enough to tell at a
 *     glance; all three exist because they fail differently — a label can be
 *     removed by a triager, a title can be edited, the banner survives both.
 *  2. **The public body is a strict subset of what the database holds.** The
 *     split is not a matter of formatting: `issueBody` physically cannot render
 *     a contact address or a screenshot, because neither is a parameter it
 *     takes. See `PublicReport` below.
 *
 * ## Why a pure function in lib/ and not a template inside the Convex action
 *
 * Because "the issue body never contains the reporter's email" is the security
 * property most worth a test, and a template inside an action is testable only
 * against a deployment. Here it is a string-returning function over a plain
 * object, so lib/feedback-issue.test.ts can assert the negative — feed it a
 * report whose every free-text field is the literal string that must not leak,
 * and check the output. That is the shape of test that catches a future edit
 * adding one convenient line to the body.
 */

// Relative, not "@/lib/feedback": this module is imported by convex/feedback.ts,
// and convex/tsconfig.json defines no path aliases — the same constraint every
// `convex/*.ts` file states at its own imports. An `@/` specifier here passes
// the app's typecheck and then fails at `convex deploy`, which is the one place
// the two configs disagree.
import type { FeedbackKind } from "./feedback"
import { LIMITS, type SafeDiagnostics, truncate } from "./feedback"

/** The marker every website-originated issue title carries. Chosen over an
 * emoji so it survives a terminal, a search box and a commit message. */
export const ISSUE_TITLE_PREFIX = "[Website]"

/** The label applied to every website-originated issue, on top of the
 * per-kind label. One label to filter the whole intake stream by. */
export const ISSUE_SOURCE_LABEL = "via-website"

/**
 * Per-kind labels. The keys are the form's four choices; the values are
 * conventional GitHub label names.
 *
 * ⚠ These must exist in the repository before the first report arrives.
 * `POST /repos/{owner}/{repo}/issues` does **not** create a missing label — it
 * silently drops it — so a typo here costs a label rather than raising an
 * error. docs/verification/feedback-reporting.md lists the exact `gh label
 * create` commands, and `convex/feedback.ts` treats label application as
 * best-effort for the same reason.
 */
export const ISSUE_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "bug",
  feature: "enhancement",
  data: "data-correction",
  other: "question",
}

/**
 * Exactly what is allowed to become public.
 *
 * This type is the enforcement mechanism, not documentation of one. The private
 * fields of a report — `contact`, `screenshotId`, the reporter's rate-limit
 * token — are absent from it, so `issueBody` cannot render them by mistake, and
 * a future edit that wants to would have to widen this type in a diff that says
 * so plainly.
 */
export type PublicReport = {
  kind: FeedbackKind
  title: string
  description: string
  /** The sanitized page URL — see `sanitizeUrl` in lib/feedback.ts. */
  pageUrl: string | null
  /** The app's display language when the report was filed. */
  locale: string
  /** Null when the reporter opted out of diagnostics, which is a fact worth
   * printing rather than an empty section: it tells a maintainer the absence
   * is a choice, not a collection failure. */
  diagnostics: SafeDiagnostics | null
  /** Whether a screenshot was attached. The image itself is never public — see
   * the note in `issueBody`. */
  hasScreenshot: boolean
  /** Whether the reporter left a contact address. The address is never public;
   * this boolean is what tells a maintainer a reply is possible at all. */
  hasContact: boolean
  /** The database id of the report, so a maintainer can find the private half. */
  reportId: string
}

/** The issue title: marker, kind, and the reporter's own subject line. */
export function issueTitle(report: Pick<PublicReport, "kind" | "title">): string {
  return truncate(
    `${ISSUE_TITLE_PREFIX} ${KIND_TITLE[report.kind]}: ${report.title.trim()}`,
    // GitHub accepts 256; staying under keeps the title readable in a list.
    200,
  )
}

const KIND_TITLE: Record<FeedbackKind, string> = {
  bug: "Bug",
  feature: "Feature request",
  data: "Data correction",
  other: "Feedback",
}

/** The labels for one report. Source label first so it reads as the primary
 * classification in GitHub's UI, which orders them as given. */
export function issueLabels(report: Pick<PublicReport, "kind">): string[] {
  return [ISSUE_SOURCE_LABEL, ISSUE_KIND_LABELS[report.kind]]
}

/**
 * Escapes a reporter's free text so it cannot forge the structure around it.
 *
 * Two separate problems, both real:
 *
 *  - **Markdown injection.** A description containing a fenced block, an HTML
 *    comment or a heading can close the section it is in and write anything
 *    after it — including a fake "verified by maintainer" banner, or an
 *    `<img>` whose `src` pings a server when a maintainer opens the issue.
 *  - **Mention spam.** `@joshua-e-fehn` and `#123` in an issue body notify a
 *    person and cross-link an unrelated issue. A stranger's bug report should
 *    not be able to do either.
 *
 * The fix for the first is to render reporter text inside a fenced block whose
 * fence is longer than any run of backticks in the text — the mechanism
 * CommonMark specifies for exactly this. The fix for the second is a
 * zero-width space after the sigil, which GitHub does not linkify and which
 * copies out of the page as the original text.
 */
export function fencedQuote(text: string): string {
  const longestRun = [...text.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0)
  const fence = "`".repeat(Math.max(3, longestRun + 1))
  return `${fence}text\n${defuseMentions(text)}\n${fence}`
}

/** Neutralises `@mention` and `#123` cross-references without altering how the
 * text reads. U+200B is zero-width; the sigil stays, the notification does not
 * fire. Applied inside code fences too, since GitHub linkifies neither there —
 * but the report is also rendered into a plain-text preview in the widget, and
 * one rule is better than two that disagree. */
function defuseMentions(text: string): string {
  return text.replace(/([@#])(?=[A-Za-z0-9_-])/g, "$1​")
}

/** Renders a millisecond offset as `+1.2s`, the form a reader of a timeline
 * wants. Offsets rather than timestamps is a privacy decision — see
 * `SafeError.atMs` in lib/feedback.ts. */
function offset(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`
}

/**
 * The public issue body.
 *
 * ## What is here
 *
 * The banner, the reporter's own words, the page, and the diagnostics that are
 * safe by construction (lib/feedback.ts decides which, and has already run
 * before this is called).
 *
 * ## What is deliberately not here
 *
 * **The contact address.** Only the boolean. A maintainer who needs to reply
 * looks the report up by id in the Convex dashboard. Publishing a stranger's
 * email in a public issue tracker would be a data-protection incident caused by
 * the very feature meant to help them.
 *
 * **The screenshot.** Only the boolean. This is the one that looks like a
 * missed opportunity and is not: a screenshot is the highest-risk artefact in
 * the whole report — it can show whatever happened to be on screen, including
 * an open account menu — and the reporter approves it in a preview against
 * *this* app's redaction rules, not against publication to the world. It is
 * stored privately, and a maintainer who wants it fetches it deliberately.
 * `docs/verification/feedback-reporting.md` documents that retrieval.
 */
export function issueBody(report: PublicReport): string {
  const lines: string[] = []

  // The banner. First, before anything a stranger typed, so the frame around
  // the report cannot be mistaken for the report.
  lines.push(
    `> [!NOTE]`,
    `> **Submitted through the Bundestracker website feedback form** by an anonymous visitor.`,
    `> Not filed by a maintainer. Contents below are unverified reporter input.`,
    "",
  )

  lines.push(`### What was reported`, "", fencedQuote(report.title.trim()), "")

  const description = report.description.trim()
  if (description) {
    lines.push(`### Details`, "", fencedQuote(truncate(description, LIMITS.description)), "")
  }

  lines.push(`### Context`, "")
  lines.push(`| | |`, `| --- | --- |`)
  lines.push(`| Page | ${report.pageUrl ? `\`${report.pageUrl}\`` : "_not recorded_"} |`)
  lines.push(`| Language | \`${report.locale}\` |`)
  lines.push(`| Screenshot | ${report.hasScreenshot ? "attached (stored privately)" : "none"} |`)
  lines.push(
    `| Reply address | ${report.hasContact ? "provided (stored privately)" : "not provided"} |`,
  )
  lines.push(`| Report id | \`${report.reportId}\` |`)
  lines.push("")

  const diagnostics = report.diagnostics
  if (!diagnostics) {
    // Printed rather than omitted: "the reporter declined" and "collection
    // failed" are different facts, and only one of them is a bug in this
    // feature.
    lines.push(`### Diagnostics`, "", `_The reporter chose not to send diagnostics._`, "")
    return lines.join("\n")
  }

  const env = diagnostics.environment
  lines.push(`### Environment`, "")
  lines.push(`| | |`, `| --- | --- |`)
  lines.push(`| User agent | \`${env.userAgent || "unknown"}\` |`)
  lines.push(
    `| Viewport | ${env.viewport.width}×${env.viewport.height} @ ${env.devicePixelRatio}× |`,
  )
  lines.push(`| Colour scheme | ${env.colorScheme} |`)
  lines.push(`| Time zone | ${env.timeZone} |`)
  lines.push(`| Signed in | ${env.signedIn ? "yes" : "no"} |`)
  if (env.appVersion) lines.push(`| App build | \`${env.appVersion}\` |`)
  lines.push("")

  if (diagnostics.errors.length > 0) {
    lines.push(`### Application errors (${diagnostics.errors.length})`, "")
    for (const error of diagnostics.errors) {
      lines.push(`- **${offset(error.atMs)}** — \`${defuseMentions(error.message)}\``)
      if (error.url) lines.push(`  - on \`${error.url}\``)
      if (error.stack.length > 0) {
        lines.push(`  <details><summary>Stack</summary>`, "")
        lines.push("  ```")
        for (const frame of error.stack) lines.push(`  ${frame}`)
        lines.push("  ```", "  </details>")
      }
    }
    lines.push("")
  }

  if (diagnostics.requests.length > 0) {
    lines.push(`### Failed requests (${diagnostics.requests.length})`, "")
    lines.push(`| At | Method | Status | Duration | URL |`, `| --- | --- | --- | --- | --- |`)
    for (const request of diagnostics.requests) {
      lines.push(
        `| ${offset(request.atMs)} | ${request.method} | ${request.status ?? "no response"} | ${request.durationMs} ms | ${request.url ? `\`${request.url}\`` : "_not recorded_"} |`,
      )
    }
    lines.push("")
  }

  if (diagnostics.breadcrumbs.length > 0) {
    lines.push(`### Interaction trail`, "")
    lines.push(
      `<details><summary>${diagnostics.breadcrumbs.length} steps before the report</summary>`,
      "",
    )
    lines.push("```")
    for (const crumb of diagnostics.breadcrumbs) {
      lines.push(`${offset(crumb.atMs).padStart(8)}  ${crumb.kind.padEnd(8)}  ${crumb.target}`)
    }
    lines.push("```", "</details>", "")
  }

  lines.push(
    "---",
    "",
    `<sub>Diagnostics are collected under the rules in \`webapp/lib/feedback.ts\`: no cookies, no storage values, no headers, no request or response bodies, no form-field values, and no URL query parameters outside a fixed allowlist.</sub>`,
  )

  return lines.join("\n")
}

/**
 * Search terms for the duplicate check, from a report's own words.
 *
 * Deliberately crude: GitHub's search is a full-text index over issue titles
 * and bodies, and the useful query is a handful of distinctive words rather
 * than a sentence. Stopwords in both languages are dropped — the form is
 * bilingual, so a German report's "und"/"der" would otherwise match every issue
 * in the repository as strongly as its actual subject does.
 *
 * Quoting is the security-relevant part: a term containing GitHub's own search
 * qualifiers (`repo:`, `is:`, `label:`) would otherwise let a reporter redirect
 * the search at another repository. Dropping every non-word character means the
 * terms that survive cannot carry a qualifier at all.
 */
export function duplicateSearchTerms(title: string, description: string): string[] {
  const stopwords = new Set([
    // English
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "has",
    "not",
    "but",
    "are",
    "was",
    "were",
    "when",
    "what",
    "why",
    "how",
    "does",
    "did",
    "can",
    "cannot",
    "all",
    "any",
    "you",
    "your",
    "its",
    "it's",
    "there",
    "then",
    "than",
    "into",
    "over",
    "under",
    "page",
    // German
    "der",
    "die",
    "das",
    "und",
    "oder",
    "aber",
    "nicht",
    "kein",
    "keine",
    "ist",
    "sind",
    "war",
    "waren",
    "wenn",
    "wann",
    "was",
    "warum",
    "wie",
    "kann",
    "nur",
    "auch",
    "eine",
    "einen",
    "einem",
    "eines",
    "für",
    "mit",
    "von",
    "zum",
    "zur",
    "den",
    "dem",
    "des",
    "auf",
    "aus",
    "seite",
    "wird",
    "werden",
    "sich",
    "man",
    "beim",
    "bei",
  ])
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of `${title} ${description}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    // Long enough to be distinctive, short enough to be a word rather than a
    // pasted identifier.
    if (raw.length < 4 || raw.length > 24) continue
    if (stopwords.has(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    terms.push(raw)
    // GitHub's search relevance falls off past a handful of terms, and a long
    // query is more likely to match nothing than to match better.
    if (terms.length >= 8) break
  }
  return terms
}
