import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * Guards on the app shell's structure.
 *
 * Replaces `components/nav-desktop.test.ts`, which pinned the grouped header
 * menus' `modal={false}` — a prop on a component that no longer exists. The
 * bugs *this* file guards against are the ones a sidebar shell has, and they
 * share the shape that made the old test worth writing: each is invisible to a
 * typecheck, each looks like a tidy-up when someone removes it, and each is
 * only reproducible in a real layout engine, which `bun test` does not have.
 * The browser smoke is the real verification; this makes the regression fail on
 * the commit that causes it rather than in a reader's browser.
 *
 * They are written against the source text for that reason — the same technique
 * `components/providers/theme-color.test.ts` uses, and for the same reason.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url).pathname, "utf8")

/** The file with comments stripped, so a prop *named* in the prose does not
 * satisfy a check looking for the prop being *passed*. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const sidebar = strip(read("./nav-sidebar.tsx"))
const shell = strip(read("./app-shell.tsx"))
const header = strip(read("./site-header.tsx"))
const layout = strip(readFileSync(new URL("../app/layout.tsx", import.meta.url).pathname, "utf8"))

describe("the sidebar is a shell, not an overlay", () => {
  test("the content column is inset by the sidebar's width", () => {
    // The whole correction in one assertion. A `fixed` rail takes no space in
    // flow, so without a matching inset on the content it does not push the
    // page aside — it *covers* it, which is the "content reflows cleanly rather
    // than being covered" requirement failing. The padding and the variable
    // that drives it are the mechanism.
    expect(shell).toMatch(/pl-\(--shell-inset\)/)
    expect(shell).toMatch(/--shell-inset-lg/)
  })

  test("the inset is zero below the sidebar's breakpoint", () => {
    // The sidebar is `hidden` below `lg`, but `hidden` does not un-set a
    // variable — so without an explicit zero a phone would inherit whatever
    // width a desktop reader last left in the cookie and every page would sit
    // in a 256 px-narrower column with nothing beside it.
    expect(shell).toMatch(/\[--shell-inset:0px\]/)
    expect(shell).toMatch(/lg:\[--shell-inset:var\(--shell-inset-lg\)\]/)
  })

  test("the sidebar and the mobile drawer flip at the same width", () => {
    // Paired breakpoints. If these ever disagree the site has either two
    // navigations at once or — far worse and the way it actually fails — none
    // at all in the band between them.
    expect(sidebar).toMatch(/\blg:flex\b/)
    expect(sidebar).toMatch(/\bhidden\b/)
    expect(header).toMatch(/lg:hidden/)
  })

  test("the sidebar starts below the header rather than behind it", () => {
    // The header is sticky and full-width; the rail begins at its bottom edge —
    // 3.5 rem plus the 3 px federal rule. Spelled with an explicit `bottom-0`
    // rather than `inset-y-0` because two Tailwind utilities of equal
    // specificity resolve by their order in the generated stylesheet, not in
    // the class attribute, so `inset-y-0 top-[…]` is a coin flip.
    expect(sidebar).toMatch(/top-\[calc\(3\.5rem\+3px\)\]/)
    expect(sidebar).toMatch(/bottom-0/)
    expect(sidebar).not.toMatch(/inset-y-0/)
  })
})

describe("the header meets the rail in one line", () => {
  const metrics = readFileSync(
    new URL("../lib/sidebar-metrics.ts", import.meta.url).pathname,
    "utf8",
  )

  test("the two widths are one constant, not two matching literals", () => {
    // The defect this replaced: a 20 px `<Separator>` floating in the middle of
    // the bar, a gutter and a button's width from the left edge, while the
    // rail's own right border began at 56 px directly below it. Two boundaries
    // a few pixels apart at the same junction.
    //
    // The fix is a header cell of exactly the collapsed rail's width, so its
    // right border continues into the rail's. That only holds while the two
    // numbers are the *same* number — a cell at 56 px against a rail at 57
    // leaves a visible step at the one place on the page where two borders
    // meet, and nothing in a typecheck or a lint would say so. Hence a shared
    // constant, and hence this test: the way the alignment breaks is someone
    // inlining a literal back into one of the two files.
    expect(sidebar).toMatch(/SIDEBAR_RAIL_WIDTH_CLASS/)
    expect(header).toMatch(/SIDEBAR_RAIL_WIDTH_CLASS/)
    expect(sidebar).not.toMatch(/"w-14"|expanded \? "w-64"/)
  })

  test("the shared width is spelled literally so Tailwind can find it", () => {
    // Tailwind v4 extracts candidates from the raw *text* of scanned files. A
    // class name built by concatenation compiles, typechecks, and emits no CSS
    // at all — the rail and the cell would both collapse to zero width. The
    // constants must therefore be literal strings.
    expect(metrics).toMatch(/SIDEBAR_RAIL_WIDTH_CLASS = "w-14"/)
    expect(metrics).toMatch(/SIDEBAR_EXPANDED_WIDTH_CLASS = "w-64"/)
    // And the rem lengths the shell's inline style needs must agree with them.
    expect(metrics).toMatch(/SIDEBAR_RAIL_WIDTH = "3\.5rem"/)
    expect(metrics).toMatch(/SIDEBAR_EXPANDED_WIDTH = "16rem"/)
    expect(shell).toMatch(/SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH/)
  })

  test("the cell draws a full-height border in the rail's own colour", () => {
    // `border-r`, not a centred `<Separator>`: the line has to run the full
    // height of the bar so it reaches the header's bottom border, where the
    // rail's border picks it up and carries it to the foot of the page. A short
    // rule optically centred in the bar is the defect, not a smaller version of
    // the fix — so the separator import is gone rather than left unused.
    expect(header).toMatch(/border-border\/60 border-r/)
    expect(header).not.toMatch(/Separator/)
    // Same token as the rail's own right border, or the one line changes colour
    // halfway down.
    expect(sidebar).toMatch(/border-border\/60 border-r/)
  })

  test("the bar stretches its cell rather than centring it", () => {
    // `h-14` with no `items-center` on the row: the cell is a flex child that
    // stretches to the bar's full height, which is what makes the border reach
    // both edges. Adding `items-center` back to the row shrink-wraps the cell
    // to the button and the line becomes a floating tick again — the exact
    // defect, rebuilt.
    expect(header).toMatch(/className="flex h-14 w-full">/)
  })

  test("the gutter moved inside, so the cell can start at the edge", () => {
    // The cell has to begin at x=0 to be 56 px wide *from the viewport edge*,
    // which is where the rail below it starts. So the page gutter belongs to
    // the row beside the cell rather than to the bar. Below `lg` the cell is
    // gone and that row is the whole bar, so a phone keeps its 16 px gutter.
    expect(header).toMatch(/flex min-w-0 flex-1 items-center gap-2 px-4 sm:px-6/)
  })
})

describe("the collapsed rail stays readable", () => {
  test("rows carry an accessible name when their label is not rendered", () => {
    // Collapsed, the `<span>` holding the label is not rendered at all — so
    // without `aria-label` the row would announce as a bare link with no name.
    // The tooltip does not supply one: it is pointer-driven, and a screen
    // reader may never open it.
    expect(sidebar).toMatch(/aria-label=\{expanded \? undefined : label\}/)
  })

  test("the label is removed rather than hidden with CSS", () => {
    // A label clipped by `overflow-hidden` is still in the accessibility tree
    // and still found by find-in-page, so a collapsed rail would announce every
    // label twice — once from `aria-label` and once from the text it names.
    expect(sidebar).toMatch(/\{expanded && <span className="truncate">\{label\}<\/span>\}/)
  })

  test("collapsed rows get a tooltip carrying the same label", () => {
    expect(sidebar).toMatch(/<TooltipContent side="right"/)
    expect(sidebar).toMatch(/if \(expanded\) return link/)
  })

  test("long labels are clipped rather than widening the rail", () => {
    // Measured in Chromium against a production build: without these the
    // child row's "Abstimmungen über eigene Angelegenheiten" (286 px of text)
    // made its whole group 97 px wider than the 256 px rail, pushing three rows
    // out from under the sidebar and over the page. English overflowed by 81 px
    // on the same three rows.
    //
    // Two halves, and either alone still overflows: a grid's implicit column is
    // `auto`, which sizes to its widest item and refuses to shrink, and a flex
    // item's `min-width: auto` floor is its content's full length. `truncate`
    // on the label cannot help while the track it sits in has already agreed to
    // be that wide.
    const tracks = sidebar.match(/grid-cols-\[minmax\(0,1fr\)\]/g) ?? []
    expect(tracks.length).toBeGreaterThanOrEqual(2)
    expect(sidebar).toMatch(/flex h-9 min-w-0/)
  })

  test("a clipped label stays recoverable", () => {
    // `truncate` turns the one over-long label into an ellipsis, which is only
    // acceptable if the full text is still reachable. `title` is the browser's
    // own affordance for that.
    expect(sidebar).toMatch(/title=\{expanded \? label : undefined\}/)
  })

  test("group boundaries survive the collapse", () => {
    // Hiding the group headings outright would run three groups' icons into one
    // undifferentiated column of nine — the "wall of links" this redesign
    // exists to undo, rebuilt in glyphs. A rule keeps the grouping legible
    // where the words do not fit.
    expect(sidebar).toMatch(/if \(!expanded\)/)
    expect(sidebar).toMatch(/h-px bg-border/)
  })
})

describe("the shell's controls are each in one place", () => {
  const toggle = strip(read("./sidebar-toggle.tsx"))
  const account = strip(read("./sidebar-account.tsx"))
  const drawer = strip(read("./nav-mobile.tsx"))

  test("the collapse control is in the header, before the brand", () => {
    // Fiscalis's placement (frontend/components/atomic/organisms/header.tsx:28)
    // and the point of moving it: collapsed to 3.5 rem, the only way back to
    // the labels used to be a 28 px glyph at the bottom of a column of ten
    // other glyphs, below the fold on a short window. The control over the
    // shell now sits at a fixed screen position in both states.
    expect(header).toMatch(/<SidebarToggle/)
    const toggleAt = header.indexOf("<SidebarToggle")
    const brandAt = header.indexOf("<BrandMark")
    expect({ toggleBeforeBrand: toggleAt !== -1 && toggleAt < brandAt }).toEqual({
      toggleBeforeBrand: true,
    })
  })

  test("there is no second collapse control in the rail", () => {
    // The duplicate is the failure mode a move invites: two buttons wired to
    // the same `toggle()`, one of which a reader has to discover. The rail
    // renders the account in that slot now and nothing else.
    expect(sidebar).not.toMatch(/<SidebarToggle/)
    expect(sidebar).toMatch(/<SidebarAccount expanded=\{expanded\} \/>/)
  })

  test("the toggle is hidden where there is no sidebar to collapse", () => {
    // Below `lg` the rail is `hidden`, so an enabled trigger would be a button
    // that toggles a thing that is not on screen. Paired with the rail's own
    // `lg:flex` and the drawer's `lg:hidden`, like every other breakpoint here.
    //
    // The breakpoint is on the *cell* rather than on the button now — the cell
    // also draws the boundary line, and hiding only the button would leave a
    // 56 px empty bordered box on a phone. So the assertion reads the wrapper,
    // which is the element that has to carry both classes.
    const cell = header.slice(0, header.indexOf("<SidebarToggle"))
    expect(cell).toMatch(/\blg:flex\b/)
    expect(cell).toMatch(/\bhidden\b/)
  })

  test("the toggle works without being handed the state", () => {
    // The header does not render the rail and has no reason to hold its state,
    // so the prop is optional and context is the fallback. A required prop here
    // is what would push the header into subscribing on the rail's behalf.
    expect(toggle).toMatch(/expanded\?: boolean/)
    expect(toggle).toMatch(/expandedProp \?\? expandedContext/)
  })

  test("the account is in the rail and the drawer, and not in the header", () => {
    // One account control per surface, and never two on one screen. The header
    // had `<UserMenu />`; that component is deleted rather than left beside
    // this, because two avatars wired to the same session is the "second way to
    // do something that already exists" the protocol rules out.
    expect(header).not.toMatch(/UserMenu|SidebarAccount/)
    expect(drawer).toMatch(/<SidebarAccount expanded \/>/)
  })

  test("the header's sign-in disappears once there is a session", () => {
    // The header carries a signed-out `Sign in` again — the half that went
    // missing when `<UserMenu />` was deleted, leaving `/sign-in` reachable
    // only from the foot of a rail that may be collapsed to 56 px of glyphs.
    //
    // What keeps that from being the duplicate account control the test above
    // forbids is this early return: signed in, it renders nothing, so a reader
    // with a session still has exactly one avatar and one way to sign out.
    // Without it the header would grow a second, permanent account entry and
    // the rule would be broken by the component that exists to respect it.
    const signIn = strip(read("./header-sign-in.tsx"))
    expect(signIn).toMatch(/if \(session\) return null/)
    expect(signIn).toMatch(/href="\/sign-in"/)
    // No avatar, no menu, no sign-out — those belong to `SidebarAccount`.
    expect(signIn).not.toMatch(/Avatar|DropdownMenu|signOut/)
    expect(header).toMatch(/<HeaderSignIn/)
  })

  test("the account routes to the real sign-in page rather than a new one", () => {
    // No invented settings route: `/sign-in` exists and owns the OAuth call
    // (components/sign-in-panel.tsx), and signing out goes through the same
    // `authClient` the header's menu used.
    expect(account).toMatch(/href="\/sign-in"/)
    expect(account).toMatch(/authClient\.signOut\(\)/)
  })
})

describe("the active state keeps the PR #41 correction", () => {
  test("aria-current comes from navCurrent, not from the prefix match", () => {
    // `isActivePath` is a *prefix* match and drives the gold rule — that is
    // what keeps `/votes` marked on `/votes/own-resources`. Reusing it for
    // `aria-current` made two rows announce themselves as the current page.
    // The two answer differently on purpose; see lib/navigation.ts.
    expect(sidebar).toMatch(/aria-current=\{navCurrent\(pathname, item\.href\)\}/)
    expect(sidebar).not.toMatch(/aria-current=\{isActivePath/)
  })

  test("the visual marker still uses the prefix match", () => {
    // Guarding the over-correction: narrowing what is announced must not narrow
    // the highlight, or navigating into a section would lose the only
    // indication of which section you are in.
    expect(sidebar).toMatch(/const active = isActivePath\(pathname, item\.href\)/)
  })
})

describe("there is one desktop navigation", () => {
  test("the header no longer renders a nav of destinations", () => {
    // The rejected design: grouped dropdowns in the header. Two competing
    // desktop navigation systems is the state this correction exists to leave,
    // and the way it comes back is one "just while we migrate" component.
    expect(header).not.toMatch(/NavDesktop/)
    expect(header).not.toMatch(/NAV_GROUPS/)
  })

  test("the layout mounts the shell once, around everything below the header", () => {
    // The footer has to be inside the padded column or its first 256 px sit
    // under the rail; the header has to be outside it or the federal rule stops
    // reaching the left corner. Both are load-bearing and neither is visible
    // from a typecheck.
    expect(layout).toMatch(/<SidebarProvider defaultExpanded=\{expanded\}>/)
    const shellOpen = layout.indexOf("<AppShell>")
    const footer = layout.indexOf("<SiteFooter />")
    const siteHeader = layout.indexOf("<SiteHeader />")
    expect({
      footerInsideShell: shellOpen !== -1 && footer > shellOpen,
      headerOutsideShell: siteHeader !== -1 && siteHeader < shellOpen,
    }).toEqual({ footerInsideShell: true, headerOutsideShell: true })
  })

  test("the collapse state is read on the server", () => {
    // Reading it on the client instead renders the expanded shell, paints it,
    // and snaps to the rail on hydration — moving every page's content column
    // 200 px as it does. The cookie exists to be readable here.
    expect(layout).toMatch(/sidebarExpanded\(cookieStore\.get\(SIDEBAR_COOKIE\)\?\.value\)/)
  })
})

/**
 * The report row: an action in a list of links, in both surfaces.
 *
 * The failure this guards against is a row that renders for someone the server
 * will refuse — a control that appears, looks live, and throws "Not
 * authenticated" when pressed. It is invisible to a typecheck (the eligibility
 * check is a hook call, and removing it typechecks), and reproducing it needs a
 * signed-out browser against a configured deployment, which is the one
 * combination easiest to miss by hand.
 */
describe("the report row is gated and behaves as an action", () => {
  const drawer = strip(readFileSync(new URL("./nav-mobile.tsx", import.meta.url).pathname, "utf8"))

  test("both surfaces render it", () => {
    // Desktop and mobile, or the feature is discoverable on one device only.
    expect(sidebar).toContain("NAV_FEEDBACK")
    expect(drawer).toContain("NAV_FEEDBACK")
  })

  test("both gate it on the shared availability rule", () => {
    for (const source of [sidebar, drawer]) {
      expect(source).toContain("useFeedbackAvailable()")
      expect(source).toContain("if (!available) return null")
    }
  })

  /**
   * One function's body, bounded by the next `function` declaration.
   *
   * ⚠ Not a `[\s\S]*?` reach from the function's name, which is how the first
   * version of this was written and why it failed: the lazy match simply ran on
   * into `DrawerLink`, so "the action row has no `aria-current`" was really
   * asserting that *no function after it* did — and the link row correctly does.
   */
  const body = (source: string, name: string) => {
    const start = source.indexOf(`function ${name}(`)
    expect(start).toBeGreaterThan(-1)
    const next = source.indexOf("\nfunction ", start + 1)
    return source.slice(start, next === -1 ? source.length : next)
  }

  test("it is a button, not a link", () => {
    // ⚠ A `<Link>` here would need an `href`, and the only honest one would be
    // a route — which is the thing that loses the reporter's context. It also
    // announces as a link, promising navigation that never happens.
    for (const action of [body(sidebar, "SidebarAction"), body(drawer, "DrawerAction")]) {
      expect(action).toContain('type="button"')
      expect(action).toContain("<button")
      expect(action).not.toContain("<Link")
    }
  })

  test("it claims no active state", () => {
    // `aria-current` says "this is the current page". There is no page.
    for (const action of [body(sidebar, "SidebarAction"), body(drawer, "DrawerAction")]) {
      expect(action).not.toContain("aria-current")
      expect(action).not.toContain("isActivePath")
    }
  })

  test("the collapsed rail still names it", () => {
    // At 3.5 rem the label is not rendered, so without these the row announces
    // as an unnamed button and a sighted reader has only an unexplained glyph.
    const action = body(sidebar, "SidebarAction")
    expect(action).toContain("aria-label={expanded ? undefined : label}")
    expect(action).toContain("TooltipContent")
  })

  test("the drawer row closes the drawer as well as opening the sheet", () => {
    // ⚠ `useDismissOnNavigate` closes the drawer when the *route* changes, and
    // this row changes no route. Without an explicit close, the report sheet
    // opens behind the still-open drawer: two overlays, focus trapped in the
    // wrong one.
    expect(drawer).toMatch(/DrawerAction[\s\S]{0,120}onOpen=\{\(\) => setOpen\(false\)\}/)
    expect(drawer).toMatch(/function DrawerAction[\s\S]*?onOpen\(\)[\s\S]*?openFeedback\(\)/)
  })

  test("it sits in a labelled nav landmark, like the settings row beside it", () => {
    // A control outside every `<nav>` is in no navigation as far as assistive
    // technology is concerned — the correction `NAV_ACCOUNT` documents, which
    // applies to the row added above it.
    for (const source of [sidebar, drawer]) {
      const slot = source.slice(source.indexOf('aria-label={t("nav.accountArea")}'))
      expect(slot.indexOf("NAV_FEEDBACK")).toBeGreaterThan(-1)
      expect(slot.indexOf("NAV_FEEDBACK")).toBeLessThan(slot.indexOf("</nav>"))
    }
  })

  test("one sheet, opened by three controls", () => {
    // Mounting a second `<FeedbackWidget />` in the sidebar would give the page
    // two report forms, two screenshot captures on open, and two dwell clocks.
    // The provider is what keeps it one.
    expect(sidebar).not.toContain("<FeedbackWidget")
    expect(drawer).not.toContain("<FeedbackWidget")
    expect(layout).toContain("FeedbackProvider")
  })
})
