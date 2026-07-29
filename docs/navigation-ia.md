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
  `before-prod-dashboard-desktop.png`. With destinations moved to the sidebar
  the header is brand, search and controls only, so the box returns at `md` and
  the period chip at `sm`.

A flat row cannot absorb another feature. The next one would have gone into the
mobile sheet only, or nowhere.

> Note on framing: the task asked for a desktop sidebar. A first attempt read
> that as a *grouping* problem and shipped grouped dropdowns in the header,
> arguing a rail was wrong for this product. That was a misreading — the ask was
> structural — and it was rejected. The navigation is now a real collapsible
> sidebar; see [Desktop](#desktop-a-collapsible-sidebar-app-shell) for which of
> the original objections survived (two, both answered by collapsing) and which
> did not.

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
   link. Three groups of two-to-four entries is the shape the sidebar is built for.
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

## Desktop: a collapsible sidebar app shell

The navigation is a **left sidebar integrated into the page shell** at `lg` and
up — the pattern the reference implementation (Fiscalis) uses, and what this
work exists to correct to. An earlier attempt put three hover-opening group
menus in the header instead; that grouped the links honestly but kept navigation
in a 56 px strip, which was the wrong *structure* rather than the wrong
grouping, and it was rejected.

### The two states

| | Expanded (default) | Collapsed |
|---|---|---|
| Width | 16 rem (256 px) | 3.5 rem (56 px) |
| Rows | icon + label, grouped under section headings | icon only |
| Group boundary | heading (`ABGEORDNETE & FRAKTIONEN`) | a hairline rule |
| Naming | visible text | `aria-label` + tooltip on hover |

**Expanded is the default**, and that is the answer to the objection the header
version raised: a public document should not make a first-time reader discover
and expand a rail before they can read the navigation. Only a *deliberate*
collapse is remembered.

**Collapsing is persisted in a cookie** (`bt_sidebar`, a year, `SameSite=Lax`),
read on the **server** in `app/layout.tsx`. That last part is the whole reason
it is a cookie rather than `localStorage`: `localStorage` is only reachable
after hydration, so a reader who had collapsed the rail would get the 16 rem
shell in the server HTML, see it painted, and watch every page's content column
jump 200 px as it snapped. Fiscalis writes the same cookie but hardcodes
`defaultOpen = true` and never reads it, so it has exactly that flash. Reading
it is the part worth taking. `lib/sidebar-state.ts` holds the parsing as a pure
function so the server's cookie store and the client's `document.cookie` answer
identically; absent or malformed means **expanded**, because navigation is the
wrong thing to hide on a value nobody can account for.

`Ctrl`/`⌘`+`B` toggles it, ignored while focus is in a text field — `⌘B` is bold
in every rich-text control ever written, and the search box is one keystroke
away on every page.

### Content reflows; it is never covered

The rail is `position: fixed`, so it takes no space in flow. `AppShell` gives
that space back by padding the content column by exactly the rail's width, and
publishes the amount as `--shell-inset` so the two viewport-`fixed` decorations
on the home page can read it — padding does not affect a `fixed` descendant's
containing block, so a variable is the only thing they can consult. Measured in
Chromium: collapsing returns exactly 200 px to the content box on every route,
and no route overlaps the rail or scrolls sideways.

The header stays **full-width above** both the rail and the column. The
`federal-rule` hairline is the site's top edge and has to reach both corners,
and the brand, search box and controls keep the position they have always had
rather than sliding 200 px sideways whenever the rail is toggled.

### What was taken from the reference, and what was not

Taken: the shell shape, `collapsible="icon"` semantics, the persisted state,
`Ctrl/⌘+B`, tooltips standing in for hidden labels, and grouped sections.

**Not taken: shadcn's `sidebar.tsx` itself**, all 773 lines. It carries a mobile
`Sheet` branch driven by a `useIsMobile` media-query hook, a `SidebarRail` drag
affordance, badges, skeletons, actions, three variants and two sides — of which
this site would use the rail and nothing else. Vendoring it would have added a
second sheet implementation beside `components/ui/sheet.tsx`, a second
breakpoint system (JS `matchMedia`) beside the CSS one everything else uses, and
a second `TooltipProvider`. The protocol forbids a second way to do something
that already exists, so the rail is written against the primitives this repo
already has. The `matchMedia` split is also worse on its own terms: it makes the
first paint a guess, whereas a `lg:` media query puts both surfaces in the HTML
and lets the browser choose before any script runs.

### The objections the header version raised, answered

- **"A rail costs content its width permanently."** True, which is why it
  collapses to 56 px, why that choice is one click away and remembered, and why
  there is no rail at all below `lg`.
- **"Icon-only is not honest for these labels."** Also true — "Sitzverteilung"
  and "Untersuchungsausschuss" have no conventional glyph. So the collapsed rail
  is not icon-*only*: every row keeps an `aria-label` with the full label and a
  tooltip showing it, and the expanded state is the default precisely because
  the words are the honest version. Icons are a landmark for a reader who
  already knows the site, never a replacement for telling them.

Every destination carries an icon, and `icon` is **non-optional** on `NavItem`:
collapsed, it is the only thing left of a row, so a new entry cannot be added
without deciding what it looks like at 16 px. `lib/navigation.test.ts` asserts
no two destinations share one — in the rail the glyph *is* the row, so a
duplicate is two rows a reader cannot tell apart.

### One label is clipped, on purpose

"Abstimmungen über eigene Angelegenheiten" is 286 px of text in a 181 px track.
Without `grid-cols-[minmax(0,1fr)]` on both grid levels *and* `min-w-0` on the
row, it made its whole group 97 px wider than the rail and pushed three rows out
over the page (81 px in English) — a grid's implicit column is `auto`, which
sizes to its widest item and refuses to shrink, and a flex item's `min-width:
auto` floor is its content's full length. `truncate` cannot help while the track
has already agreed to be that wide. Both halves are needed; either alone still
overflows. The row carries a `title` so the clipped text stays recoverable.

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
- Every sidebar row is a real link in DOM order, tabbable, with a visible focus
  ring; collapsed rows keep their name via `aria-label` rather than relying on a
  pointer-driven tooltip a screen reader may never open. The label is *removed*
  when collapsed rather than hidden with CSS — a clipped label is still in the
  accessibility tree, so hiding it would announce every row twice.
- The collapse control is a `<button>` carrying `aria-expanded` and a label that
  says what it will *do* ("Seitenleiste einklappen" / "ausklappen"), not merely
  what it acts on. Focus stays on it after activation.
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

**Re-verified after the rebase onto `main`**, against a production build:
**47/47** checks passed at 1440, 390 and 320 px in both locales — the same
properties as above plus the three modal ones in the table further up. The run
that found the modal defect scored 46/47 before the fix, with the three modal
rows failing; they pass now.

One check is **intermittent under the harness** and is recorded here rather than
quietly dropped, because it did not fully fit the "environment artifact" story
it would have been convenient to file it under. A *synthetic* Playwright click
on a menu row occasionally fails to navigate — about 1 time in 10 (45/50 across
repeated runs), though the final run above was 47/47. What rules it out as a
defect in this change:

- It reproduces **identically with and without** `modal={false}`, so the modal
  fix neither causes nor hides it.
- The click **reaches the anchor every time**, verified with a capture-phase
  listener — which is itself enough to make it pass 3/3, the signature of a
  timing race in the harness rather than a logic error.
- It is **not reproducible by hand** at any speed.

What keeps it honest to call a harness issue rather than a proven one: it is
specific to menu rows. Plain header and footer links were 14/14 in the same
session, so this is not simply "synthetic clicks are flaky here". The suspect is
Playwright's synthesised pointer sequence against Radix's `onPointerUp` →
`currentTarget.click()` re-dispatch, which plain links do not go through. Worth
revisiting if a human ever reports a dropped click.

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

---

## Screenshots

`docs/screenshots/navigation/` holds three generations. Read them in this order
or they will mislead you:

| Prefix | What it shows | Status |
|---|---|---|
| `sidebar-*` | The shipped sidebar app shell | **Current** |
| `after-local-*` | The grouped header dropdowns | **Superseded — rejected design** |
| `before-prod-*` | The original flat eight-link row | Historical |

The `after-local-*` set is kept rather than deleted because the note above
refers to it: it is the evidence of what was tried and rejected, and deleting it
would leave that paragraph pointing at nothing. Nothing in it describes the
current navigation.

Current set, all captured against a production build at 1440 px unless stated:

- `sidebar-desktop-expanded.png` — the default state, German
- `sidebar-desktop-collapsed.png` — the icon rail, with a tooltip open
- `sidebar-desktop-expanded-en.png` — English, confirming labels and the
  translated landmark
- `sidebar-desktop-dark.png` — dark theme
- `sidebar-1024-boundary.png` — exactly 1024 px, the width the rail appears at
- `sidebar-mobile-drawer-390.png` / `-320.png` — the drawer, no permanent rail
