import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The authorization gate: every public feedback function requires a session,
 * and every control that offers one requires the same.
 *
 * ## Why these are source assertions
 *
 * `bun test` has no Convex runtime, so a handler cannot be called and an
 * anonymous caller cannot be simulated — the constraint convex/feedback.test.ts
 * opens with, and the reason its rate-limit rule is a pure function. An
 * authorization check is not a pure function: it is the *first statement of a
 * handler*, and whether it is there is a property of the source.
 *
 * lib/feedback-boundaries.test.ts makes the same argument for the privacy
 * boundary and states the rule these follow: a source assertion is a blunt
 * instrument, used only where the alternative is no assertion at all. It is
 * warranted here for the same reason it was there — the breach would be both
 * invisible in review and severe. A `requireUserId` deleted from one of four
 * handlers reopens an unauthenticated public write path, and nothing else in the
 * suite would notice.
 *
 * The behavioural half is not skipped, it is elsewhere: `requireUserId` itself
 * is one branch over `safeGetAuthUser` (convex/lib/auth.ts), the credential
 * logic is exercised in lib/github-token.test.ts, and the end-to-end proof that
 * an anonymous caller is actually refused by a deployed Convex instance is the
 * live-production runbook in docs/verification/feedback-reporting.md §Live
 * production acceptance. A test file cannot prove that one; only production can.
 *
 * ⚠ These tests read files by path. A rename breaks them loudly, which is
 * correct: the guarantee moved, and someone has to say where to.
 */

const root = new URL("../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")

/** Source with comments removed, so an assertion is about the code rather than
 * about the prose describing it — these files discuss `requireUserId` at
 * length. The technique and the caveat are lib/feedback-boundaries.test.ts's. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

const feedbackCode = code("convex/feedback.ts")

/**
 * The body of one exported Convex function, by name.
 *
 * Bounded by the next `export const`, which is how this file is laid out. An
 * assertion over the whole module would pass because *some other* handler
 * carries the check — the failure this is designed to catch is exactly one
 * handler losing it.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} = `)
  expect(start).toBeGreaterThan(-1)
  const next = source.indexOf("\nexport const ", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

/**
 * The four functions the browser can call, and how each must behave for a
 * caller with no session.
 *
 * `isConfigured` is deliberately the one that does not throw: it is what the UI
 * asks *before* it has a session to offer, so refusing it would make the
 * signed-out state unrenderable. It answers two booleans and touches nothing.
 */
const PUBLIC_FUNCTIONS = [
  { name: "submitReport", gated: true },
  { name: "generateScreenshotUploadUrl", gated: true },
  { name: "findDuplicates", gated: true },
  { name: "isConfigured", gated: false },
] as const

describe("every public feedback function requires a session", () => {
  for (const { name } of PUBLIC_FUNCTIONS.filter((f) => f.gated)) {
    test(`${name} calls requireUserId`, () => {
      expect(functionBody(feedbackCode, name)).toContain("requireUserId(ctx)")
    })
  }

  test("isConfigured stays callable without one", () => {
    // The UI's own question. It must answer for an anonymous visitor, or the
    // signed-out rendering has nothing to render from.
    const body = functionBody(feedbackCode, "isConfigured")
    expect(body).not.toContain("requireUserId")
    expect(body).toContain("getUserId(ctx)")
  })

  test("the gate is the first await in each handler, before any effect", () => {
    // ⚠ Ordering is load-bearing rather than stylistic.
    //
    // `findDuplicates` charges a search budget and then spends the deployment's
    // GitHub quota; `generateScreenshotUploadUrl` writes a row and mints a
    // storage URL; `submitReport` reads three indexes and can delete a file.
    // A check *after* any of those means an anonymous caller still consumed
    // something on their way to being refused.
    for (const { name } of PUBLIC_FUNCTIONS.filter((f) => f.gated)) {
      const body = functionBody(feedbackCode, name)
      const handlerStart = body.indexOf("handler:")
      const gate = body.indexOf("requireUserId(ctx)", handlerStart)
      const firstOtherAwait = [
        body.indexOf("await ctx.db", handlerStart),
        body.indexOf("await ctx.storage", handlerStart),
        body.indexOf("await ctx.runMutation", handlerStart),
        body.indexOf("await ctx.scheduler", handlerStart),
        body.indexOf("await fetch", handlerStart),
        body.indexOf("credentialFor(", handlerStart),
      ].filter((index) => index > -1)

      expect(gate).toBeGreaterThan(-1)
      for (const other of firstOtherAwait) expect(gate).toBeLessThan(other)
    }
  })

  test("no public function takes a userId argument", () => {
    // A caller-supplied id would let a signed-in user file under someone else's
    // name — the rule convex/userPreferences.ts states, restated here because
    // the gate makes `userId` a guaranteed column and an argument would look
    // like a natural way to fill it.
    for (const { name } of PUBLIC_FUNCTIONS) {
      const body = functionBody(feedbackCode, name)
      const argsEnd = body.indexOf("handler:")
      expect(body.slice(0, argsEnd)).not.toContain("userId")
    }
  })

  test("the three internal-only entry points stay internal", () => {
    // `claimSearchBudget` spends quota, `getPrivateReport` returns the
    // reporter's email address, and `publishReport` holds the GitHub
    // credential. Any of them promoted to `query(`/`mutation(`/`action(` would
    // be reachable from a browser.
    for (const name of ["claimSearchBudget", "getPrivateReport", "publishReport"]) {
      const declaration = functionBody(feedbackCode, name).split("\n")[0]
      expect(declaration).toMatch(/= internal(Query|Mutation|Action)\(/)
    }
  })

  test("the module has exactly the public functions this file knows about", () => {
    // A new public function added without a session check would otherwise be
    // invisible to every test above, which assert over a fixed list. This is
    // what makes the list a closed set rather than a sample.
    const declared = [...feedbackCode.matchAll(/export const (\w+) = (query|mutation|action)\(/g)]
    expect(declared.map((match) => match[1]).sort()).toEqual(
      PUBLIC_FUNCTIONS.map((f) => f.name).sort(),
    )
  })
})

describe("the credential never becomes reachable from a public caller", () => {
  test("no public function reads the App private key", () => {
    // Only convex/lib/githubToken.ts may read these. A public handler that
    // did could be timed, and a mutation cannot fetch — so the only reason to
    // hold one here would be to return it.
    for (const { name } of PUBLIC_FUNCTIONS) {
      const body = functionBody(feedbackCode, name)
      expect(body).not.toContain("GITHUB_APP_PRIVATE_KEY")
      expect(body).not.toContain("GITHUB_APP_ID")
    }
  })

  test("isConfigured reports booleans, never a credential", () => {
    const body = functionBody(feedbackCode, "isConfigured")
    expect(body).toContain("v.object({ configured: v.boolean(), signedIn: v.boolean() })")
    expect(body).not.toContain("GITHUB_FEEDBACK_TOKEN")
    expect(body).not.toContain("process.env.GITHUB_APP")
  })

  test("the token module never logs", () => {
    // A `console.error(error)` on a failed mint is exactly how a private key
    // reaches a deployment log: the thrown error can quote its input.
    const tokenCode = code("convex/lib/githubToken.ts")
    expect(tokenCode).not.toMatch(/console\./)
    expect(code("lib/github-app.ts")).not.toMatch(/console\./)
  })

  test("the two GitHub API roots agree", () => {
    // The token mint and the calls it authenticates must reach the same host,
    // or a stubbed verification run would authenticate against one and publish
    // to the other. Duplicated deliberately (see the note on `githubApiBase`);
    // this is what keeps the duplicate honest.
    const shape = /process\.env\.GITHUB_API_BASE \?\? "https:\/\/api\.github\.com"/
    expect(feedbackCode).toMatch(shape)
    expect(code("convex/lib/githubToken.ts")).toMatch(shape)
  })

  test("a failure reason is a fixed string, never an interpolated value", () => {
    // `failureReason` is stored and read by an operator. The App arm may name
    // which variable is wrong; it may never quote what was in it.
    const publish = functionBody(feedbackCode, "publishReport")
    // A pattern rather than a literal, for the reason lib/feedback-boundaries.
    // test.ts gives: the text being asserted about *is* an interpolation, and
    // writing it as a string trips `noTemplateCurlyInString` on a file that is
    // deliberately quoting source.
    expect(publish).toMatch(/`github-\$\{credential\.failure\}`/)
    expect(publish).not.toMatch(/failureReason: `[^`]*\$\{(token|credential\.token|jwt)/)
  })
})

describe("the UI offers the control exactly when the server would accept it", () => {
  const widget = code("components/feedback-widget.tsx")
  const available = code("components/use-feedback-available.ts")

  test("all three controls consult one shared rule", () => {
    // Three copies of the condition would drift, and a drifted copy renders a
    // control whose calls the server refuses.
    for (const path of [
      "components/feedback-widget.tsx",
      "components/nav-sidebar.tsx",
      "components/nav-mobile.tsx",
    ]) {
      expect(code(path)).toContain("useFeedbackAvailable()")
    }
  })

  test("the rule requires configured, signed in, and mounted", () => {
    expect(available).toContain("status?.configured === true")
    expect(available).toContain("status.signedIn === true")
    // The hydration contract: a control that appears between the server's HTML
    // and the client's first render is React #418, which in React 19 detaches
    // <head>. See components/sidebar-account.tsx.
    expect(available).toContain("mounted")
  })

  test("the signed-in half comes from the server, not the browser's session store", () => {
    // Better Auth's store can hold a session Convex will not authorise. Reading
    // the browser's opinion would render a control whose every call throws.
    expect(available).toContain("api.feedback.isConfigured")
    expect(available).not.toContain("authClient.useSession")
  })

  test("the widget renders nothing when the rule is false", () => {
    expect(widget).toContain("if (!available) return null")
  })

  test("the trigger is not merely hidden with CSS", () => {
    // `hidden`/`sr-only` on the trigger would leave it in the DOM and clickable
    // by anything scripting the page, and would suggest the check is cosmetic.
    // It is a rendering decision on top of a server gate, and returning null is
    // what says so.
    const triggerIndex = widget.indexOf('data-feedback-id="open-feedback"')
    expect(triggerIndex).toBeGreaterThan(-1)
    expect(widget.indexOf("if (!available) return null")).toBeLessThan(triggerIndex)
  })
})
