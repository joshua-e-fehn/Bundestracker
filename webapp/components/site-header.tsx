"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { BrandMark } from "@/components/brand-mark"
import { HeaderSignIn } from "@/components/header-sign-in"
import { LocaleToggle } from "@/components/locale-toggle"
import { NavMobile } from "@/components/nav-mobile"
import { useLocale } from "@/components/providers/locale-provider"
import { SearchBar } from "@/components/search-bar"
import { SidebarToggle } from "@/components/sidebar-toggle"
import { ThemeToggle } from "@/components/theme-toggle"
import { api } from "@/convex/_generated/api"
import {
  isCurrentPeriod,
  PERIOD_PARAM,
  parsePeriodParam,
  periodHref,
  resolvePeriod,
} from "@/lib/period"
import { SIDEBAR_RAIL_WIDTH_CLASS } from "@/lib/sidebar-metrics"
import { cn } from "@/lib/utils"

/**
 * The site header: brand, search, and the reader's own controls.
 *
 * **It is no longer the primary navigation.** Destinations live in the sidebar
 * (`components/nav-sidebar.tsx`) at `lg` and up, and in the drawer this bar's
 * menu button opens below it. What is left here is the set of things that are
 * *global utilities* rather than places — the shell's collapse control, the
 * wordmark, the search box, the period chip, language and theme.
 *
 * The account is **not** here any more. It is at the foot of the sidebar at
 * `lg` and up and in the drawer below that — see
 * `components/sidebar-account.tsx` for why there is one of it rather than one
 * in each place.
 *
 * ## What this replaced, twice
 *
 * First a flat row of eight links, whose own comments recorded the arithmetic
 * of running out of room: five labels measured 564 px, the row could not appear
 * below `lg`, the search box had to wait for `xl`, and a ninth route lived only
 * in the mobile sheet because the tenth label would not fit.
 *
 * Then — briefly — three hover-opening group menus in the same bar. That
 * grouped the links honestly but kept navigation in a 56 px strip, which was
 * the wrong structure rather than the wrong grouping. The sidebar is the
 * correction; `components/nav-desktop.tsx` and its test are deleted rather than
 * left beside it, because two desktop navigation systems is the failure the
 * `NAV_SHEET_ONLY` set was already an instance of.
 *
 * ## Why the header spans the full width, above the sidebar
 *
 * The rail starts below this bar rather than beside it. Two reasons, both
 * properties of this site rather than preferences:
 *
 *  - The `federal-rule` hairline is the site's top edge and has to reach both
 *    corners. Inset by 256 px it would read as a decoration on a panel.
 *  - The brand, the search box and the three controls keep the position they
 *    have had since the site launched. Putting them inside the content column
 *    would move all five of them 200 px sideways every time a reader collapsed
 *    a rail they were not looking at.
 */

/**
 * Which Bundestag the reader is looking at, as a chip in the header.
 *
 * Renders nothing while the query is in flight, and nothing when the roster is
 * empty — the two states a fresh deployment passes through. A skeleton here
 * would be a shimmer in the chrome on every page load for a fact that is
 * decoration; and `null` for an unloaded roster keeps the header from asserting
 * a period that has no data behind it.
 *
 * `sm` rather than the `lg` it briefly waited for. It went to `lg` when eight
 * links and a search box were competing for the same bar and the chip squeezed
 * the box down to its own magnifier glyph. With the destinations gone to the
 * sidebar the bar has room again, so the one fact every page is scoped to comes
 * back at the width it fits.
 *
 * ## It reads the URL, not `getCurrentWahlperiode`
 *
 * It used to print the newest period on the roster, unconditionally, and that
 * was correct for exactly as long as every page showed that period. It is now
 * a claim the page can contradict: on `/rankings?wp=19` the old chip said
 * "WP 21" in the chrome above a WP19 table, which is worse than no chip —
 * the one element on screen whose entire job is to say which Bundestag this is
 * would have been the only one saying the wrong number.
 *
 * ## On a historical period it becomes a link back
 *
 * A reader who has switched away needs a way back that does not depend on
 * finding the selector again on whichever page they have since navigated to —
 * and the chip is already the thing that says which period they are in. So it
 * carries the period *and* the way out of it, and it is a real anchor, so
 * middle-click and "open in new tab" work as they do everywhere else. On the
 * current period it stays a plain `<span>`: a link to the page you are already
 * on is a control that does nothing.
 */
function CurrentPeriodBadge() {
  const { t } = useLocale()
  const params = useSearchParams()
  const pathname = usePathname()
  const options = useQuery(api.mps.listPeriods, {})

  const requested = parsePeriodParam(params.get(PERIOD_PARAM))
  const wahlperiode = resolvePeriod(requested, options?.current)

  if (wahlperiode === undefined || wahlperiode === null) return null

  const className =
    "mr-1 hidden rounded-full border border-border/60 px-2.5 py-1 font-medium text-muted-foreground text-xs tabular-nums sm:inline-block"

  if (!isCurrentPeriod(wahlperiode, options?.current)) {
    return (
      <Link
        // The same path without the period — `periodHref` omits the parameter
        // for the current one, so this is the bare URL rather than `?wp=21`.
        // Other parameters ride along: a reader who has filtered a search and
        // wants today's chamber keeps their query.
        href={periodHref(pathname, options?.current ?? wahlperiode, {
          current: options?.current,
          params,
        })}
        title={t("nav.periodBackToCurrent")}
        className={cn(className, "hover:border-border hover:text-foreground")}
      >
        {t("nav.period", { wahlperiode })}
      </Link>
    )
  }

  return (
    <span title={t("nav.periodLabel", { wahlperiode })} className={className}>
      {t("nav.period", { wahlperiode })}
    </span>
  )
}

export function SiteHeader() {
  const { t } = useLocale()

  return (
    <header className="sticky top-0 z-50 w-full border-border/60 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      {/* The flag, as a hairline along the very top of the page. `federal-rule`
          is defined in app/globals.css, which explains at length why the flag
          is confined to 3 px rather than used as UI colour — in short, the page
          already carries meaning-bearing colour in six party hues and a
          red-gold interface underneath them would leave nothing readable as an
          accent.

          It goes on the *header* rather than on `<body>` so it scrolls with
          nothing: the header is sticky, so the rule stays pinned to the top
          edge of the viewport and reads as the site's own edge rather than as a
          decoration that slides away. `aria-hidden` because it is a graphic
          with no accessible content — the wordmark below already names the
          site. */}
      <div aria-hidden className="federal-rule h-[3px] w-full" />

      {/* Full-bleed rather than the `max-w-6xl` this used to centre. The bar now
          sits above a sidebar and a content column rather than above one
          centred page, so a centred inner box would have floated the brand out
          in the middle of the rail's width instead of over it.

          The gutter is on the *inner* row rather than here, because the cell
          beside it has to start at the viewport's left edge — see below. No
          `items-center` either: the children stretch, which is what lets the
          cell be the bar's full height. */}
      <div className="flex h-14 w-full">
        {/* The shell's collapse control, in a cell exactly as wide as the
            collapsed rail — and that width is the whole point of the cell.

            This replaced a `<Separator>`: a 20 px vertical rule, optically
            centred in a 56 px bar, sitting a gutter plus a button's width from
            the left edge. It read as a short floating tick that lined up with
            nothing, while the rail's own right border began at 56 px directly
            below it. Two boundaries a few pixels apart at the same junction is
            worse than one in the wrong place.

            So the cell is `w-14` — `SIDEBAR_RAIL_WIDTH_CLASS`, the same
            constant `components/nav-sidebar.tsx` draws the collapsed rail with
            — and carries `border-r` in the same `border-border/60` as both the
            rail's right border and this header's own bottom one. Full height of
            the bar, so the line runs from the federal rule down to the header's
            border and the rail's border continues it to the foot of the page:
            one join, one line.

            It is a shared constant rather than a matching literal because the
            two numbers must be equal — a cell that is 56 px while the rail is
            57 leaves a visible step at the one place on the page where two
            borders meet, and nothing in a typecheck or a lint would say so.

            Expanded, the rail is 256 px and this cell stays at 56. That is
            correct rather than a limitation: the header does not move when the
            rail does (the note above says why), so the cell marks the shell's
            *fixed* left boundary. The rail simply extends past it below.

            `hidden lg:flex` — paired with the rail's own `lg:flex` and the
            drawer's `lg:hidden` below. Below `lg` there is no sidebar to
            collapse, so the control, its cell and the boundary it draws all go
            with it, and the bar is the padded row alone. */}
        <div
          className={cn(
            "hidden shrink-0 items-center justify-center border-border/60 border-r lg:flex",
            SIDEBAR_RAIL_WIDTH_CLASS,
          )}
        >
          <SidebarToggle />
        </div>

        {/* Everything else, in the gutter the pages use. At `lg` with the cell
            beside it the wordmark starts at 56 px + 24 px — which is exactly
            where a page's own content begins under a collapsed rail, since the
            content column is inset by the same 56 px and carries the same
            `sm:px-6`. Below `lg` the cell is gone and this is the whole bar, so
            a phone keeps the 16 px gutter it had. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4 sm:px-6">
          {/* Truncates rather than `shrink-0`. At 320 px the brand's 112 px plus
            the four controls' 187 px came to 307 px inside a 288 px content
            box, so the header — and with it every page, since the document
            scrolls as one — was 19 px wider than the viewport on every route.
            A wordmark that clips is better than a site that scrolls sideways.

            The mark is `shrink-0` inside that truncating box so the eagle
            survives at 320 px and only the word clips — a wordmark reduced to
            "Bundestra…" beside its mark still reads as the brand; a mark
            squeezed to 4 px reads as a rendering fault.

            It is also the route to `/`, the narrative home page, which is
            therefore not an entry in the navigation: a wordmark that goes home
            is the one convention every site on the web shares. */}
          <Link
            href="/"
            className="mr-2 flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {/* A ramp — 28 px, 32 px from `sm`, 36 px from `lg` — where this was a
              flat 28 (itself up from 20, when the mark was a gold dot rather
              than an eagle inside a ring with the flag's colours banded across
              the feathers).

              Flat 28 was sized for the narrowest viewport and then left there
              for every other one. It is the right floor: at 320 px the brand
              shares the bar with four controls, and the mark is `shrink-0`
              inside a truncating box, so every pixel it gains is a pixel the
              wordmark loses. But a desktop bar has room the phone does not, and
              spending none of it kept the emblem's detail — the ring, the
              feather bands — at phone resolution on a 1440 px screen.

              36 px is the ceiling, not a preference: the bar is `h-14`, so at
              36 the mark keeps 10 px of clearance above and below and stays
              optically centred against the 28 px line-box of the wordmark
              beside it. Anything larger starts setting the bar's height itself,
              which would move the search box and the three controls with it. */}
            <BrandMark className="size-7 sm:size-8 lg:size-9" />
            {/* The wordmark, and the two changes that make it one:

              — `text-lg`, up from `text-base`. The site's name should out-set
                the utilities beside it; at 16 px it was the same size as the
                period chip's neighbours and read as a label rather than as the
                masthead.
              — `font-bold` with `tracking-[0.015em]` — *positive* tracking,
                where every other heading on this site uses `tracking-tight`.
                That inversion is the whole treatment. Tight tracking is what
                editorial headlines do; open tracking on a short, bold word is
                what institutional marks do, and it is the register the federal
                ministries' own wordmarks sit in. It costs 6 px at this size,
                and it is the difference between a heading that happens to say
                "Bundestracker" and a mark that is the site's name.

              Typography only, and no second font: the treatment has to survive
              being set in a browser that loaded nothing, and it has to read the
              same in DE and EN — both of which are the *same string* here, so
              there is no width to trade between locales.

              `truncate` is what keeps a 320 px viewport from scrolling
              sideways, and it stays on the element carrying the text. */}
            <span className="min-w-0 truncate font-bold text-lg tracking-[0.015em]">
              {t("app.name")}
            </span>
          </Link>

          {/* Pushes the controls right and absorbs the slack. The search box sits
            inside it rather than in the control cluster: the slack is exactly
            the space a box wants, and `justify-end` keeps it against the
            controls instead of floating mid-bar. */}
          <div className="flex min-w-0 flex-1 justify-end px-2">
            {/* `md` rather than the `lg` it needed while this bar also carried the
              navigation. The box is the header's main job now, so it appears as
              soon as there is room for it — and below that the drawer carries a
              full-width one, so no width is ever without search. */}
            <SearchBar className="hidden max-w-[16rem] md:flex" />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* The one fact every page on this site is scoped to and none of them
              states in the chrome: which Bundestag you are looking at. Read
              from the URL and the roster rather than from `CURRENT_WAHLPERIODE`,
              for the reason `newestWahlperiode` gives — a constant keeps naming
              the previous Bundestag for months after the next is sworn in.

              `Suspense` is required rather than decorative: the badge reads
              `useSearchParams` to find the period, which opts its subtree out
              of static prerendering, and Next.js fails the *build* for a
              component that reads it without a boundary. The boundary is here
              rather than around the whole header so only the chip waits — and
              the fallback is nothing, because the chip already renders nothing
              while its query is in flight. */}
            <Suspense>
              <CurrentPeriodBadge />
            </Suspense>

            <LocaleToggle />
            <ThemeToggle />

            {/* "Sign in", for a reader who is not. It renders nothing once there
              is a session, so this is *not* the second account control the
              shell rules out — a signed-in reader still has exactly one avatar
              and one way out, at the foot of the rail and of the drawer. See
              components/header-sign-in.tsx.

              It is here because removing the header's old `<UserMenu />` took
              the signed-out half with it, leaving `/sign-in` reachable only
              from the bottom of a rail that may be 56 px of glyphs. The
              top-right corner is where every site on the web puts this, and it
              is the one control whose entire audience has not learned this
              site's chrome yet. `ml-1` sets it off from the two icon toggles
              rather than reading as a third one. */}
            <HeaderSignIn className="ml-1" />

            {/* Paired with the sidebar's own `lg:flex` — the two must flip at the
                same width or the site has no navigation at all between 768 and
                1024 px. Below `lg` this button is also the only route to the
                account, which the drawer carries at its foot. */}
            <NavMobile className="ml-1 lg:hidden" />
          </div>
        </div>
      </div>
    </header>
  )
}
