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
