import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * A guard on how `ThemeColorSync` disposes of the static `theme-color` tags.
 *
 * ## The bug
 *
 * The effect used to call `stale.remove()` on the two `media`-qualified
 * `<meta name="theme-color">` tags that `app/layout.tsx` declares through its
 * `viewport` export. Those tags are rendered by *React*, so React holds
 * references to them and expects to own their lifetime. Detaching them meant
 * the next reconciliation of `<head>` called `removeChild` on a node whose
 * `parentNode` was already `null`:
 *
 *   Uncaught TypeError: Cannot read properties of null (reading 'removeChild')
 *
 * thrown on **every client-side navigation**, on every route, in every locale.
 * It tore down the React tree, which is how it was found: the mobile navigation
 * drawer stopped closing after a link was tapped, because the state update that
 * closes it never ran. Reproduced afterwards on a plain footer link with no
 * overlay on screen at all, which is what showed it had nothing to do with
 * navigation chrome and had been there all along.
 *
 * ## Why the test is written against the source text
 *
 * The failure needs three things at once — React rendering the head, a
 * client-side route change, and a reconciliation afterwards — and none of them
 * exist under `bun test`, which has no DOM. A jsdom harness would not reproduce
 * it either, because the crash is in React's own commit phase against nodes it
 * believes it owns; jsdom would happily let the element be removed and nothing
 * would throw.
 *
 * So this asserts the one property that is actually checkable here and that is
 * exactly the thing that regressed: the effect does not detach a node it did
 * not create. It is a coarse test, and it is honest about being one — the real
 * verification is in the browser (docs/screenshots/navigation, and the console
 * pass in docs/navigation-ia.md). What it buys is that the tempting one-line
 * "simplification" back to `.remove()` fails here rather than in a reader's
 * browser three weeks later.
 */

const source = readFileSync(new URL("./theme-color.tsx", import.meta.url).pathname, "utf8")

describe("ThemeColorSync does not detach React-owned nodes", () => {
  test("the static tags are neutralised rather than removed", () => {
    // `remove()` and `removeChild(` are the two ways to detach the tags. Either
    // one reintroduces the crash. `meta.remove` in a comment is fine — the
    // check looks for a call.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(withoutComments).not.toMatch(/\.remove\(\s*\)/)
    expect(withoutComments).not.toMatch(/removeChild\s*\(/)
  })

  test("it switches the static tags off with a query that cannot match", () => {
    // The replacement behaviour. `not all` is the standard "matches nothing"
    // media query; the tags stay in the document, where React put them, and the
    // browser ignores them — which is all the effect needed from removing them.
    expect(source).toContain('"not all"')
    expect(source).toMatch(/setAttribute\(\s*"media"/)
  })

  test("it still writes an unqualified tag, which is the point of the module", () => {
    // Guarding against the opposite over-correction: a version that stops
    // touching the tags at all would pass the two tests above and leave the
    // status bar disagreeing with the page, which is the bug this module was
    // written to fix in the first place.
    expect(source).toMatch(/theme-color"\]:not\(\[media\]\)/)
    expect(source).toMatch(/head\.appendChild/)
  })
})
