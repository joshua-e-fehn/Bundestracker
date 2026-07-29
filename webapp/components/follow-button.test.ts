import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The follow control's wiring, asserted against the source.
 *
 * ## Why these are text assertions
 *
 * The same reason components/sidebar-account.test.ts and
 * components/nav-sidebar.test.ts give: `bun test` has no DOM, no React
 * renderer and no Convex client, so there is nothing here in which to click a
 * button and watch a mutation fire. The browser check is the real verification
 * (see the report for this branch); these buy the cheap half — the specific
 * wrong versions of this component are caught in CI rather than by a reader
 * discovering their follow did not save.
 *
 * Each test below names a version that would look correct and be wrong.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url).pathname, "utf8")

/** Comments stripped: every property below is *discussed* in the prose of the
 * file it guards, so a search over the raw text would pass on the explanation
 * alone. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const followButton = stripComments(read("./follow-button.tsx"))
const settingsPage = stripComments(read("./settings-page.tsx"))
const mpProfile = stripComments(read("./mp-profile.tsx"))
const mpTable = stripComments(read("./mp-table.tsx"))

describe("the follow button writes through the existing preference mutations", () => {
  test("it calls followMP and unfollowMP, not a toggle it invented", () => {
    // The backend deliberately offers two idempotent set operations rather than
    // one toggle (convex/userPreferences.ts, and the properties in
    // convex/userPreferences.test.ts). A client that flipped a local boolean and
    // sent "the other one" would reintroduce exactly the retry bug the split
    // prevents, on the client side where no server test would see it.
    expect(followButton).toMatch(/useMutation\(api\.userPreferences\.followMP\)/)
    expect(followButton).toMatch(/useMutation\(api\.userPreferences\.unfollowMP\)/)
  })

  test("it reads the follow state rather than assuming it", () => {
    // `isFollowing` for the single-MP case. A button that started at "not
    // following" and only tracked its own presses would show the wrong label on
    // every second page load.
    expect(followButton).toMatch(/api\.userPreferences\.isFollowing/)
  })

  test("a failed write is surfaced, not swallowed", () => {
    // `catch {}` around a mutation is the failure that looks like success: the
    // button returns to rest, the reader believes they have followed someone,
    // and the watchlist they check later is empty. Same position
    // components/mp-score-panel.tsx takes for the weight save.
    expect(followButton).toMatch(/setFailed\(true\)/)
    expect(followButton).toMatch(/role="alert"/)
  })
})

describe("signed out, the control explains rather than failing", () => {
  test("it renders a link to /sign-in", () => {
    // `followMP` throws "Not authenticated" for an anonymous caller
    // (convex/lib/auth.ts). Letting that happen would present the site's own
    // precondition as an error the reader caused; a `disabled` button would say
    // nothing about why. The link is the third option and the only one that
    // answers the question.
    expect(followButton).toMatch(/href="\/sign-in"/)
  })

  test("it does not subscribe to isFollowing while signed out", () => {
    // The query answers a constant `false` for an anonymous caller and the
    // signed-out branch never reads it, so firing it would be one wasted
    // subscription per row of a 630-member roster.
    expect(followButton).toMatch(
      /session && providedFollowing === undefined \? \{ mpInternalId \} : "skip"/,
    )
  })
})

/**
 * The hydration contract, which this component is the fourth file to need.
 *
 * Duplicated deliberately from components/sidebar-account.test.ts rather than
 * only listed there: that file enumerates the session-branching components by
 * name, and a test that lives beside the component is the one a person editing
 * this file will see. Both are cheap; missing the guard is not — the throw
 * detaches `<head>` and swallows the reader's next click anywhere on the site.
 */
describe("the follow button cannot change element type on hydration", () => {
  test("it gates the first render on a mount flag, not only on isPending", () => {
    expect(followButton).toMatch(/useState\(false\)/)
    expect(followButton).toMatch(/useEffect\(\(\)\s*=>\s*setMounted\(true\)\s*,\s*\[\]\)/)
  })

  test("the skeleton branch is taken until mounted", () => {
    expect(followButton).toMatch(/if\s*\(\s*!mounted\s*\|\|\s*isPending\s*\)/)
  })
})

describe("a list resolves the follow set once, not once per row", () => {
  test("the roster reads getPreferences and passes the answer down", () => {
    // 25 rows × one `isFollowing` subscription each is the version that works
    // and does not scale — and it would get worse on paging, since each page
    // would open 25 more. `MPCard` states the same rule for `dissent` and
    // `electionMethod`: a list joins what it needs, it does not query per row.
    expect(mpTable).toMatch(/api\.userPreferences\.getPreferences/)
    expect(mpTable).toMatch(/following=\{following\}/)
    // And the table must not have reached for the per-MP query anyway.
    expect(mpTable).not.toMatch(/isFollowing/)
  })

  test("the in-flight state stays undefined rather than collapsing to false", () => {
    // `new Set(preferences?.followedMpIds ?? [])` would typecheck and be wrong:
    // every row would claim "not followed" for a beat and then flip, which on a
    // slow connection is long enough to press.
    expect(mpTable).toMatch(/preferences \? new Set\(preferences\.followedMpIds\) : undefined/)
  })
})

describe("the control appears where the product promise implies it", () => {
  test("on the MP profile", () => {
    // The surface `auth.benefits` describes — "folgen einzelnen Abgeordneten".
    // The 2026-07-29 audit found that sentence shipped in both languages with
    // no control anywhere on the site (GAP-006/GAP-008).
    expect(mpProfile).toMatch(/<FollowButton/)
  })

  test("on the roster", () => {
    expect(mpTable).toMatch(/<FollowButton/)
  })
})

describe("the settings page reuses the existing controls and API", () => {
  test("the sliders are WeightControls, not a second set", () => {
    // A bespoke slider here would be a second definition of what a weight's
    // range is — the thing components/weight-controls.tsx explains at length
    // and would be free to change under a copy that did not know.
    expect(settingsPage).toMatch(/import \{ WeightControls \}/)
  })

  test("the watchlist rows are MPCard, not a bespoke row", () => {
    expect(settingsPage).toMatch(/import \{ MPCard \}/)
  })

  test("it persists through updatePreferences and reads getPreferences", () => {
    expect(settingsPage).toMatch(/useMutation\(api\.userPreferences\.updatePreferences\)/)
    expect(settingsPage).toMatch(/useQuery\(api\.userPreferences\.getPreferences, \{\}\)/)
  })

  test("the watchlist comes from getFollowedMPs", () => {
    // Rather than resolving ids client-side: the query joins names, groups and
    // portraits server-side, which is what stops the page issuing one lookup
    // per followed member.
    expect(settingsPage).toMatch(
      /useQuery\(api\.userPreferences\.getFollowedMPs, \{ wahlperiode \}\)/,
    )
  })

  test("clearing the weights sends an explicit null", () => {
    // `customWeights: null` means "go back to the defaults"; an *omitted* key
    // means "don't touch mine". Sending `undefined` here would leave the saved
    // set in place while the page reported it deleted
    // (convex/userPreferences.ts).
    expect(settingsPage).toMatch(/save\(null\)/)
  })
})

/**
 * The saved language must be read as well as written.
 *
 * `preferredLocale` sat in the schema, in the validator and in
 * `updatePreferences`' arguments with no writer and no reader — one of the
 * nineteen finished-and-uncalled functions the audit counted. Adding the writer
 * alone would have been the same defect wearing a control: a setting that
 * stores a value and does nothing is worse than an absent setting, because the
 * reader has been told it works.
 */
describe("the saved locale is applied, not merely stored", () => {
  const savedLocale = stripComments(read("./providers/saved-locale.tsx"))
  const localeProvider = stripComments(read("./providers/locale-provider.tsx"))
  const layout = stripComments(
    readFileSync(new URL("../app/layout.tsx", import.meta.url).pathname, "utf8"),
  )

  test("something reads preferredLocale and applies it", () => {
    expect(savedLocale).toMatch(/api\.userPreferences\.getPreferences/)
    expect(savedLocale).toMatch(/adoptSavedLocale\(saved\)/)
  })

  test("it is mounted in the layout, inside the provider it calls into", () => {
    // A component nobody renders is the same gap one level up.
    expect(layout).toMatch(/<SavedLocaleSync \/>/)
  })

  test("a device-local choice still wins", () => {
    // The precedence rule: a reader who pressed the toggle in this browser is
    // never overridden by an account setting saved elsewhere. Without the
    // localStorage check `adoptSavedLocale` would fight the toggle on every
    // page load, and the toggle would appear not to work.
    expect(localeProvider).toMatch(/const adoptSavedLocale = useCallback/)
    expect(localeProvider).toMatch(/if \(stored && isLocale\(stored\)\) return/)
  })

  test("adopting does not write localStorage", () => {
    // Writing it would silently promote the account's answer to a device-local
    // choice, after which clearing the preference in settings would leave the
    // old language pinned in every browser that had ever loaded a page while
    // signed in — and indistinguishable from a real toggle press.
    const adopt = localeProvider.slice(localeProvider.indexOf("const adoptSavedLocale"))
    const body = adopt.slice(0, adopt.indexOf("}, [])"))
    expect(body).not.toMatch(/setItem/)
  })
})
