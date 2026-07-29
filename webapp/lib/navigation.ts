import type { LucideIcon } from "lucide-react"
import {
  ActivityIcon,
  ArmchairIcon,
  CoinsIcon,
  FileTextIcon,
  InfoIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ScaleIcon,
  SearchIcon,
  SettingsIcon,
  TrophyIcon,
  UsersIcon,
  VoteIcon,
} from "lucide-react"
import type { TranslationKey } from "@/lib/i18n"

/**
 * The site's information architecture: every navigable destination, grouped.
 *
 * One list, consumed by three surfaces — the desktop sidebar, the mobile
 * drawer, and the tests. `components/site-header.tsx` used to hold this inline,
 * which is what let the two renderings of it drift: the header carried a
 * hand-written `NAV_SHEET_ONLY` set to keep one long label out of the inline
 * row, and the row itself was a filter over a flat array of eight links. A flat
 * list is exactly what stops scaling, and it is the thing this task was opened
 * about — eight peer links in a 56 px bar, with a ninth
 * (`/votes/own-resources`) reachable only from a sentence inside `/votes` and a
 * tenth (`/search`) that changes shape depending on the viewport.
 *
 * ## The grouping rule
 *
 * Groups are by **what the reader is looking for**, not by the shape of the
 * data or the order the features were built:
 *
 *  - `people` — *who*. A named human being: the roster, the ranking of them,
 *    and their seat in the chamber. Every entry here answers a question whose
 *    subject is a person or a group of people.
 *  - `decisions` — *what the Bundestag did*. Ballots and the arithmetic over
 *    them. Every entry is a parliamentary act with a date and a document.
 *  - `context` — *what this all means*. The feed's chronology and the
 *    methodology that says what the figures measure and what they do not.
 *
 * `/dashboard` sits above the groups as a `primary` entry rather than inside
 * one, because it is not a category — it is the overview of all three, and the
 * one destination a returning reader wants from anywhere. `/` (the narrative
 * home) is reached through the wordmark, as it already was.
 *
 * ## The placement rule for future features
 *
 * A new page goes in the group whose *question* it answers, as a `child` of the
 * entry it refines when it is a narrower cut of that entry's subject —
 * `/votes/own-resources` is a curated subset of `/votes`, so it is a child of
 * it rather than a tenth peer. A page that answers a genuinely new question
 * gets a new top-level entry in the group it belongs to. A page that would be a
 * fourth group is a sign the site has grown a new *kind* of thing, which is a
 * decision worth making deliberately rather than by adding a link.
 *
 * The one thing that must not happen again is a new feature landing as another
 * peer in a flat row, which is how eight links became a wall. See
 * docs/navigation-ia.md for the note this rule is written up in.
 *
 * ## Nothing is hidden to make the list shorter
 *
 * Progressive disclosure here means *grouped*, not *dropped*. Every route in
 * `app/` with a page is reachable from the navigation — including the two that
 * were not before — and `lib/navigation.test.ts` asserts that against the
 * filesystem, the same way `lib/auth-routes.test.ts` asserts the public list.
 * In the expanded sidebar every destination is visible at once with no
 * disclosure at all; collapsed, each is one hover away.
 *
 * ## Why every entry carries an icon
 *
 * Because the sidebar collapses to a 3.5 rem rail, and in that state the icon
 * is the only thing left of the row. That makes the icon a *requirement* of the
 * data rather than decoration on the view — `icon` is non-optional on `NavItem`
 * for exactly that reason, so a new destination cannot be added without
 * deciding what it looks like at 16 px, and the collapsed rail cannot silently
 * grow a blank row.
 *
 * It does not make the icon carry the meaning on its own. `/seating` is an
 * armchair and `/inquiry-quorum` is a pair of scales — neither is a convention
 * a reader could be expected to decode cold — so the collapsed rail pairs every
 * icon with a tooltip carrying the same label the expanded state shows, and
 * `aria-label` carries it to assistive technology whether or not a pointer ever
 * hovers. The icon is a landmark for a reader who already knows the site; the
 * label is what tells them in the first place, and it is never the icon's job
 * to replace it.
 */

/** A leaf: something a reader can navigate to. */
export type NavItem = {
  href: string
  labelKey: TranslationKey
  /** The glyph for this destination. Not optional — see the note above: the
   * collapsed rail renders nothing else, so an entry without one would be a
   * blank 16 px square that navigates somewhere. */
  icon: LucideIcon
  /** A one-line gloss, shown where there is room for it — the mobile drawer and
   * the expanded sidebar's own rows do not use it, but the drawer does, and it
   * is what the tooltip falls back to. These are the pages' own subtitles
   * rather than new strings, so the navigation says what the page says. */
  descriptionKey?: TranslationKey
  /** Narrower cuts of this entry's subject. Rendered indented under their
   * parent; the parent stays a link in its own right. */
  children?: readonly NavItem[]
}

/** A named set of items. `labelKey` titles it in the menus and the drawer. */
export type NavGroup = {
  id: "people" | "decisions" | "context"
  labelKey: TranslationKey
  items: readonly NavItem[]
}

/**
 * The overview. Above the groups, not in one — see the note above.
 *
 * `/dashboard` was the first entry of the old flat list for the same reason it
 * is singled out here: `/` is the narrative page, so this is where a reader who
 * wants today's figures rather than the argument goes, from any page.
 */
export const NAV_PRIMARY: NavItem = {
  href: "/dashboard",
  labelKey: "nav.dashboard",
  icon: LayoutDashboardIcon,
  descriptionKey: "nav.dashboardHint",
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "people",
    labelKey: "nav.groupPeople",
    items: [
      { href: "/mps", labelKey: "nav.members", icon: UsersIcon, descriptionKey: "nav.membersHint" },
      {
        href: "/rankings",
        labelKey: "nav.rankings",
        icon: TrophyIcon,
        descriptionKey: "rankings.subtitle",
      },
      {
        href: "/parties",
        labelKey: "nav.parties",
        icon: LandmarkIcon,
        descriptionKey: "nav.partiesHint",
      },
      {
        href: "/seating",
        labelKey: "nav.seating",
        icon: ArmchairIcon,
        descriptionKey: "nav.seatingHint",
      },
    ],
  },
  {
    id: "decisions",
    labelKey: "nav.groupDecisions",
    items: [
      {
        href: "/votes",
        labelKey: "nav.votes",
        icon: VoteIcon,
        descriptionKey: "nav.votesHint",
        // The curated collection. A child rather than a peer because it is a
        // *subset* of the ballots above it, and because it was previously
        // reachable only from a sentence in the middle of `/votes` — a real
        // page with no route into it from the chrome.
        children: [
          {
            href: "/votes/own-resources",
            labelKey: "votes.ownResources.title",
            icon: CoinsIcon,
            descriptionKey: "nav.ownResourcesHint",
          },
        ],
      },
      // A peer of `/votes` rather than a child of it, by the placement rule
      // above: a motion is not a narrower cut of a ballot, it is the other half
      // of what the chamber does. `/votes` answers "how did they decide"; this
      // answers "what was put before them", and the two lists share no rows.
      {
        href: "/motions",
        labelKey: "nav.motions",
        icon: FileTextIcon,
        descriptionKey: "nav.motionsHint",
      },
      {
        href: "/inquiry-quorum",
        labelKey: "nav.inquiry",
        icon: ScaleIcon,
        descriptionKey: "nav.inquiryHint",
      },
    ],
  },
  {
    id: "context",
    labelKey: "nav.groupContext",
    items: [
      { href: "/feed", labelKey: "nav.feed", icon: ActivityIcon, descriptionKey: "feed.subtitle" },
      { href: "/about", labelKey: "nav.about", icon: InfoIcon, descriptionKey: "about.subtitle" },
    ],
  },
]

/**
 * Search: a destination in the drawer, a *box* in the header.
 *
 * Kept out of `NAV_GROUPS` deliberately, and for the reason the old header
 * already gave: above the width where the header carries a search box, a link
 * beside it pointing at the same feature is a second control for one thing. The
 * drawer, which has no box of its own to compete with, renders it as an entry —
 * and so does the collapsed sidebar, where the header's box is still on screen
 * but the rail has room for the glyph and a reader scanning the rail should not
 * have to look elsewhere for the one destination missing from it.
 */
export const NAV_SEARCH: NavItem = {
  href: "/search",
  labelKey: "search.title",
  icon: SearchIcon,
  descriptionKey: "nav.searchHint",
}

/**
 * Settings: beside the account, not inside a group.
 *
 * The one destination on this site that is about the *reader* rather than about
 * the Bundestag. Every entry in `NAV_GROUPS` answers a question with a
 * parliamentary subject — who, what they decided, what it means — and the
 * grouping rule above says a page that would need a fourth group is a sign the
 * site has grown a new kind of thing. It has: this is that thing, and there is
 * exactly one of it, so it sits in the shell's account slot rather than being
 * given a group of its own for one row.
 *
 * Rendered above `SidebarAccount` at the foot of the rail and of the mobile
 * drawer — the slot the account already owns, so the reader's own two concerns
 * are adjacent. Not *inside* the account dropdown, which would be the other
 * convention: that menu only exists once you are signed in, and the page's
 * signed-out rendering (which explains what an account is for) would then be
 * reachable only by people who no longer need it.
 *
 * `NAV_PRIMARY` and `NAV_SEARCH` sit outside the groups for their own reasons
 * and this is the third; `isActiveGroup` must keep answering `false` for all
 * three, or a route outside the groups would light one of them up.
 */
export const NAV_ACCOUNT: NavItem = {
  href: "/settings",
  labelKey: "settings.title",
  icon: SettingsIcon,
  descriptionKey: "nav.settingsHint",
}

/** Every leaf in the tree, flattened — children included. The order is the
 * reading order of the navigation itself, so a test that walks this walks what
 * a reader sees. */
export function allNavItems(): NavItem[] {
  const out: NavItem[] = [NAV_PRIMARY]
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      out.push(item)
      if (item.children) out.push(...item.children)
    }
  }
  out.push(NAV_SEARCH)
  out.push(NAV_ACCOUNT)
  return out
}

/**
 * Whether `href` is the location the reader is at, or an ancestor of it.
 *
 * The prefix half is what makes `/mps` light up on `/mps/bt-0001` and `/votes`
 * on `/votes/own-resources` — a reader inside a section should see which
 * section they are in. `/` is excluded from the prefix test by construction:
 * the check appends a slash, so for `href="/"` it asks `startsWith("//")`,
 * which no pathname satisfies. That is deliberate rather than incidental — a
 * `/` entry matching every route would mark the whole navigation active — and
 * it is the same matcher shape `lib/auth-routes.ts` uses, kept identical so the
 * two answer consistently.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The `aria-current` value for a nav entry, or `undefined` when it is not on
 * the reader's path at all.
 *
 * `isActivePath` is deliberately a *prefix* match — that is what lets `/votes`
 * carry the gold marker while the reader is on `/votes/own-resources`, so the
 * bar still says which section they are in. Reusing that same boolean for
 * `aria-current="page"` overstated it: on `/votes/own-resources` **two** rows
 * announced themselves as the current page, the child and its parent. Only one
 * page can be the current page, so a screen-reader user was told the ancestor
 * was their location just as emphatically as the destination actually was.
 *
 * ARIA has a value for exactly this. `aria-current` is a token, not a boolean:
 * `page` means "this *is* the current page", and `true` means "this is the
 * current item in *some* set" — the right weight for an ancestor that contains
 * the location without being it. So the distinction the visual marker was
 * already making (this row is your section / this row is your page) is now made
 * to assistive technology too, rather than being flattened to `page` twice.
 *
 * Returns `undefined` rather than `"false"` for the inactive case: the absent
 * attribute is the standard way to say "not current", and `aria-current="false"`
 * is treated as absent anyway while adding noise to the DOM.
 */
export function navCurrent(pathname: string, href: string): "page" | true | undefined {
  if (pathname === href) return "page"
  return isActivePath(pathname, href) ? true : undefined
}

/**
 * Whether a group contains the reader's location.
 *
 * Drives the bar's group triggers, which show the active marker when the reader
 * is anywhere inside them — otherwise navigating into a group would lose the
 * only indication of where you are, since the destination's own row is behind a
 * closed menu.
 */
export function isActiveGroup(pathname: string, group: NavGroup): boolean {
  return group.items.some(
    (item) =>
      isActivePath(pathname, item.href) ||
      (item.children?.some((child) => isActivePath(pathname, child.href)) ?? false),
  )
}
