# Navigation & information architecture

Where a page goes in the navigation, and why. Written so the next feature has a
placement rule rather than another line in a flat list.

The tree itself is `webapp/lib/navigation.ts` — that file is the source of
truth and this note is the reasoning behind it. `webapp/lib/navigation.test.ts`
enforces the parts that can be checked mechanically.

---

## The problem this replaced

Bundestracker's navigation was a single row of links in the sticky header.
It had grown to eight, and the header's own comments recorded the arithmetic of
running out of room: five labels measured 564 px, the row could not appear below
`lg` at all, the search box had to wait for `xl`, and "Untersuchungsausschuss"
(24 characters) was excluded from the row by a hand-written `NAV_SHEET_ONLY` set
because adding it pushed the bar past its container.

Two things followed from that, both visible in `docs/screenshots/navigation`:

- **A ninth route had no entry at all.** `/votes/own-resources` was reachable
  only from a sentence in the middle of `/votes`.
- **The search box was crushed.** With eight links and a `WP 21` chip competing
  for the same bar, the box rendered as a bare magnifier glyph — see
  `before-prod-dashboard-desktop.png`.

A flat row cannot absorb another feature. The next one would have gone into the
mobile sheet only, or nowhere.

> Note on framing: the task described this as an "always-expanded desktop
> sidebar". There is no sidebar in this codebase and never was — the navigation
> is and remains a sticky header bar. The complaint underneath ("visually noisy
> and hard to use because the product now has many features") was accurate, and
> is what this addresses.

---

## The grouping

Groups name **what the reader is looking for**, not the shape of the data and
not the order features were built.

| Group | Question it answers | Entries |
|---|---|---|
| — | *Everything at once* | `/dashboard` |
| **Abgeordnete & Fraktionen** | *Who?* | `/mps`, `/rankings`, `/parties`, `/seating` |
| **Entscheidungen** | *What did the Bundestag do?* | `/votes` (→ `/votes/own-resources`), `/inquiry-quorum` |
| **Einordnung** | *What does this mean?* | `/feed`, `/about` |

Two destinations sit outside the groups deliberately:

- **`/dashboard`** is not a category, it is all three at once, and it is the one
  destination a returning reader wants from anywhere. It stays a single click
  from every page.
- **`/` (the narrative home)** is reached through the wordmark — the one
  convention every site on the web shares — so it is not a nav entry.
- **`/search`** is a *box* in the bar and an *entry* in the mobile drawer. A
  link beside a box pointing at the same feature would be two controls for one
  thing; below the width that fits a box, the drawer carries both.

### Why "Sitzverteilung" is under *people* and not under *decisions*

The seating map is a picture of who holds a mandate — its subject is the
members, arranged. It is not a parliamentary act. Every entry under
*Entscheidungen* has a date and a document behind it; the seating map has
neither.

---

## The placement rule for new features

1. **A narrower cut of an existing entry's subject becomes a `child` of it.**
   `/votes/own-resources` is a curated subset of the ballots, so it is nested
   under `/votes` rather than added as a peer.
2. **A genuinely new question gets a new top-level entry** in whichever group
   the question belongs to.
3. **A page that would need a fourth group** means the site has grown a new
   *kind* of thing. That is a decision to make deliberately, not by adding a
   link. Three groups of two-to-four entries is the shape the bar is built for.
4. **Nothing is dropped to keep the list short.** Progressive disclosure here
   means *grouped*, not *hidden* — every route with a page is in the tree, one
   hover or one tap away, and a test asserts it against the filesystem.

The failure mode to avoid is the one being left behind: a new feature landing as
another peer in a flat row, one at a time, until the bar is a wall again.

---

## Public vs authenticated

**Every product page is public, for everyone, signed in or not.** Bundestracker
publishes public parliamentary records; an account is not a gate and never
becomes one. `webapp/lib/auth-routes.ts` is the source of truth and
`lib/navigation.test.ts` asserts that every navigable destination is on it — so
a nav entry that would redirect a signed-out reader to sign-in fails the suite.

**The navigation is identical in both states.** There is no signed-in-only
section, because the data model does not support one honestly. Signing in stores
exactly two things (`convex/userPreferences.ts`): custom score weightings and a
followed-MP list. Both are applied *in place* on the pages that use them —
`/mps/[id]`'s score panel and the feed's ranking — rather than on pages of their
own.

So the personal area is the **`UserMenu` in the header corner**, and it holds
what genuinely exists: the account identity and sign-out. No settings page, no
profile page, no empty "Saved" section. Criterion 5 of the brief asked for the
architecture to be ready without fabricating functionality; the rule for when
that changes is:

> When a signed-in user gains state that needs a *page* of its own — a real
> follow list, a saved-weightings manager — it becomes a fourth group in
> `NAV_GROUPS`, rendered only when a session exists, and `PUBLIC_PATHS` gains
> its first genuine omission. Not before.

---

## Desktop: grouped menus, not a collapsible rail

The reference implementation (Fiscalis) uses shadcn's `Sidebar` with
`collapsible="icon"` — a 16 rem rail collapsing to 3 rem, persisted in a cookie,
tooltips standing in for hidden labels. That is right for Fiscalis and wrong
here, for reasons that are properties of *this* product:

- **This is a public document, not a workspace.** Readers arrive from a search
  engine or a pasted link, read one page, and leave. A rail that must be
  discovered, expanded and remembered is overhead paid on every first visit to
  be repaid on a return visit most readers never make.
- **A left rail costs content its width permanently.** Every page is a centred
  `max-w-6xl` column of tables, charts and a seating arc already tight at
  1024 px. Taking 256 px off all of them to hold nine links is the layout
  obstruction the brief rules out.
- **Icon-only is not honest for these labels.** "Sitzverteilung",
  "Untersuchungsausschuss" and "Fraktionsvergleich" have no conventional glyphs.
  A rail of nine invented icons is a guessing game, and the tooltips that fix it
  are the labels again, one hover later.

What transfers is the *strengths*, not the component: named groups instead of a
flat list, progressive disclosure of the long tail, an unambiguous active state,
a description on every destination, and a deliberately separate mobile pattern.
What is dropped is the collapse toggle and its persisted state — a 56 px header
has nothing to collapse.

**Result:** the bar carries four items (`Dashboard` + three group names, ~340 px
in German) instead of eight. That freed width is what lets the search box return
to `lg`, where the old code had proved it could not fit.

Menus open on **click, keyboard, and hover** (mouse pointers only — a
hover-open menu on a touch screen fires on the tap meant to follow the link).
Without hover, every destination that used to be one click away would be two.

## Mobile: a drawer, everything visible

Below `lg`, a right-side sheet carrying the **whole tree, expanded**, under group
headings. Deliberately a different pattern rather than the same one shrunk: the
desktop bar collapses groups because 56 px of width forces it, and a drawer that
scrolls has no such constraint. Hiding the same entries behind nine taps of
disclosure would be ceremony with nothing to buy.

Both surfaces read `lib/navigation.ts`, so a route cannot appear in one and not
the other — the drift the old hand-maintained `NAV_SHEET_ONLY` set invited.

---

## Accessibility

- Both surfaces are `<nav>` landmarks with distinct `aria-label`s (the footer
  has a third).
- Active location is `aria-current="page"` **and** a gold marker that is a
  *shape* (an underline in the bar, a left rule in the menus and drawer), so it
  survives greyscale and colour-vision deficiency. It is absolutely positioned,
  so turning it on shifts nothing.
- A group trigger carries the marker when the reader is anywhere inside it —
  otherwise navigating into a group would lose all indication of location, since
  the destination's own row is behind a closed menu.
- Group triggers are real `<button>`s; Radix supplies `aria-expanded` and
  `aria-haspopup`, and arrow keys move through entries including nested ones.
- The drawer is Radix's `Dialog`: focus moves in on open, is trapped, and
  returns to the trigger on close; Escape and the overlay dismiss.
- Both panels close on route change — including a change the reader did not
  start from the panel (`lib/use-dismiss-on-navigate.ts`).
- Icon-only controls carry accessible names; the menu button is 32 px with
  padding past 44 px, and every drawer row is ≥ 44 px tall.
- The chevron's rotation is animated but not gated on animation, so
  `prefers-reduced-motion` drops the transition and keeps the state.

---

## Verification

50/50 browser checks passed at 1440, 1024, 390 and 320 px, in German and
English: group disclosure, keyboard operation, active state on nested routes,
drawer open/close/navigate, focus handling, and zero horizontal overflow at
every width. Screenshots are in `docs/screenshots/navigation`
(`before-prod-*` is current production, `after-local-*` is this branch).

### Three pre-existing bugs found and fixed along the way

None were navigation bugs; all three were found *because* the navigation was
being exercised in a real browser, and two of them blocked the acceptance
criteria.

1. **Every client-side navigation threw** `Cannot read properties of null
   (reading 'removeChild')`. `ThemeColorSync` called `.remove()` on the two
   `<meta name="theme-color">` tags that `app/layout.tsx` renders through its
   `viewport` export — React owns those nodes, so the next reconciliation of
   `<head>` unmounted an already-detached element. It tore down the React tree,
   which is how it surfaced: the mobile drawer stopped closing after a tap,
   because the state update that closes it never ran. Reproduced afterwards on a
   plain footer link with no overlay on screen. Fixed by neutralising the tags
   (`media="not all"`) instead of detaching them; pinned by
   `components/providers/theme-color.test.ts`.
2. **`getChamberFeed` and `getFeed` returned a validation error**, rendering
   `/feed` and the feed sections of `/dashboard` and `/` as their error
   boundary. Both return validators were built from `activityEventInput` (the
   ingestion payload) while the handlers return the stored row, which also
   carries the derived `searchText`. Fixed by listing the field, optional,
   because `convex/search.ts` backfills older rows.
