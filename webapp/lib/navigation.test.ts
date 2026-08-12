import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { isPublicPath } from "./auth-routes"
import { dictionaries, LOCALES } from "./i18n"
import {
  allNavItems,
  isActiveGroup,
  isActivePath,
  NAV_ACCOUNT,
  NAV_FEEDBACK,
  NAV_GROUPS,
  NAV_PRIMARY,
  NAV_SEARCH,
  navCurrent,
} from "./navigation"

/**
 * Tests for the navigation tree.
 *
 * The bug class these exist for is the one the old header's own comments
 * describe at length and still shipped twice: a route that exists in `app/` and
 * has no way into it from the chrome, and a link in the chrome pointing at a
 * route that does not exist. Both are invisible from a typecheck — the first is
 * a page nobody can find, the second is a 404 that looks like a broken site —
 * and both were found by a human clicking around rather than by a test.
 *
 * So the two assertions that matter here read the *filesystem*, in the same
 * shape `lib/auth-routes.test.ts` reads it: every route with a page is in the
 * navigation, and every entry in the navigation is a route with a page. A new
 * feature fails these on the commit that adds it.
 */

/** Every top-level route segment under `app/` that has a `page.tsx`.
 *
 * Route groups, private folders and dynamic segments are skipped — they do not
 * appear in a URL as themselves. `api` is skipped because it serves Better
 * Auth's callbacks rather than a page. This mirrors the walk in
 * lib/auth-routes.test.ts deliberately: the two lists answer different questions
 * about the same directory, and they should disagree about its shape only when
 * one of them is wrong. */
function routeSegments(): string[] {
  const appDir = new URL("../app/", import.meta.url).pathname
  const out: string[] = []
  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (/^[(_[@]/.test(entry.name)) continue
    if (entry.name === "api") continue
    if (!existsSync(join(appDir, entry.name, "page.tsx"))) continue
    out.push(entry.name)
  }
  return out
}

describe("the tree covers the site", () => {
  test("every route with a page is reachable from the navigation", () => {
    // The criterion the redesign was held to: grouping must not mean hiding.
    // `/votes/own-resources` is the entry this would have caught before — it
    // shipped as a real page reachable only from a sentence in the middle of
    // `/votes`, which is not navigation.
    //
    // `/sign-in` is the one exemption, and it is deliberate: it is reached from
    // the account control at the foot of the sidebar (and of the mobile
    // drawer) — see components/sidebar-account.tsx — and an "anmelden" entry in a
    // navigation whose whole premise is that no account is needed would
    // misdescribe the product. Asserted as an exemption rather than skipped, so
    // the list of things not in the nav stays one line long and visible.
    const NOT_IN_NAV = new Set(["sign-in"])
    const hrefs = new Set(allNavItems().map((item) => item.href))

    for (const segment of routeSegments()) {
      if (NOT_IN_NAV.has(segment)) continue
      expect(hrefs).toContain(`/${segment}`)
    }
  })

  test("every navigation entry points at a route that exists", () => {
    // The other direction, and the failure the old header's header comment
    // describes: five links written against German paths (`/abgeordnete`,
    // `/rangliste`) while the pages landed at English ones, so every entry in
    // the bar was a 404 once the branches merged. A nav entry for an unbuilt
    // page is indistinguishable to a reader from a broken site.
    const appDir = new URL("../app/", import.meta.url).pathname
    for (const item of allNavItems()) {
      // `/votes/own-resources` → app/votes/own-resources/page.tsx. Nested
      // entries resolve the same way as top-level ones because the segments are
      // the directories.
      const path = join(appDir, ...item.href.split("/").filter(Boolean), "page.tsx")
      expect({ href: item.href, exists: existsSync(path) }).toEqual({
        href: item.href,
        exists: true,
      })
    }
  })

  test("every navigable destination is public", () => {
    // Criterion 5: a logged-out reader keeps every public product page. The
    // navigation is the same for both, so an entry that is not on the public
    // list would be a link that redirects a signed-out reader to sign-in — the
    // exact failure lib/auth-routes.ts's ⚠ describes, arriving through the nav
    // rather than through a pasted URL.
    for (const item of allNavItems()) {
      expect({ href: item.href, public: isPublicPath(item.href) }).toEqual({
        href: item.href,
        public: true,
      })
    }
  })

  test("no destination appears twice", () => {
    // A route in two groups is an information architecture that has not decided
    // what the route is *for*, and it doubles the active-state marker.
    const hrefs = allNavItems().map((item) => item.href)
    expect(hrefs.length).toBe(new Set(hrefs).size)
  })

  test("the tree is not a flat list again", () => {
    // The regression this whole task was about. Eight peers in a bar is the
    // state being left behind, and the way it comes back is one entry at a time
    // — so this pins the shape rather than the contents: destinations live in
    // named groups, and there are few enough of them to read as sections rather
    // than as a second flat list one level down.
    expect(NAV_GROUPS.length).toBeGreaterThanOrEqual(2)
    expect(NAV_GROUPS.length).toBeLessThanOrEqual(4)
    // And every group actually holds something.
    for (const group of NAV_GROUPS) {
      expect(group.items.length).toBeGreaterThan(0)
    }
  })

  test("the expanded sidebar fits on a laptop without scrolling", () => {
    // The sidebar shows every destination at once — no disclosure — so the
    // tree's total height is a real constraint rather than a style question.
    // At the rendered sizes (36 px rows, ~28 px group headings, 12 px group
    // gaps) the current tree comes to roughly 560 px, inside the ~640 px a
    // 768 px-tall laptop leaves below the header. This is a budget, not a
    // measurement: it fails when a future feature would push the list past the
    // fold, which is the moment the "visible at once" premise needs revisiting
    // rather than silently becoming "visible after scrolling".
    const rows = allNavItems().length
    const headings = NAV_GROUPS.length
    const estimatedHeight = rows * 36 + headings * 28 + headings * 12
    expect(estimatedHeight).toBeLessThan(640)
  })

  test("settings is reachable, and from outside the three groups", () => {
    // The route the 2026-07-29 audit found had never existed (GAP-007), under a
    // backend that had. It is in the tree — the filesystem check above would
    // fail otherwise — but *where* is the decision worth pinning: it is the
    // site's only destination whose subject is the reader rather than the
    // Bundestag, so it sits in the shell's account slot. Folding it into
    // "Einordnung" would put a personal setting among the pages that explain
    // what the figures mean.
    expect(allNavItems()).toContain(NAV_ACCOUNT)
    expect(NAV_ACCOUNT.href).toBe("/settings")
    for (const group of NAV_GROUPS) {
      expect(group.items.map((item) => item.href)).not.toContain(NAV_ACCOUNT.href)
    }
  })
})

describe("every destination can be rendered in the collapsed rail", () => {
  test("each entry carries an icon", () => {
    // Collapsed, the icon is the only thing left of a row. An entry without one
    // would render as a blank 16 px square that navigates somewhere — invisible
    // to a typecheck if `icon` were optional, which is why it is not, and
    // asserted here anyway because a `LucideIcon`-typed `undefined` slipping
    // through a cast would produce exactly that blank row.
    //
    // "Renderable" rather than `typeof === "function"`: lucide's icons are
    // `forwardRef` results, which are *objects* carrying `$$typeof` and
    // `render`. Checking for a function passes on a plain component and fails
    // on every icon this file actually uses.
    for (const item of allNavItems()) {
      const renderable =
        typeof item.icon === "function" || (typeof item.icon === "object" && item.icon !== null)
      expect({ href: item.href, renderable }).toEqual({ href: item.href, renderable: true })
    }
  })

  test("no two destinations share an icon", () => {
    // In the collapsed rail the glyph *is* the row, so two entries with the
    // same one are two rows a reader cannot tell apart — the icon-rail
    // equivalent of two links with the same label. Not caught by the "no
    // destination appears twice" test above, which looks at hrefs.
    const icons = allNavItems().map((item) => item.icon)
    expect(icons.length).toBe(new Set(icons).size)
  })
})

describe("labels exist in both languages", () => {
  test("every label and description key resolves in every locale", () => {
    // `Dictionary` already makes a missing English string a typecheck failure,
    // so this is not re-testing the type system: it catches a key that is
    // *present but empty* in one locale, which typechecks and renders as a
    // blank row in the menu.
    const items = [...allNavItems()]
    for (const locale of LOCALES) {
      const dict = dictionaries[locale]
      for (const group of NAV_GROUPS) {
        expect(dict[group.labelKey]?.length ?? 0).toBeGreaterThan(0)
      }
      for (const item of items) {
        expect({ key: item.labelKey, locale, ok: (dict[item.labelKey]?.length ?? 0) > 0 }).toEqual({
          key: item.labelKey,
          locale,
          ok: true,
        })
        if (item.descriptionKey) {
          expect({
            key: item.descriptionKey,
            locale,
            ok: (dict[item.descriptionKey]?.length ?? 0) > 0,
          }).toEqual({ key: item.descriptionKey, locale, ok: true })
        }
      }
    }
  })

  test("a description does not interpolate a value the chrome cannot supply", () => {
    // `mps.subtitle` is "… der {wahlperiode}. Wahlperiode." — correct on the
    // page, which resolves the period, and wrong in a menu that does not. The
    // nav therefore points at `nav.membersHint` instead. This pins that: a
    // placeholder left unresolved renders literally as "{wahlperiode}" in the
    // menu, which looks like a bug because it is one.
    for (const locale of LOCALES) {
      const dict = dictionaries[locale]
      for (const item of allNavItems()) {
        if (!item.descriptionKey) continue
        expect({
          key: item.descriptionKey,
          locale,
          hasPlaceholder: /\{\w+\}/.test(dict[item.descriptionKey] ?? ""),
        }).toEqual({
          key: item.descriptionKey,
          locale,
          hasPlaceholder: false,
        })
      }
    }
  })
})

describe("isActivePath", () => {
  test("marks the exact route", () => {
    expect(isActivePath("/mps", "/mps")).toBe(true)
    expect(isActivePath("/votes", "/votes")).toBe(true)
  })

  test("marks a section from inside it", () => {
    // A reader on an MP's profile should see that they are in "Abgeordnete".
    expect(isActivePath("/mps/bt-0001", "/mps")).toBe(true)
    expect(isActivePath("/votes/own-resources", "/votes")).toBe(true)
    expect(isActivePath("/parties/spd", "/parties")).toBe(true)
  })

  test("does not leak to a sibling that merely starts the same", () => {
    // The matcher requires a "/"-delimited prefix, which is what stops "/mps"
    // lighting up on "/mpsecret". Same shape as `isPublicPath`, deliberately.
    expect(isActivePath("/mpsecret", "/mps")).toBe(false)
    expect(isActivePath("/votes-archive", "/votes")).toBe(false)
  })

  test("a root entry would not match every route", () => {
    // `/` is reached through the wordmark rather than as a nav entry, but the
    // matcher has to be safe if one is ever added: a "/" entry that matched
    // every path would mark the entire navigation active at once. The
    // startsWith("//") construction is what prevents it.
    expect(isActivePath("/mps", "/")).toBe(false)
    expect(isActivePath("/", "/")).toBe(true)
  })
})

describe("navCurrent", () => {
  /**
   * The bug: `aria-current="page"` was derived from `isActivePath`, which is a
   * *prefix* match. On `/votes/own-resources` that made two rows — the child
   * and its `/votes` parent — both announce themselves as the current page.
   * Only one page can be the current page; a screen-reader user was told the
   * ancestor was their location as emphatically as the destination was.
   *
   * Found in production on www.bundestracker.de, where the open Decisions menu
   * reported `/votes aria-current=page` and `/votes/own-resources
   * aria-current=page` simultaneously.
   */
  test("only the exact destination is the current page", () => {
    expect(navCurrent("/votes/own-resources", "/votes/own-resources")).toBe("page")
    expect(navCurrent("/votes", "/votes")).toBe("page")
    expect(navCurrent("/mps", "/mps")).toBe("page")
  })

  test("an ancestor of the location is current, but not the page", () => {
    // `true` — "the current item in this set" — rather than `page`. This is the
    // whole fix: the ancestor still announces that it is on the reader's path,
    // it just stops claiming to *be* the page.
    expect(navCurrent("/votes/own-resources", "/votes")).toBe(true)
    expect(navCurrent("/mps/bt-0001", "/mps")).toBe(true)
    expect(navCurrent("/parties/spd", "/parties")).toBe(true)
  })

  test("an entry off the reader's path carries no aria-current at all", () => {
    // `undefined`, not `"false"`: the absent attribute is the standard way to
    // say "not current", and `aria-current="false"` is treated as absent anyway.
    expect(navCurrent("/mps", "/votes")).toBeUndefined()
    expect(navCurrent("/mpsecret", "/mps")).toBeUndefined()
    expect(navCurrent("/votes-archive", "/votes")).toBeUndefined()
  })

  test("exactly one entry in the whole tree is the current page, on every route", () => {
    // The property the bug violated, asserted across every destination rather
    // than only the one that was reported. For any route a reader can be on,
    // the navigation must contain exactly one `page` — and any additional
    // marked rows must be ancestors carrying `true`.
    for (const item of allNavItems()) {
      const marked = allNavItems()
        .map((other) => ({ href: other.href, current: navCurrent(item.href, other.href) }))
        .filter((entry) => entry.current !== undefined)
      const pages = marked.filter((entry) => entry.current === "page")
      expect({ on: item.href, pages: pages.map((p) => p.href) }).toEqual({
        on: item.href,
        pages: [item.href],
      })
      // Everything else that is marked is an ancestor, and says so.
      for (const entry of marked) {
        if (entry.href === item.href) continue
        expect({ on: item.href, href: entry.href, current: entry.current }).toEqual({
          on: item.href,
          href: entry.href,
          current: true,
        })
      }
    }
  })

  test("the nested route the bug was found on marks its parent, not two pages", () => {
    // The exact production reproduction, pinned as its own case so a
    // regression names this route rather than failing in a loop.
    const onChild = allNavItems()
      .map((item) => ({ href: item.href, current: navCurrent("/votes/own-resources", item.href) }))
      .filter((entry) => entry.current !== undefined)
    expect(onChild).toEqual([
      { href: "/votes", current: true },
      { href: "/votes/own-resources", current: "page" },
    ])
  })

  test("the visual marker still uses the prefix match", () => {
    // Guarding the over-correction: narrowing `aria-current` must not narrow
    // the gold highlight, or navigating into a section would lose the only
    // indication of which section you are in. The two answer differently on
    // purpose.
    expect(isActivePath("/votes/own-resources", "/votes")).toBe(true)
    expect(navCurrent("/votes/own-resources", "/votes")).not.toBe("page")
  })
})

describe("isActiveGroup", () => {
  const decisions = NAV_GROUPS.find((group) => group.id === "decisions")
  const people = NAV_GROUPS.find((group) => group.id === "people")

  /** The entries that live outside `NAV_GROUPS`, named once rather than
   * enumerated inline in each test — the list has grown from two to three, and
   * a fourth would otherwise be added to one assertion and not the other. */
  const UNGROUPED = new Set([NAV_PRIMARY.href, NAV_SEARCH.href, NAV_ACCOUNT.href])

  test("a group is active when the reader is on one of its entries", () => {
    expect(isActiveGroup("/votes", decisions!)).toBe(true)
    expect(isActiveGroup("/mps", people!)).toBe(true)
  })

  test("a group is active when the reader is on a child of one of its entries", () => {
    // Without this the bar loses its active marker entirely on
    // `/votes/own-resources` — the row that would carry it is behind a closed
    // menu, so the group trigger is the only place it can show.
    expect(isActiveGroup("/votes/own-resources", decisions!)).toBe(true)
  })

  test("a group is not active when the reader is somewhere else", () => {
    expect(isActiveGroup("/mps", decisions!)).toBe(false)
    expect(isActiveGroup("/about", people!)).toBe(false)
  })

  test("exactly one group is active on any destination", () => {
    // Two groups lighting up at once would mean a route classified into both,
    // which is the ambiguity the "no destination appears twice" test forbids —
    // asserted here from the reader's side rather than the data's.
    for (const item of allNavItems()) {
      if (UNGROUPED.has(item.href)) continue
      const active = NAV_GROUPS.filter((group) => isActiveGroup(item.href, group))
      expect({ href: item.href, activeGroups: active.length }).toEqual({
        href: item.href,
        activeGroups: 1,
      })
    }
  })

  test("no group claims an entry that sits outside the groups", () => {
    // All three sit outside by design, each for its own reason — the overview
    // is all three groups at once, search is a box in the header, and settings
    // is about the *reader* rather than about the Bundestag (see
    // `NAV_ACCOUNT`). If a later edit moved one into a group, the bar would
    // show two active markers at once on that route.
    for (const group of NAV_GROUPS) {
      for (const href of UNGROUPED) {
        expect({ href, group: group.id, active: isActiveGroup(href, group) }).toEqual({
          href,
          group: group.id,
          active: false,
        })
      }
    }
  })
})

/**
 * The one entry that is an action rather than a destination.
 *
 * Every assertion in this file above here is about routes: that each has a page,
 * that each page has a way in. `NAV_FEEDBACK` has neither and must not — a
 * report is filed about the page you are on, so opening a route to file it would
 * discard the context being reported. These pin the ways that could go wrong.
 */
describe("the report entry is an action, not a route", () => {
  test("it carries an action and no href", () => {
    expect(NAV_FEEDBACK.action).toBe("feedback")
    expect(NAV_FEEDBACK.href).toBeUndefined()
  })

  test("it is absent from the route list the filesystem checks walk", () => {
    // ⚠ The reason it is excluded from `allNavItems()`. That list is asserted
    // against `app/` in both directions, so including an entry with no route
    // would fail "every nav entry is a route with a page" — correctly, since it
    // is not one. Excluding it is what keeps that assertion meaningful for the
    // fourteen entries that *are* routes.
    expect(allNavItems()).not.toContain(NAV_FEEDBACK)
    for (const item of allNavItems()) expect(typeof item.href).toBe("string")
  })

  test("its label and hint exist in both languages", () => {
    // The bilingual rule applies to it like any other row; it is simply not
    // covered by the `allNavItems()` loop above, so it is checked here.
    for (const locale of LOCALES) {
      const dict = dictionaries[locale]
      expect({ locale, label: (dict[NAV_FEEDBACK.labelKey]?.length ?? 0) > 0 }).toEqual({
        locale,
        label: true,
      })
      const hint = NAV_FEEDBACK.descriptionKey
      if (!hint) throw new Error("the report entry should carry a hint")
      expect({ locale, hint: (dict[hint]?.length ?? 0) > 0 }).toEqual({ locale, hint: true })
      expect(/\{\w+\}/.test(dict[hint] ?? "")).toBe(false)
    }
  })

  test("it carries an icon, like every row that can appear in the collapsed rail", () => {
    // The rail renders nothing but the glyph at 3.5 rem. A row without one
    // would be a blank 16 px square that does something.
    expect(NAV_FEEDBACK.icon).toBeDefined()
  })

  test("no group claims it, and no route makes it look active", () => {
    // It has no href, so `isActivePath` has nothing to match — but a future
    // edit giving it one would silently put a second active marker on screen.
    for (const group of NAV_GROUPS) {
      expect(group.items).not.toContain(NAV_FEEDBACK)
    }
  })
})
