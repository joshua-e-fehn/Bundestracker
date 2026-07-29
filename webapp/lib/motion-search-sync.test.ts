import { describe, expect, test } from "bun:test"
import {
  initSearchSync,
  reduceSearchSync,
  type SearchSyncAction,
  type SearchSyncState,
} from "./motion-search-sync"

/**
 * The behavioural invariants of the `/motions` search sync.
 *
 * ## Why these tests exist
 *
 * A prior version of this logic — two `useEffect`s in components/motion-list.tsx
 * — had a browser Back/Forward flap: on a Reset followed by browser Back to
 * a prior history entry with a different `?q=`, the URL-observing effect fired
 * before the URL-mirroring effect had committed its `setState` and wrote the
 * URL back to its cleared form. The shared-linkable state was lost.
 *
 * Text inspection of the two effects would not have caught it — both were
 * present and both looked correct in isolation. The failure was a *sequence*,
 * so the fix is expressed as a reducer and the test drives sequences.
 *
 * The one guarantee that would have prevented that bug is the one asserted
 * below: **`urlChanged` never emits a commit effect**. Any transition that
 * arrives from Back, Forward, Reset, a shared link or a sibling filter
 * change is one that must not write the URL back.
 */

/** Walks the reducer through a script of actions, collecting the resulting
 * state and any effects emitted along the way. */
function drive(
  initial: SearchSyncState,
  actions: readonly SearchSyncAction[],
): { state: SearchSyncState; effects: string[] } {
  let state = initial
  const effects: string[] = []
  for (const action of actions) {
    const { next, effect } = reduceSearchSync(state, action)
    state = next
    if (effect) effects.push(`${effect.type}:${effect.value}`)
  }
  return { state, effects }
}

describe("initSearchSync", () => {
  test("adopts the current URL and schedules no write on mount", () => {
    // A fresh mount from a shared link `/motions?q=asyl` must not write the
    // URL back to itself — the URL is already `asyl`. This was one of the
    // failure modes of the old two-effect design.
    const state = initSearchSync("asyl")
    expect(state.local).toBe("asyl")
    expect(state.pending).toBeNull()
    // `lastSeenUrlQuery` seeds from the same value so a re-notification
    // during first render (React strict mode, an early sibling filter
    // click) is recognised as a no-op rather than as a URL change.
    expect(state.lastSeenUrlQuery).toBe("asyl")
  })

  test("mounts empty when the URL carries no query", () => {
    expect(initSearchSync("")).toEqual({
      local: "",
      pending: null,
      lastSeenUrlQuery: "",
    })
  })
})

describe("userTyped", () => {
  test("updates the local box and schedules a commit for the typed value", () => {
    // Every keystroke replaces the pending value: that is what makes the
    // debounce a debounce rather than a queue of writes.
    const { state, effects } = drive(initSearchSync(""), [
      { type: "userTyped", value: "a" },
      { type: "userTyped", value: "as" },
      { type: "userTyped", value: "asy" },
      { type: "userTyped", value: "asyl" },
    ])
    expect(state).toEqual({ local: "asyl", pending: "asyl", lastSeenUrlQuery: "" })
    // The critical property: **no commit fires until `commitFired` arrives**.
    // Typing alone never writes the URL — otherwise every keystroke would be
    // a history entry, which is the exact behaviour this component avoids.
    expect(effects).toEqual([])
  })
})

describe("commitFired", () => {
  test("emits a commit for the value the reader last typed", () => {
    const { effects } = drive(initSearchSync(""), [
      { type: "userTyped", value: "asyl" },
      { type: "commitFired", value: "asyl" },
    ])
    expect(effects).toEqual(["commit:asyl"])
  })

  test("drops a stale timer whose value has since changed", () => {
    // Debounce cancellation as a state transition. An earlier keystroke's
    // timer fires after a later keystroke has replaced `pending`; the
    // reducer sees the mismatch and does nothing. Without this, a rapid
    // typist could write intermediate values to the URL between keystrokes.
    const { effects } = drive(initSearchSync(""), [
      { type: "userTyped", value: "a" },
      { type: "userTyped", value: "as" },
      { type: "commitFired", value: "a" }, // the older timer fires
    ])
    expect(effects).toEqual([])
  })

  test("drops a timer that fires after the URL was cleared externally", () => {
    // A keystroke is in-flight; the reader Backs to a page whose `?q=` was
    // *different*. The reducer clears `pending`, and the pending timer's
    // `commitFired` — if the component failed to cancel it — arrives with
    // nothing to commit against.
    //
    // The prior version of this test used `urlChanged("")` with the same
    // value that was already known, which the `lastSeenUrlQuery` guard now
    // treats as a no-op (see the "sibling URL writes" block below). To
    // exercise the *real* URL-change case here, the initial URL is
    // `previous` and Back moves to `""`.
    const { effects } = drive(initSearchSync("previous"), [
      { type: "userTyped", value: "asyl" },
      { type: "urlChanged", urlQuery: "" },
      { type: "commitFired", value: "asyl" },
    ])
    expect(effects).toEqual([])
  })
})

describe("urlChanged — the flap-prevention invariant", () => {
  test("never emits a commit effect, for any URL transition", () => {
    // The exact regression the review's finding #1 traced, in one script:
    //
    //   1. reader is at ?q=asyl → local "asyl"
    //   2. Reset → urlChanged("") → local ""
    //   3. Back → urlChanged("asyl") → local "asyl"
    //
    // The old design wrote the URL back on step 3, undoing the Back button.
    // The reducer's `urlChanged` handler MUST NOT emit a commit — that is
    // the whole of the fix, and it is asserted for every reachable
    // transition below.
    const scripts: SearchSyncAction[][] = [
      // Fresh mount then Back to a prior entry with a query
      [{ type: "urlChanged", urlQuery: "asyl" }],
      // Reader had typed, Reset cleared the URL
      [
        { type: "userTyped", value: "asyl" },
        { type: "urlChanged", urlQuery: "" },
      ],
      // Reader had typed, sibling filter change rewrites the URL keeping ?q=
      [
        { type: "userTyped", value: "asyl" },
        { type: "urlChanged", urlQuery: "asyl" }, // no-op adoption
      ],
      // Full walk: type, commit, Back, Forward
      [
        { type: "userTyped", value: "asyl" },
        { type: "commitFired", value: "asyl" },
        { type: "urlChanged", urlQuery: "" }, // Back
        { type: "urlChanged", urlQuery: "asyl" }, // Forward
      ],
    ]
    for (const script of scripts) {
      const { effects } = drive(initSearchSync(""), script)
      // Filter down to whatever commits the script emitted. The first-typing
      // scripts do emit one from their `commitFired`; the pure `urlChanged`
      // sequences MUST NOT contribute any.
      const urlChangedCount = script.filter((a) => a.type === "urlChanged").length
      const commitCount = effects.filter((e) => e.startsWith("commit:")).length
      const typedCommits = script.filter((a) => a.type === "commitFired").length
      expect(commitCount).toBeLessThanOrEqual(typedCommits)
      // And no more than `typedCommits` — restating: each commit traces to a
      // `commitFired`, never to a `urlChanged`.
      expect(commitCount + urlChangedCount).toBeGreaterThan(0) // sanity: script does something
    }
  })

  test("cancels any pending write when the URL genuinely changes", () => {
    // The invariant restated as a state property. This is what lets the
    // component clean up its `setTimeout` on `pending === null`. The
    // qualifier "genuinely" matters: a same-value `urlChanged` is a
    // no-op under the `lastSeenUrlQuery` guard — asserted separately in
    // the "sibling URL writes" block below. Here the URL moves from
    // `previous` to `""`, which the reducer *does* adopt.
    const { state } = drive(initSearchSync("previous"), [
      { type: "userTyped", value: "asyl" },
      { type: "urlChanged", urlQuery: "" },
    ])
    expect(state.pending).toBeNull()
    // And the box shows the URL's version, not the discarded typing.
    expect(state.local).toBe("")
  })

  test("Back after Reset restores the query without a URL fight", () => {
    // The finding's failure trace, driven end to end. If any commit reaches
    // the URL during the two `urlChanged` transitions, the test fails and
    // the flap is back.
    const script: SearchSyncAction[] = [
      // At `/motions?q=asyl`
      { type: "userTyped", value: "asyl" },
      { type: "commitFired", value: "asyl" },
      // Reset — the URL becomes `/motions` (no `?q=`), which arrives here
      // as `urlChanged("")`.
      { type: "urlChanged", urlQuery: "" },
      // Reader clicks browser Back, restoring `/motions?q=asyl`.
      { type: "urlChanged", urlQuery: "asyl" },
    ]
    const { state, effects } = drive(initSearchSync(""), script)
    expect(state.local).toBe("asyl")
    // Exactly one commit — the reader's original typing. The two Back-driven
    // `urlChanged`s contributed nothing.
    expect(effects).toEqual(["commit:asyl"])
  })
})

describe("sibling URL writes do not erase in-flight typing", () => {
  /**
   * The regression the review's re-run pinned. The first fix closed the
   * Back/Forward flap at the reducer level (`urlChanged` never emits a
   * URL-write effect), but the component wiring re-introduced the same
   * class of failure through a different trigger: a user clicking a
   * *sibling* filter (kind, year, period) while typing rewrote the URL,
   * and the URL-observing effect re-fired with `?q=` unchanged from
   * before — clobbering the reader's typing.
   *
   * The reducer's `lastSeenUrlQuery` guard is what closes that at the
   * data-flow level. These tests fail on the pre-fix reducer (which
   * unconditionally cleared `pending` on every `urlChanged`) and pass
   * on the fixed one.
   */

  test("urlChanged with the same value the reducer already saw is a no-op", () => {
    // The exact scenario the reviewer described:
    //   1. Reader is on /motions?wp=21 with no ?q= set.
    //   2. Types "asyl" — pending is now "asyl", debounce timer scheduled.
    //   3. Before the timer fires, picks a kind → the URL becomes
    //      /motions?wp=21&kind=Kleine+Anfrage. `?q=` did not change.
    //   4. The URL-observing effect fires with the same urlQuery ("") the
    //      reducer already knows about.
    //   5. Pre-fix: pending cleared to null, local overwritten to "".
    //      Fixed: no-op; pending remains "asyl".
    const { state, effects } = drive(initSearchSync(""), [
      { type: "userTyped", value: "asyl" },
      { type: "urlChanged", urlQuery: "" },
    ])
    expect(state.local).toBe("asyl")
    expect(state.pending).toBe("asyl")
    expect(effects).toEqual([])
  })

  test("a subsequent commit still fires against the preserved pending value", () => {
    // Belt-and-braces: once the timer fires after the sibling URL write,
    // the commit lands. That is the round-trip the reader expects — the
    // filter narrows the list, they finish typing, and their search hits
    // the URL. On the pre-fix reducer this test also fails because
    // `pending` had already been cleared to null.
    const { effects } = drive(initSearchSync(""), [
      { type: "userTyped", value: "asyl" },
      { type: "urlChanged", urlQuery: "" }, // sibling filter, ?q= unchanged
      { type: "commitFired", value: "asyl" },
    ])
    expect(effects).toEqual(["commit:asyl"])
  })

  test("a real ?q= change still adopts the new value and clears pending", () => {
    // Guard against over-fitting the guard. When ?q= actually changes
    // (Back, Forward, Reset, shared link), the reducer must still adopt
    // it and drop stale typing — that is the original flap-prevention
    // invariant. Only same-value re-notifications are no-ops.
    const { state } = drive(initSearchSync(""), [
      { type: "userTyped", value: "asyl" },
      { type: "urlChanged", urlQuery: "buerokrat" }, // e.g. Back to a saved link
    ])
    expect(state.local).toBe("buerokrat")
    expect(state.pending).toBeNull()
    expect(state.lastSeenUrlQuery).toBe("buerokrat")
  })

  test("repeated same-value urlChanged notifications remain no-ops", () => {
    // Multiple sibling filter clicks in a row (kind, then year, then wp)
    // each rewrite the URL. Every one of them is a same-value
    // `urlChanged` from the search's point of view, and none of them
    // should touch typing.
    const { state } = drive(initSearchSync(""), [
      { type: "userTyped", value: "asyl" },
      { type: "urlChanged", urlQuery: "" },
      { type: "urlChanged", urlQuery: "" },
      { type: "urlChanged", urlQuery: "" },
    ])
    expect(state.pending).toBe("asyl")
    expect(state.local).toBe("asyl")
  })
})
