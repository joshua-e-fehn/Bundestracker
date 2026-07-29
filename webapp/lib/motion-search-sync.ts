/**
 * The decision logic for the `/motions` search input, as data.
 *
 * ## Why this is a reducer and not two `useEffect`s
 *
 * The first version of this was two effects in components/motion-list.tsx:
 * one reseeded the local `search` state from `urlQuery` when the URL changed,
 * the other watched a deferred `search` and wrote it to the URL when they
 * differed. On a `router.replace` from Reset followed by a browser Back to a
 * prior entry with a different `?q=`, the second effect fired *before* the
 * first had committed its `setState` — so it saw local `search === ""` beside
 * the new `urlQuery === "asyl"`, decided they differed, and wrote the URL back
 * to nothing. The Back button flapped and the shared-link state was lost.
 *
 * The failure was not fixable inside the two-effect design without ordering
 * hacks (a ref latch that skips one render). What is fixable is the *policy*:
 * a URL write must only follow a user input event, not any change to
 * `urlQuery`. Two effects cannot express that policy because both are
 * triggered by state changes, not by events. A reducer can — every transition
 * has an explicit trigger, and only one trigger (`userTyped`) ever produces a
 * commit.
 *
 * ## The state machine
 *
 * State is `local` (the value in the box), `pending` (the value scheduled to
 * be written to the URL, or `null` if no write is pending) and
 * `lastSeenUrlQuery` (the most recent `?q=` the reducer has observed —
 * needed so a re-notification with an *unchanged* value can be recognised
 * as a no-op, see below). Actions are:
 *
 *  - `userTyped(value)` — the reader is typing. Update `local`; schedule a
 *    commit for `value` (replacing any earlier pending commit — debouncing).
 *  - `urlChanged(urlQuery)` — the URL was observed. If `urlQuery` matches
 *    `lastSeenUrlQuery`, do nothing — a sibling filter click (kind, year,
 *    period) also rewrites the URL and the observing effect can re-fire
 *    with the same `?q=` value. Cancelling in-flight typing in that case is
 *    exactly the regression the first shipped fix left open: same class of
 *    failure as the original two-effect flap, different trigger. Only a
 *    genuinely new value adopts `local` and clears `pending`.
 *  - `commitFired(value)` — the debounce timer expired. If the value is still
 *    the one the user last typed (`local === value`), emit a commit effect
 *    for it; otherwise ignore (a newer keystroke or an external URL change
 *    has replaced it).
 *
 * Every transition returns the next state and an *effect* — either `null`
 * or `{ type: "commit"; value: string }`. The effect is the only thing that
 * writes the URL, and only `userTyped` and `commitFired` can produce one.
 * `urlChanged` never does — that is the whole of the flap-prevention
 * invariant, restated as a type.
 *
 * ## Why the debounce cancellation is expressed as `pending`
 *
 * A pending commit is a scheduled `setTimeout` in the component; the reducer
 * cannot cancel one it did not schedule. So the reducer emits `pending` as
 * part of state and the component clears its timer whenever `pending` becomes
 * `null` between transitions. That keeps the reducer pure (no timers, no
 * effects) and makes the "cancel on URL change" guarantee a *state*
 * transition anyone can read off the reducer, rather than a side-effect
 * hidden in a `useEffect` cleanup.
 */

export type SearchSyncState = {
  /** What is in the input box now. */
  local: string
  /** The value the reader has typed but the URL has not been told about yet,
   * or `null` if no write is pending. */
  pending: string | null
  /** The URL's `?q=` value the last time an `urlChanged` action told us
   * about it. Compared on every subsequent `urlChanged` so a re-notification
   * with the same value is a no-op — the failure the review's re-run flagged
   * was a sibling `router.replace` (kind/year/wp) re-firing the URL-observer
   * effect while `?q=` had not changed, which erased typing. See the
   * `urlChanged` branch below. */
  lastSeenUrlQuery: string
}

export type SearchSyncAction =
  | { type: "userTyped"; value: string }
  | { type: "urlChanged"; urlQuery: string }
  | { type: "commitFired"; value: string }

/** What the caller must do after applying the transition. `null` means "do
 * nothing"; a `commit` means "write this value to the URL". Never generated
 * by `urlChanged` — see the header. */
export type SearchSyncEffect = { type: "commit"; value: string } | null

/**
 * The initial state for a mount, given whatever the URL already carries.
 *
 * `pending` is `null` on mount for the reason `urlChanged` returns `null`:
 * the URL is already whatever it is, and a fresh mount must not write it
 * back to itself.
 */
export function initSearchSync(urlQuery: string): SearchSyncState {
  return { local: urlQuery, pending: null, lastSeenUrlQuery: urlQuery }
}

export function reduceSearchSync(
  state: SearchSyncState,
  action: SearchSyncAction,
): { next: SearchSyncState; effect: SearchSyncEffect } {
  switch (action.type) {
    case "userTyped":
      // Every keystroke replaces the pending value, which is what makes this
      // a debounce: the older `commitFired` will find `state.local !==
      // value` and drop itself. `lastSeenUrlQuery` is unchanged — the URL
      // has not been observed to change here; only the typed value has.
      return {
        next: { local: action.value, pending: action.value, lastSeenUrlQuery: state.lastSeenUrlQuery },
        effect: null,
      }

    case "urlChanged":
      // Fires from the component's URL-observing effect. Two cases:
      //
      //  (a) A genuinely new `?q=` value — from Back, Forward, Reset, a
      //      shared link. Adopt it as `local`, cancel any pending typing
      //      (a commit from an older keystroke would fight the new URL),
      //      and remember the new value.
      //  (b) The same value we already saw. A sibling filter click on
      //      kind/year/wp rewrites the URL and the observer sees `?q=`
      //      unchanged — cancelling `pending` here would erase whatever
      //      the reader is mid-typing. **This branch is the fix.** No
      //      state change, no effect.
      if (action.urlQuery === state.lastSeenUrlQuery) {
        return { next: state, effect: null }
      }
      return {
        next: {
          local: action.urlQuery,
          pending: null,
          lastSeenUrlQuery: action.urlQuery,
        },
        effect: null,
      }

    case "commitFired":
      // The debounce expired. Emit only if the value is still the one the
      // reader last typed *and* the URL doesn't already hold it. A newer
      // keystroke would have replaced `local`; an external URL change would
      // have cleared `pending` to null and rewritten `local`. Both cases
      // drop this stale commit rather than fighting the newer state.
      if (state.pending === null || state.pending !== action.value) {
        return { next: state, effect: null }
      }
      return {
        next: {
          local: state.local,
          pending: null,
          lastSeenUrlQuery: state.lastSeenUrlQuery,
        },
        effect: { type: "commit", value: action.value },
      }
  }
}
