import { describe, expect, test } from "bun:test"
import {
  SIDEBAR_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
  sidebarCookieAssignment,
  sidebarCookieValue,
  sidebarExpanded,
} from "./sidebar-state"

/**
 * Tests for the sidebar's persisted state.
 *
 * The bug class these exist for is a layout flash: the server renders the shell
 * at one width, the browser paints it, and the client corrects it a beat later
 * — moving every page's content column 200 px sideways on load. That is only
 * avoidable if the *server* can answer "expanded?" before writing HTML, which
 * is why this is a cookie rather than `localStorage` and why the parsing is a
 * pure function of a string: the server reads Next's cookie store and the
 * client reads `document.cookie`, and one rule has to answer for both.
 */

describe("sidebarExpanded", () => {
  test("a reader who has collapsed it stays collapsed", () => {
    expect(sidebarExpanded("collapsed")).toBe(false)
  })

  test("a reader who has expanded it stays expanded", () => {
    expect(sidebarExpanded("expanded")).toBe(true)
  })

  test("a first-time visitor gets the labels", () => {
    // The default, and the one that matters most. Bundestracker is a public
    // document — a reader arrives from a search engine, reads one page and
    // leaves — so the first visit must show the navigation with its words
    // rather than a column of nine glyphs to be decoded. Collapsing is opt-in.
    expect(sidebarExpanded(undefined)).toBe(true)
    expect(sidebarExpanded(null)).toBe(true)
  })

  test("a malformed value fails open rather than closed", () => {
    // Anything that is not exactly "collapsed" means expanded. Navigation is
    // the wrong thing to hide on a value nobody can account for — a stale
    // cookie from an older spelling, a proxy rewriting it, a reader editing it
    // by hand. The visible failure is recoverable in one click; the invisible
    // one is a site that looks like it has no navigation.
    expect(sidebarExpanded("")).toBe(true)
    expect(sidebarExpanded("false")).toBe(true)
    expect(sidebarExpanded("Collapsed")).toBe(true)
    expect(sidebarExpanded("0")).toBe(true)
  })
})

describe("sidebarCookieValue", () => {
  test("round-trips through sidebarExpanded", () => {
    // The two halves live beside each other so they cannot drift, and this is
    // what pins that: a rename of the stored token has to change both or fail
    // here rather than silently resetting every reader's preference on deploy.
    for (const expanded of [true, false]) {
      expect(sidebarExpanded(sidebarCookieValue(expanded))).toBe(expanded)
    }
  })
})

describe("sidebarCookieAssignment", () => {
  const assignment = sidebarCookieAssignment(false)

  test("writes the collapsed state under the expected name", () => {
    expect(assignment.startsWith(`${SIDEBAR_COOKIE}=collapsed`)).toBe(true)
  })

  test("is scoped to the whole site", () => {
    // A cookie scoped to the path it was toggled on would apply the preference
    // to one section and not the rest, which reads as the setting being
    // forgotten at random.
    expect(assignment).toContain("path=/")
  })

  test("outlives the session", () => {
    // A year. Re-collapsing every session would be the site forgetting
    // something it was told — session scope is right for the splash
    // (lib/splash-gate.ts) and wrong here, because that is an event and this is
    // a setting.
    expect(assignment).toContain(`max-age=${SIDEBAR_COOKIE_MAX_AGE}`)
    expect(SIDEBAR_COOKIE_MAX_AGE).toBeGreaterThan(60 * 60 * 24 * 30)
  })

  test("does not ride along on cross-site requests", () => {
    expect(assignment).toContain("SameSite=Lax")
  })

  test("the value the server parses is the value the client wrote", () => {
    // The round trip that actually matters, across the two worlds: take the
    // assignment string the browser is given, parse it the way a cookie jar
    // would, and feed the result to the server's reader. A mismatch here is the
    // flash this whole module exists to prevent.
    for (const expanded of [true, false]) {
      const written = sidebarCookieAssignment(expanded)
      const value = written.split(";")[0]?.split("=")[1]
      expect({ expanded, parsed: sidebarExpanded(value) }).toEqual({ expanded, parsed: expanded })
    }
  })
})
