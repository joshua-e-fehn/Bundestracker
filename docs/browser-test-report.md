# Browser test report

A sweep of every page and every interactive control in a real browser, from a
reader's position rather than a unit test's. Run against a local Convex backend
seeded by `webapp/scripts/seed-local.ts` — 12 MPs, 2 named ballots, 36 speeches,
8 motions, 2 986 activity events, 12 seats.

| | |
|---|---|
| Date | 2026-07-27 |
| Branch | `wave5-browser-testing` |
| Base commit | `73e0471` |
| Tool | Playwright 1.61.0 (Chromium), Python driver |
| App | Next.js 16.2.12 dev (Turbopack) on `:3001` — `:3000` was taken |
| Backend | `CONVEX_AGENT_MODE=anonymous` local backend on `:3210` / `:3211` |
| Viewports | 320, 375, 768, 1280, 1440 px |
| Locales | German (default) and English, both directions |
| Themes | dark (default) and light |

Seven passes: page loads, locale and theme toggles, roster interactions, votes
and seating, profile/rankings/feed, responsive geometry, and a targeted pass
chasing down the anomalies the first six surfaced. Artefacts: 130 screenshots
and seven JSON evidence files.

---

## Summary

**8 of 10 named pages pass.** Two of the ten — `/sign-in` and `/settings` — do
not exist as routes; see [F5](#f5) and [F6](#f6), which are findings about the
task list rather than about broken code.

Four defects were found and **all four are fixed on this branch**. Three more
are recorded as known limitations that were deliberate, verified against the
code that explains them, and left alone. The structure pass that follows found
one duplication — three not-found boundaries sharing one body — and refactored
it; see [F1](#f1).

| # | Finding | Severity | Status |
|---|---|---|---|
| [F1](#f1) | App-wide 404 was English, light-themed, outside the app shell | High | **Fixed** |
| [F2](#f2) | `Michael Brand (Fulda)` rendered as the avatar `M(` on 2 of 4 surfaces | Medium | **Fixed** |
| [F3](#f3) | `/mps/[id]` scrolled sideways to 737 px inside a 375 px viewport | Medium | **Fixed** |
| [F4](#f4) | `/seating` and `/` overflowed on mobile; a scroll affordance was unreachable | Medium | **Fixed** |
| [F5](#f5) | `/sign-in` does not exist, and `AuthGuard` redirects to it | Low | Documented |
| [F6](#f6) | `/settings` does not exist | Low | Documented |
| [F7](#f7) | Segment `not-found` boundaries serve HTTP 200 | Low | Known, framework |

No page-level JavaScript errors were found on any route, in either locale, in
either theme. No broken links. No unlabelled controls.

---

## Per-page results

Each row was loaded in German and English, dark and light, at every viewport.
"Console" counts errors originating in application code — the 404-status
messages Chromium logs for a deliberately-requested missing route are excluded
and reported under their own findings.

| Page | Renders | Data | i18n | Console | Interactions | Verdict |
|---|---|---|---|---|---|---|
| `/` | ✅ | ✅ 4 stat cards, top 5, latest votes, feed | ✅ | clean | nav, both toggles | **Pass** (after F4) |
| `/mps` | ✅ | ✅ 12 rows | ✅ | clean | search, filter, slider, 5-column sort | **Pass** |
| `/mps/[id]` | ✅ | ✅ all 8 sections | ✅ | clean | 5 chart tabs, 7 sliders, reset | **Pass** (after F3) |
| `/rankings` | ✅ | ✅ 9 boards × 11 rows | ✅ | clean | tabs, 3 filters, sort | **Pass** (after F2) |
| `/feed` | ✅ | ✅ 25 items + load more | ✅ | clean | 7 chips, group filter, paging | **Pass** (after F2) |
| `/votes` | ✅ | ✅ 2 ballots | ✅ | clean | search, 2 filters | **Pass** |
| `/votes/[id]` | ✅ | ✅ 12 per-MP rows | ✅ | clean | group filter, MP links | **Pass** |
| `/seating` | ✅ | ✅ 12 seats, 6 groups | ✅ | clean | 5 colour modes, hover, click | **Pass** (after F4) |
| `/sign-in` | ❌ 404 | — | — | — | — | **Not built** — [F5](#f5) |
| `/settings` | ❌ 404 | — | — | — | — | **Not built** — [F6](#f6) |

### What each page was checked for

**`/` — home.** Nav renders all five links (Abgeordnete, Abstimmungen,
Rangliste, Sitzverteilung, Aktivitätsfeed), each resolving 200. Four stat cards
carry real counts. Top-5 leaderboard, latest ballots and the activity preview all
populate. Footer renders with both external links opening in new tabs with
`rel="noreferrer"`.

**`/mps` — roster.** Twelve rows, five translated column headers. Search matches
name *and* constituency, is case-insensitive, and handles transliteration —
`Ozoguz` finds `Sahra Özoğuz`, which is better than the brief asked for. The
empty state reads "Keine Abgeordneten entsprechen den Filtern" with an honest
"0 von 12". The group filter lists all six groups; the minimum-score slider
(0–680) filters live. All five columns sort, each toggling `aria-sort` between
ascending and descending. **All 12 row links were followed and all 12 resolved**
to the right profile. No pagination control — correct at 12 rows, since the
count line reads "12 von 12"; untested above the page limit.

**`/mps/[id]` — profile.** Bio, committees, score, breakdown, weight sliders,
heatmap, trends and three recent-record lists all render. The heatmap draws 335
activities across twelve months. Recharts renders on 4 of 5 tabs; the fifth is
covered under [K1](#k1). The seven weight sliders recompute the score live and
flip the caption to "Mit eigenen Gewichtungen berechnet"; "Standardwerte"
restores it. An MP with no score row (`Lars Klingbeil`) correctly shows "noch
kein Aktivitätswert" and renders no sliders, rather than showing a zero.

**`/rankings`.** All nine boards render 11 rows with board-specific columns.
Three filters work; the group filter narrowed SPD to 2 rows correctly. Medals on
the top three. MP links resolve.

**`/feed`.** Filter chips genuinely filter — verified by reading the event type
off every visible row after each click, not by trusting the button state.
Timestamps are relative and translated ("vor 3 Tagen" → "3 days ago"). "Mehr
laden" grew the list from 2 049 to 3 936 characters. One chip behaviour is
covered under [K3](#k3).

**`/votes` and `/votes/[id]`.** List renders with result badges and distribution
bars; search and both filters work. Detail renders the per-MP table with a
`Mehrheit` column comparing each vote to the group's line, and an `Anmerkung`
column carrying the real reason for an absence ("gesetzlicher Mutterschutz").
The group filter cut 12 rows to 4. Vote-distribution bars carry `title`
attributes ("Ja: 6", "Nein: 3", "Enthaltung: 1"). An unknown ballot id renders
the German not-found boundary.

**`/seating`.** The synthetic-layout warning is prominent, which matters given
what the map claims. All five colour modes repaint the seats — verified by
reading computed `fill` values, not by trusting the tab state. Hovering a seat
shows a tooltip with name, constituency, group, score, participation, committees
and seat reference. Clicking a seat navigates to that MP's profile. The legend
tracks the mode.

---

## Findings

<a id="f1"></a>
### F1 — The app-wide 404 contradicted three of the site's defining choices · High · **Fixed**

`app/not-found.tsx` did not exist, so any unmatched URL fell through to the
Next.js built-in 404. That page reads **"This page could not be found."** — in
English, on a **white** background, **outside the root layout**.

The app is German by default (`lib/i18n.ts`), dark by default
(`components/providers/theme-provider.tsx`), and every other page carries the
header and footer. All three were contradicted at once, on the one page a lost
reader sees. With no shell there was also no nav: no way back except the
browser's own back button.

This is the highest-severity finding precisely because it is invisible to the
test suite — `lib/auth-routes.test.ts` asserts every `page.tsx` directory is
listed as public, and passes, because the missing file is not a page directory.

**Fix:** added `app/not-found.tsx`, with two new dictionary keys
`common.notFoundPage` and `common.backHome` in both languages. It renders inside
the layout, so the header and footer around it still follow the reader's chosen
language even though the boundary itself is German-only for the reason both
existing boundaries document: it is a server component outside the client
`LocaleProvider`.

The structure pass then found that the two existing boundaries
(`app/mps/[id]/not-found.tsx`, `app/votes/[id]/not-found.tsx`) already had
byte-identical bodies, so adding a third copy of that layout was itself the
duplication the protocol forbids. The shared body now lives in
`components/not-found-page.tsx` and each boundary supplies the two keys and the
href that were the only differences.

<a id="f2"></a>
### F2 — One MP had two different avatars depending on the page · Medium · **Fixed**

`Michael Brand (Fulda)` rendered as **`M(`** on `/rankings` and `/feed`, and as
`MB` on `/mps` and `/`. Same person, same data, two labels.

The cause was four separate implementations of `initials`:

| Location | Handles `(Fulda)` | Handles `Dr.` | Handles `von` |
|---|---|---|---|
| `lib/bundestag.ts` | yes | yes | no |
| `lib/format.ts` | yes | no | yes |
| `components/rankings-table.tsx` (private) | **no** | no | no |
| `components/activity-feed-item.tsx` (private) | **no** | no | no |

Each copy was internally consistent and each had passing tests, which is why no
test caught it — the bug lives in the disagreement *between* them, and only a
browser looking at two pages side by side can see that. The two library copies
also disagreed with each other: `Dr. Hülya Düber` and `Alexander von der Leyen`
each rendered correctly through one import path and wrongly through the other.

**Fix:** one implementation in `lib/bundestag.ts` handling all three rules,
re-exported from `lib/format.ts` so existing call sites keep their import. Both
private copies deleted. Six tests added across the two suites covering the rules
each copy was missing. This follows the protocol's rule directly: never a second
way to do something that already exists.

<a id="f3"></a>
### F3 — The MP profile scrolled sideways on a phone · Medium · **Fixed**

At 375 px, `/mps/[id]` rendered a document **737 px** wide — the reader had to
scroll horizontally to read a profile, and the sideways scroll moved the whole
page, header and footer included.

`components/mp-profile.tsx:65` declared
`grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]`. The `lg:` track correctly used
`minmax(0,1fr)`; the implicit single-column track below `lg` did not. A grid
item's `min-width` defaults to `auto` — "at least as wide as my content" — so
the one column sized itself to the widest content in either child. Confirmed by
setting `min-width: 0` in the live page: 737 px → 375 px. Reproduced on a
profile with no charts at all, ruling out recharts as the cause.

**Fix:** `grid-cols-[minmax(0,1fr)]` on the base track — the idiom the `lg:`
track was already using, extended to the case that needed it.

<a id="f4"></a>
### F4 — `/seating` and `/` overflowed, and a scroll affordance was unreachable · Medium · **Fixed**

Same root cause, two more places.

**`/seating` (686 px at 375 px viewport).** `ColorModeToggle` puts
`overflow-x-auto` on its `TabsList` with an explicit comment that five mode names
would otherwise wrap and push the map below the fold. That affordance never
fired: the wrapper is a flex item whose `min-width: auto` refused to shrink past
the labels' combined width, so the container never became narrow enough to
scroll and pushed the page wide instead. The feature was written correctly and
was simply unreachable.

**`/` (534 px at 375 px, 883 px at 768 px).** The `mt-12 grid gap-12` wrapper in
`app/page.tsx` had the same implicit-track problem; the four stat cards'
intrinsic width won.

**Fix:** `min-w-0` on the toggle wrapper and its flex parent;
`grid-cols-[minmax(0,1fr)]` on both home grids.

**Verified after all three fixes**, at 320/375/768/1280 px on all 10 routes:
`main` no longer exceeds the viewport anywhere. The elements still wider than
the screen are all inside deliberate `overflow-x-auto` scroll containers — the
data tables and the heatmap — which scroll their own content without moving the
page. That is the intended pattern, not a defect.

<a id="f5"></a>
### F5 — `/sign-in` does not exist, and `AuthGuard` redirects to it · Low · Documented

The route is absent. Two consequences:

1. **`components/user-menu.tsx` does not use it.** The "Anmelden" button calls
   `authClient.signIn.social({ provider: "github" })` directly, which is a
   deliberate one-click path documented in that file — the sign-in page "is
   where the full choice belongs" once built. Clicking it navigates to GitHub's
   OAuth screen. With no credentials configured locally it arrives at
   `client_id=undefined`, which is a local-environment artefact, not a defect.
2. **`AuthGuard` redirects non-public paths to `/sign-in`,** which 404s. Today
   nothing is non-public, so this never fires for a reader. It is a live trap
   for the first private route added — and `lib/auth-routes.ts` already warns
   about it in a long comment, noting three routes each spent a debugging
   session on exactly this.

Not fixed: building a sign-in page is a feature, outside a testing branch's
scope. Recorded so the next person adding a private route sees it named.

<a id="f6"></a>
### F6 — `/settings` does not exist · Low · Documented

404s. Requesting it produces a visible redirect chain to `/sign-in`, which 404s
in turn — the [F5](#f5) trap firing, since `/settings` is not in `PUBLIC_PATHS`.
The weight sliders the task expects here already exist and work on the MP
profile, where they are usable without an account and captioned "Anmelden, um
eigene Gewichtungen zu speichern". Followed MPs have no UI anywhere yet.

Not fixed: same reason as F5.

<a id="f7"></a>
### F7 — Segment `not-found` boundaries serve HTTP 200 · Low · Known

`/mps/does-not-exist` renders the correct German boundary but returns **200**,
not 404. Already documented at length in `app/mps/[id]/not-found.tsx` as a
verified Next 16.2.12 behaviour that a segment `not-found.tsx` does not fix. The
consequence is for crawlers, not readers. My sweep independently reproduced it,
which confirms the existing note rather than adding to it.

Note the new app-wide 404 from [F1](#f1) *does* return a correct 404 status —
that path is a genuine route miss, which the framework handles properly.

---

## Verified as correct (not defects)

Four behaviours looked wrong from the outside and turned out to be deliberate.
Each is recorded so the next sweep does not re-investigate them.

<a id="k1"></a>
**K1 — The `Anfragen` trend tab draws no chart.** It renders "Für diese Auswahl
wurde in dieser Wahlperiode nichts erfasst." This is `trends.emptyChart` working
as designed: the seeded MP has 3 questions but none in a month the trend series
covers, and `trend-graphs.tsx` argues explicitly that a flat line along zero
"would assert a measurement rather than report an absence". Correct.

**K2 — Every row on the "Aufsteiger:innen" board shows a change of `0,0` and
rank `1`.** An artefact of seed data where each month equals the previous, so
every delta is genuinely zero and `ranked()` ties them all at rank 1. The query
is right; the fixture has no variance. Worth adding month-to-month variance to
`seed-local.ts` so this board is exercised against a realistic distribution.

**K3 — Feed chips replace rather than accumulate.** Selecting `Rede` then
`Antrag` shows only `Antrag`. `components/filter-chips.tsx` is written for
multi-select (`toggle` appends), so this is a page-level wiring question rather
than a component bug, and the visible result — one type at a time — is coherent.
Flagged for a decision rather than as a defect.

**K4 — Party labels stay German in English.** `Grüne`, `Fraktionslos` and
`fraktionslos` appear in the English UI. `lib/parties.ts` holds these as proper
nouns in a `PARTIES` table with a comment explaining the short forms. Proper
nouns not translating is defensible. One inconsistency is worth a look: the
roster shows `fraktionslos` (lowercase, the raw source string) where rankings
and seating show `Fraktionslos` (the table's label) — same status, two spellings,
on the same site.

---

## Internationalisation

**Both languages are complete across every page.** Scanning all seven content
pages in English for German UI strings, and all seven in German for English
ones, found no untranslated interface text in either direction.

- The toggle switches both directions and persists to `localStorage`
  (`bundestrack.locale`); a reload keeps the choice.
- `<html lang>` tracks the locale, so screen readers get the right pronunciation.
- Dates localise correctly: `02.07.2026` → `02/07/2026`.
- Numbers localise correctly: `677,0` → `677.0`, `48.200` → `48,200` — the
  separator swap that would otherwise be a thousand-fold error.
- Relative timestamps translate: "vor 3 Tagen" → "3 days ago".

Untranslated by design, each with a documented reason: German record titles
(`Antrag zur Reform des Wahlrechts` — the actual title of an actual document),
official outcome strings (`Annahme der Vorlage`), party names ([K4](#k4)), and
the two segment not-found boundaries, which are server components outside the
`LocaleProvider`.

---

## Accessibility

Checked on all eight content routes.

| Check | Result |
|---|---|
| Images without `alt` | **0** |
| Buttons without an accessible name | **0** |
| Links without an accessible name | **0** |
| Inputs without a label | **0** |
| Decorative SVGs not `aria-hidden` | **0** |
| `<h1>` per page | exactly 1 everywhere |
| Landmarks | `main`, `nav`, `header`, `footer` present on every page |
| `lang` attribute | correct, and updates with the toggle |
| Keyboard | logical tab order; visible focus rings; `Escape` closes menus |
| `prefers-reduced-motion` | page renders correctly |
| Mobile nav sheet | opens, has an accessible title, closes on navigation |

Sortable table headers set `aria-sort` correctly and toggle it. Filter chips use
real `<button aria-pressed>` inside a `<fieldset>` with a visually hidden
`<legend>`. Seat tooltips are reachable.

**One gap:** the four data tables have neither `<caption>` nor `aria-label`
(`/mps`, `/rankings`, `/votes`, `/votes/[id]`). Each sits under a visible `<h1>`
that names it, so a sighted reader has the context and a screen-reader user
navigating by table does not. Adding `aria-labelledby` pointing at the existing
heading would close it — one attribute per table, no visual change. Not done
here: it touches four components for a non-blocking issue, and belongs in a pass
that can verify it against a real screen reader.

---

## Recommendations

Ordered by value, none blocking.

1. **Label the four data tables** with `aria-labelledby` pointing at the heading
   that already names each one. Smallest real improvement available.
2. **Decide the feed chip semantics** ([K3](#k3)) — the component supports
   multi-select and the page does not use it. Either wire it up or state the
   single-select intent where the next reader will look.
3. **Normalise `fraktionslos` casing** ([K4](#k4)) so the roster and the
   rankings spell the same status the same way.
4. **Give `seed-local.ts` month-to-month variance** so the "Aufsteiger:innen"
   board and the trend charts are exercised against a distribution with actual
   movement in it ([K2](#k2)).
5. **When the first private route lands, build `/sign-in` first** — `AuthGuard`
   already redirects there ([F5](#f5)).
6. **Add a regression guard for document width.** F3 and F4 were three instances
   of one CSS mistake, each invisible to `bun test`. A check that
   `document.scrollWidth <= clientWidth` at 375 px on every route would have
   caught all three, and would catch the fourth.

---

## Reproducing this

```bash
cd webapp
bun install
CONVEX_AGENT_MODE=anonymous bunx convex dev            # local backend, :3210/:3211
bunx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
bunx convex env set SITE_URL http://localhost:3000
bunx convex env set PIPELINE_API_KEY dev-seed-key
CONVEX_SITE_URL=http://127.0.0.1:3211 PIPELINE_API_KEY=dev-seed-key \
  bun run scripts/seed-local.ts
bun run dev
```

`bunx convex dev` writes `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_CONVEX_SITE_URL` into `.env.local` itself, which is what the Next
build needs at module load — see `webapp/.env.example`. Set `SITE_URL` to
whichever port Next actually binds; it picks the next free one if 3000 is taken.

**Post-fix state:** `bun test` 241 pass / 0 fail, `bun run typecheck` clean,
`bun run lint` clean.
