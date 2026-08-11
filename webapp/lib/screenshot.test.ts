import { describe, expect, test } from "bun:test"
import { pairTrees, type WalkableNode } from "@/lib/screenshot"

/**
 * The screenshot's tree pairing — behavioural, against a hand-built tree.
 *
 * ## Why this file exists
 *
 * The redaction walk was wrong in a way no test in this repository could see.
 * It advanced two live `TreeWalker`s while *mutating* the clone as it went, so
 * the first redaction desynchronised them: every subsequent pairing matched one
 * element and blanked an unrelated one, and the clone walk exhausted early so
 * the tail of the page was never examined.
 *
 * The consequence on the real page was specific and severe. `<input>`,
 * `<textarea>` and `<select>` survived by accident — `assertFormControlsRedacted`
 * is a *separate* backstop that removes any form control lacking
 * `data-redacted`, so form values were protected by a different mechanism
 * entirely. The account surfaces have **no** such backstop, and the Radix
 * account menu carrying the reader's name and email address mounts last in
 * `<body>`, which is precisely the region the truncated walk never reached.
 *
 * So the previous verification — a screenshot with every `<input>` filled,
 * photographed and inspected — exercised only the backstopped path and read as
 * confirmation. That is the failure this file is designed to make impossible to
 * repeat: it asserts *coverage of specific nodes*, not that a function ran.
 *
 * ## Why a hand-built tree rather than a DOM
 *
 * `happy-dom` / `jsdom` are not dependencies of this webapp and adding one to
 * test a traversal would be a large dependency for a small guarantee. The bug
 * was never in the DOM API — it was in the traversal order and in mutating
 * mid-walk — so `pairTrees` takes a structural `WalkableNode` and the tree
 * below is built by hand. `children` is the only property it needs, which is
 * what makes that possible.
 */

/** A node in the model tree. `children` satisfies `WalkableNode`; `name` and
 * `redacted` are the test's own bookkeeping. */
type Node = WalkableNode & {
  name: string
  children: Node[]
  redacted?: boolean
}

function node(name: string, ...children: Node[]): Node {
  return { name, children }
}

/** A deep copy, standing in for `cloneNode(true)`. */
function clone(n: Node): Node {
  return { name: n.name, children: n.children.map(clone) }
}

/**
 * The real page's shape, reduced to what matters.
 *
 * The ordering is load-bearing and taken from the app: the sidebar account
 * trigger comes early and **has children** (avatar + name span), ordinary
 * content follows, and the Radix-portalled account menu — display name and
 * email — mounts **last**, inside its own portal wrapper.
 *
 * Every one of those details is what the broken walk depended on. The trigger's
 * two children are the offset the first redaction introduced; the portal
 * wrapper is the extra level of depth that pushed the menu past the point where
 * the truncated clone walk gave up. Replayed against the old algorithm this
 * tree yields `account menu redacted? false` with the reader's name and email
 * intact, and `p-content` blacked out in their place.
 */
function page(): Node {
  return node(
    "body",
    node("aside", node("button-account", node("svg-avatar"), node("span-name"))),
    node("main", node("form", node("input-search"), node("input-filter")), node("p-content")),
    // The portal wrapper Radix mounts at the end of <body>, and the menu inside
    // it carrying the reader's identity.
    node("div-portal", node("div-account-menu", node("span-username"), node("span-email"))),
  )
}

/** Marks `[data-feedback-account]`-equivalent and form-control nodes. */
const REDACT = new Set(["button-account", "div-account-menu", "input-search", "input-filter"])

/** Runs the real pairing and applies the real mutation shape — blanking the
 * clone node's subtree, exactly as `redactNode` does. */
function redactViaPairing(live: Node, cloned: Node): { redacted: number; clone: Node } {
  let redacted = 0
  for (const [from, to] of pairTrees(live, cloned)) {
    if (!REDACT.has((from as Node).name)) continue
    const target = to as Node
    // `redactNode`'s destructive step: the subtree goes away.
    target.children = []
    target.redacted = true
    redacted++
  }
  return { redacted, clone: cloned }
}

function find(n: Node, name: string): Node | null {
  if (n.name === name) return n
  for (const child of n.children) {
    const hit = find(child, name)
    if (hit) return hit
  }
  return null
}

function names(n: Node): string[] {
  return [n.name, ...n.children.flatMap(names)]
}

describe("pairTrees", () => {
  test("pairs every node in pre-order", () => {
    const live = page()
    const pairs = pairTrees(live, clone(live))
    expect(pairs.map(([from]) => (from as Node).name)).toEqual(names(live))
  })

  test("pairs each live node with its structural counterpart, never a cousin", () => {
    const live = page()
    const pairs = pairTrees(live, clone(live))
    for (const [from, to] of pairs) {
      expect((to as Node).name).toBe((from as Node).name)
    }
  })

  test("covers the whole tree — no early exhaustion", () => {
    // The old walk stopped after 8 of 13 elements. Pairing every node is the
    // property that makes "the tail of the page was never examined" impossible.
    const live = page()
    expect(pairTrees(live, clone(live)).length).toBe(names(live).length)
  })

  test("does not mutate either tree", () => {
    const live = page()
    const cloned = clone(live)
    const before = names(cloned)
    pairTrees(live, cloned)
    expect(names(cloned)).toEqual(before)
  })

  test("truncates rather than throwing when the trees disagree in shape", () => {
    const live = node("body", node("a"), node("b"))
    const short = node("body", node("a"))
    // A capture must degrade, never throw mid-way and abort the screenshot.
    expect(() => pairTrees(live, short)).not.toThrow()
    expect(pairTrees(live, short).map(([, to]) => (to as Node).name)).toEqual(["body", "a"])
  })
})

describe("redaction coverage (the P0 regression)", () => {
  test("redacts the account menu that mounts after an earlier redaction", () => {
    // THE regression. The account button is redacted first and has two
    // children; under the old lockstep walk that offset the clone walker by two
    // and the account menu — last in the document — was never reached.
    const live = page()
    const { clone: out } = redactViaPairing(live, clone(live))

    const menu = find(out, "div-account-menu")
    expect(menu).not.toBeNull()
    expect(menu?.redacted).toBe(true)
    // The reader's name and email are gone from the clone entirely.
    expect(names(out)).not.toContain("span-username")
    expect(names(out)).not.toContain("span-email")
  })

  test("redacts every marked node and nothing else", () => {
    const live = page()
    const { clone: out } = redactViaPairing(live, clone(live))

    // An innocent node was blacked out in the account menu's place under the
    // old walk. Nothing unmarked may be redacted.
    const content = find(out, "p-content")
    expect(content?.redacted).toBeUndefined()

    const button = find(out, "button-account")
    expect(button?.redacted).toBe(true)
    expect(button?.children).toEqual([])
  })

  test("the reported count equals the number of marked nodes actually covered", () => {
    // `redactedCount` is shown to the reporter as "N Bereiche wurden
    // automatisch geschwärzt". Under the old walk it counted *calls*, so it
    // read as confirmation while being independent of whether the right nodes
    // were covered. It must be a count of real coverage.
    const live = page()
    const { redacted, clone: out } = redactViaPairing(live, clone(live))
    const actuallyRedacted = (function count(n: Node): number {
      return (n.redacted ? 1 : 0) + n.children.reduce((sum, c) => sum + count(c), 0)
    })(out)
    expect(redacted).toBe(actuallyRedacted)
    expect(redacted).toBe(REDACT.size)
  })

  test("a redaction late in the tree does not disturb earlier siblings", () => {
    const live = page()
    const { clone: out } = redactViaPairing(live, clone(live))
    // The form's own inputs are marked, but the paragraph beside them is not
    // and must keep its identity.
    expect(find(out, "p-content")).not.toBeNull()
    expect(find(out, "input-search")?.redacted).toBe(true)
    expect(find(out, "input-filter")?.redacted).toBe(true)
  })
})
