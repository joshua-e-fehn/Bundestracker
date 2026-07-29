import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * A guard on the hydration contract of the header's session-dependent slot.
 *
 * ## The bug
 *
 * `UserMenu` branched straight off `authClient.useSession()`: `<Skeleton>` — a
 * `<div>` — while `isPending`, and the signed-out `<Button asChild><Link>` — an
 * `<a>` — once it was not. The server has no session, so the server HTML always
 * held the `<div>`; on the client the session can resolve before React
 * hydrates, and the first client render then put an `<a>` in that slot.
 *
 * A differing element *type* at the same position throws:
 *
 *   Hydration failed because the server rendered HTML didn't match the client
 *   (minified #418, args[]=HTML)
 *
 * React regenerates the tree, which in React 19 detaches the whole of `<head>`.
 * Every hoisted `<meta>`/`<link>` is then parentless, so the next commit — the
 * reader's first navigation — dies in the tag-26 unmount path with
 * "Cannot read properties of null (reading 'removeChild')" and the click is
 * swallowed. On production that read as: on a cold load, the first click on an
 * MP link does nothing.
 *
 * ## Why the test is written against the source text
 *
 * The same reason as components/providers/theme-color.test.ts, which guards a
 * neighbouring failure in the same `<head>`: reproducing this needs a real
 * server render, a real hydration pass, and a race between hydration and an
 * async session — none of which exist under `bun test`, which has no DOM. jsdom
 * would not help either, because the throw is in React's own hydration
 * commit.
 *
 * The real verification is the browser test,
 * scripts/verify-first-click-navigation.mjs, which reproduces the failure
 * end-to-end under CPU throttling and is what proved the fix. This buys the
 * cheap half: the tempting "the `mounted` flag is redundant, `isPending`
 * already covers it" cleanup fails here, in CI, rather than on a reader's phone.
 */

const source = readFileSync(new URL("./user-menu.tsx", import.meta.url).pathname, "utf8")

const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("UserMenu cannot change element type on hydration", () => {
  test("it gates the first render on a mount flag, not only on isPending", () => {
    // The flag has to exist and be set from an effect — effects run only after
    // hydration commits, which is the whole mechanism.
    expect(withoutComments).toMatch(/useState\(false\)/)
    expect(withoutComments).toMatch(/useEffect\(\(\)\s*=>\s*setMounted\(true\)\s*,\s*\[\]\)/)
  })

  test("the skeleton branch is taken until mounted", () => {
    // `!mounted || isPending` — not `isPending` alone, which is the regression.
    // The skeleton is what the server renders, so this is what pins the first
    // client render to the server's output.
    expect(withoutComments).toMatch(/if\s*\(\s*!mounted\s*\|\|\s*isPending\s*\)/)
  })

  test("the signed-out branch still renders a link to /sign-in", () => {
    // Guarding the opposite over-correction: a version that renders the
    // skeleton forever would pass the checks above and leave the header with no
    // way to sign in at all.
    expect(withoutComments).toMatch(/href="\/sign-in"/)
  })
})

/**
 * The same guard is needed everywhere a component branches on
 * `authClient.useSession()` in a way that changes the element *type*, because
 * the blast radius is not the component: React regenerates from the root and
 * detaches `<head>` wherever the mismatch happened. These are the other two
 * places that branch on it.
 */
describe("every session-dependent branch is hydration-guarded", () => {
  const read = (name: string) =>
    readFileSync(new URL(name, import.meta.url).pathname, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")

  test("SignInPanel gates its already-signed-in branch on mount", () => {
    // Server renders the provider buttons (a <div>); an unguarded client render
    // with a resolved session renders <p>. Different element type, same slot.
    const source = read("./sign-in-panel.tsx")
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*setMounted\(true\)\s*,\s*\[\]\)/)
    expect(source).toMatch(/\{\s*mounted\s*&&\s*session\s*\?/)
  })

  test("AuthGuard gates its spinner branch on mount", () => {
    // Unreachable while every path is public, which is why it is cheap to fix
    // now: it wraps the whole page, so it is the worst of the three if a
    // private route ever arrives. See lib/auth-routes.ts.
    const source = read("./providers/auth-guard.tsx")
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*setMounted\(true\)\s*,\s*\[\]\)/)
    expect(source).toMatch(/if\s*\(\s*!mounted\s*\|\|\s*isPending\s*\)/)
  })
})
