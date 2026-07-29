import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * A guard on the desktop bar's group menus being *non-modal*.
 *
 * ## The bug
 *
 * `DropdownMenu` is Radix's, and its `modal` prop defaults to `true`. A modal
 * menu applies three things to the rest of the document for as long as it is
 * open:
 *
 *  - `hideOthers(content)` — `aria-hidden="true"` on every sibling of the
 *    panel, `<main>` included.
 *  - `disableOutsidePointerEvents` — `pointer-events: none` on `<body>`.
 *  - `trapFocus` — focus cannot leave the panel.
 *
 * That is the correct treatment for a menu the reader deliberately clicked
 * open. This bar opens its menus on **hover**, and under that trigger the same
 * three become bugs, all three observed in Chromium against a production build
 * rather than reasoned about:
 *
 *   body while menu open: {"bodyPointerEvents":"none","mainAriaHidden":"true"}
 *   FAIL  hovering a sibling group swaps the menu
 *
 * The sibling failure is the one that mattered. Moving the pointer along the
 * bar from one group to the next — the most ordinary thing there is to do with
 * a grouped navigation — did nothing, because the trigger being moved onto sat
 * in a body whose pointer events had been switched off by the menu that was
 * already open. The reader had to click away first. The other two are worse in
 * kind if less visible: a page made unclickable by a mouse movement the reader
 * did not mean as a commitment, and `<main>` hidden from assistive technology
 * for as long as a pointer rested on the bar.
 *
 * ## Why the test is written against the source text
 *
 * Same reason as components/providers/theme-color.test.ts, which this follows:
 * reproducing it needs a real layout engine and a real pointer. `bun test` has
 * no DOM, and jsdom has no hover, no `getComputedStyle` worth trusting for
 * this, and does not run Radix's layer bookkeeping. The browser smoke is the
 * real verification — it asserts the three properties directly and is what
 * caught this.
 *
 * What this buys is that deleting the prop, which reads like removing a
 * redundant `false`, fails here rather than in a reader's browser.
 */

const source = readFileSync(new URL("./nav-desktop.tsx", import.meta.url).pathname, "utf8")

/** The file with comments stripped, so a prop *named* in the prose above does
 * not satisfy a check looking for the prop being *passed*. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the desktop group menus are non-modal", () => {
  test("DropdownMenu is passed modal={false}", () => {
    // Radix defaults this to `true`. Omitting it is not neutral — it is opting
    // the bar back into aria-hiding `<main>` and disabling pointer events on
    // the body every time a pointer crosses a group name.
    expect(code).toMatch(/modal=\{false\}/)
  })

  test("every DropdownMenu root in this file sets it", () => {
    // Written as a count rather than a single match so that a second group menu
    // added later has to make the same decision explicitly. `<DropdownMenu ` (a
    // root) is matched but `<DropdownMenuTrigger`/`Content`/`Item` are not.
    const roots = code.match(/<DropdownMenu(?=[\s>])/g) ?? []
    const nonModal = code.match(/modal=\{false\}/g) ?? []
    expect({ roots: roots.length, nonModal: nonModal.length }).toEqual({
      roots: roots.length,
      nonModal: roots.length,
    })
  })
})

describe("hover-opening stays pointer-aware", () => {
  test("hover handlers ignore anything that is not a mouse", () => {
    // On a touch screen every tap synthesises a pointer-enter, so a hover-open
    // menu without this fires on the tap that was meant to follow the link —
    // the menu opens and immediately closes. Both handlers need the guard, not
    // just the one that opens.
    const guards = code.match(/event\.pointerType\s*!==\s*"mouse"/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(2)
  })

  test("the close timer is cleared on unmount", () => {
    // A menu unmounted mid-hover would otherwise leave a timeout calling
    // `setOpen` on a component that is gone.
    expect(code).toMatch(/clearTimeout/)
  })
})
