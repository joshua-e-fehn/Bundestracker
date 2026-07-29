import { describe, expect, test } from "bun:test"
import { withFollow, withoutFollow } from "./userPreferences"

/**
 * The follow list's set semantics, and the two properties they exist for.
 *
 * `followMP` and `unfollowMP` are deliberately *not* one `toggleFollow`, and
 * the module's own header says why: following someone already followed must be
 * a no-op, so a double-tap or an HTTP retry after a dropped response cannot
 * silently unfollow. That is a claim about behaviour, and it is exactly the
 * kind of claim that survives a refactor into a toggle without anything
 * failing — until a reader on a slow connection presses a button twice and
 * finds themselves not following someone they meant to follow.
 *
 * So the rule is pulled out of the handlers as two pure functions
 * (convex/userPreferences.ts) and pinned here, in the same shape
 * `convex/votes.ts` exports `tallyByGroup` for `votes.test.ts`: `bun test` has
 * no Convex runtime, so a handler test is not available, but the handlers are
 * now two lines of plumbing around a rule that is fully testable.
 *
 * The **null** return is part of the contract rather than an implementation
 * detail: it means "no write needed", and it is what stops a no-op from
 * stamping `updatedAt` on a row nobody changed.
 */

const A = "bt-11005032"
const B = "bt-11004282"
const C = "bt-11004723"

describe("withFollow", () => {
  test("adds to an empty list", () => {
    expect(withFollow([], A)).toEqual([A])
  })

  test("appends rather than replacing", () => {
    expect(withFollow([A, B], C)).toEqual([A, B, C])
  })

  test("following someone already followed asks for no write", () => {
    // The property the two-mutation API exists for. A toggle would return
    // `[B]` here — an unfollow the reader did not ask for, produced by a
    // duplicate request they may not even have made.
    expect(withFollow([A, B], A)).toBeNull()
    expect(withFollow([A], A)).toBeNull()
  })

  test("is idempotent under repetition, not alternating", () => {
    // Applied twice, the second call is the no-op. Written as the sequence a
    // dropped response actually produces: the client sends follow, times out,
    // and sends follow again.
    const first = withFollow([], A)
    expect(first).toEqual([A])
    expect(withFollow(first ?? [], A)).toBeNull()
  })

  test("does not mutate the list it was given", () => {
    // The stored array comes straight off a Convex document. Mutating it in
    // place would make the "no write needed" signal a lie — the row would
    // already have changed by the time the caller decided not to patch.
    const before = [A, B]
    withFollow(before, C)
    expect(before).toEqual([A, B])
  })

  test("distinguishes ids that merely share a prefix", () => {
    // `internalId`s are minted with a common `bt-` prefix, so a substring test
    // here would silently refuse to follow a second member whose id contained
    // the first's.
    expect(withFollow(["bt-1100"], "bt-11005032")).toEqual(["bt-1100", "bt-11005032"])
  })
})

describe("withoutFollow", () => {
  test("removes the named id and keeps the rest in order", () => {
    expect(withoutFollow([A, B, C], B)).toEqual([A, C])
  })

  test("removing the last one leaves an empty list, not null", () => {
    // Empty and "nothing to do" are different answers: this one is a write.
    expect(withoutFollow([A], A)).toEqual([])
  })

  test("unfollowing someone not followed asks for no write", () => {
    expect(withoutFollow([A, B], C)).toBeNull()
    expect(withoutFollow([], A)).toBeNull()
  })

  test("removes every copy if the row somehow holds duplicates", () => {
    // Not reachable through `withFollow`, which refuses to add a second copy —
    // but a concurrent double-write or a hand-edited row could produce it, and
    // an unfollow that removed only the first would look like it had failed.
    expect(withoutFollow([A, B, A], A)).toEqual([B])
  })

  test("does not mutate the list it was given", () => {
    const before = [A, B]
    withoutFollow(before, A)
    expect(before).toEqual([A, B])
  })
})

describe("the two are exact inverses", () => {
  test("follow then unfollow returns the original list", () => {
    const start = [A, B]
    const followed = withFollow(start, C)
    expect(withoutFollow(followed ?? [], C)).toEqual(start)
  })

  test("a no-op in one direction is a write in the other", () => {
    // The property that makes them a pair rather than two similar functions:
    // for any (list, id), exactly one of the two has something to do.
    for (const list of [[], [A], [A, B], [A, B, C]]) {
      for (const id of [A, B, C, "bt-9999999"]) {
        const added = withFollow(list, id)
        const removed = withoutFollow(list, id)
        expect({
          list,
          id,
          exactlyOneWrites: (added === null) !== (removed === null),
        }).toEqual({ list, id, exactlyOneWrites: true })
      }
    }
  })
})

/**
 * The API shape itself, asserted against the source text.
 *
 * `withFollow`/`withoutFollow` above are the rule; this is the *interface*
 * decision the module's header argues for at length — that there is no
 * `toggleFollow`, and that no function here takes a `userId`. Both are
 * security- and correctness-relevant in a way a type cannot express:
 *
 *  - A `userId` **argument** would let any signed-in caller read or rewrite
 *    anyone else's preferences by supplying their id. The header states that no
 *    check inside a handler fixes an API whose shape invites it, and the only
 *    enforcement of that is the shape staying as it is.
 *  - A `toggleFollow` would pass every test above — because it would delete
 *    these two functions along with them — while reintroducing the retry bug
 *    the split exists to prevent.
 *
 * Read from the text for the same reason components/sidebar-account.test.ts is:
 * there is no runtime here in which to call a Convex mutation, and the property
 * is about what the module *offers*, not about what one call returns.
 *
 * `Bun.file` rather than `node:fs`: this file sits under `convex/`, whose
 * default runtime is a V8 isolate with no Node builtins. `*.test.ts` is not a
 * Convex entry point and is never bundled (see scripts/check-codegen.ts), but
 * the repo's lint holds the whole directory to that rule rather than trusting
 * the exclusion, and a global that needs no import satisfies both.
 */
// Top level rather than inside the `describe`, whose callback is synchronous.
const source = await Bun.file(new URL("./userPreferences.ts", import.meta.url)).text()
/** The module with its comments stripped, so a rule named in prose — every one
 * of the shapes below is discussed at length up there — does not satisfy a test
 * looking for it in code. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the exported API keeps its shape", () => {
  test("no function accepts a userId argument", () => {
    // Every handler takes it from the session via `requireUserId`/`getUserId`.
    // A `userId: v.string()` in an args object is the failure, and it would
    // typecheck and deploy perfectly.
    expect(code).not.toMatch(/userId:\s*v\./)
  })

  test("follow and unfollow are separate mutations, not a toggle", () => {
    expect(code).toMatch(/export const followMP = mutation\(/)
    expect(code).toMatch(/export const unfollowMP = mutation\(/)
    expect(code).not.toMatch(/toggleFollow/)
  })

  test("every mutation goes through requireUserId", () => {
    // `getUserId` returns null for an anonymous caller, which is right for the
    // queries — every page renders signed out — and wrong for a write: it would
    // silently drop the change, or throw somewhere further in. Counted rather
    // than merely present, so adding a third mutation that forgets is caught.
    const mutations = code.match(/= mutation\(/g) ?? []
    const requires = code.match(/await requireUserId\(ctx\)/g) ?? []
    expect({ mutations: mutations.length, requires: requires.length }).toEqual({
      mutations: mutations.length,
      requires: mutations.length,
    })
  })
})
