import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * A source-shape guard on `/seating`'s hydration contract.
 *
 * ## The class of bug this catches
 *
 * `<Seating>` is a client component sitting under `<PeriodScope>` in
 * `app/seating/page.tsx`. Its first render draws a `<Skeleton>` behind
 * `if (seats === undefined)`; every subsequent render draws the arc. The
 * server's response contains the skeleton, so the moment anything above
 * that gate reads a non-deterministic value (`Date.now()`, `Math.random()`,
 * `.toLocaleString(locale)`, `authClient.useSession()`, `typeof window`)
 * the client's first render can produce a different element type at the
 * same DOM position. That is React hydration error #418 — the same class
 * of failure sidebar-account.test.ts pins for the header's account slot —
 * and its blast radius is not the component: React regenerates from the
 * root, detaches `<head>`, and the reader's first click is swallowed.
 *
 * `components/sidebar-account.test.ts` says the same thing at length; the
 * two files are the same guard applied to two different session-adjacent
 * subtrees. This one has never fired in production — the seating tree has
 * always been deterministic pre-skeleton — which is exactly when the
 * cheapest guard is the source-shape one, before a "tidy" edit adds the
 * first Date.now above the gate and puts the failure on the reader's phone.
 *
 * ## What this cannot see, and how the real check is done
 *
 * A real hydration commit is what throws #418, and `bun test` never runs
 * one — no jsdom, no @testing-library/react in the app's deps. So the
 * source-scan below cannot prove hydration is safe; it can only refuse
 * the shapes that *make* it unsafe. The end-to-end check for #418 is
 * `webapp/scripts/verify-first-click-navigation.mjs` under CPU throttling,
 * which is what proved the sidebar-account fix and is what would prove a
 * new one here. Header comment in `components/providers/theme-color.test.ts`
 * documents the same trade for the same reason.
 */

const SEATING_TSX = readFileSync(new URL("./seating.tsx", import.meta.url).pathname, "utf8")

/** Strip block and line comments so a comment naming `Date.now` or
 * `authClient.useSession()` in prose does not fail the guard. Mirrors the
 * `withoutComments` helper in components/sidebar-account.test.ts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

/** The lines from `export function Seating(` down to the first
 * `if (seats === undefined)` return — everything that runs on both server
 * and client for a first paint, and everything that must therefore
 * produce the same result on both. */
function preSkeletonRegion(source: string): string {
  const stripped = stripComments(source)
  const start = stripped.search(/export function Seating\b/)
  const gate = stripped.search(/if\s*\(\s*seats\s*===\s*undefined\s*\)/)
  if (start < 0 || gate < 0) {
    throw new Error(
      "seating.tsx no longer opens with `function Seating` above the `seats === undefined` gate",
    )
  }
  return stripped.slice(start, gate)
}

describe("Seating cannot desync SSR from hydration above its skeleton gate", () => {
  const region = preSkeletonRegion(SEATING_TSX)

  test("the skeleton gate exists and is the first return", () => {
    // The gate itself is what pins hydration to the SSR output — the server
    // sees no Convex data, so `useQuery` returns undefined on both sides and
    // the skeleton renders in both. If the gate is removed or moved below
    // another return that renders a non-skeleton element, the hydration
    // guarantee collapses.
    expect(SEATING_TSX).toMatch(/if\s*\(\s*seats\s*===\s*undefined\s*\)\s*\{/)
    const stripped = stripComments(SEATING_TSX)
    const emptyState = stripped.indexOf("seats.length === 0")
    const gate = stripped.search(/if\s*\(\s*seats\s*===\s*undefined\s*\)/)
    const map = stripped.indexOf("<SeatingMap")
    expect(emptyState).toBeGreaterThan(gate)
    expect(map).toBeGreaterThan(gate)
  })

  test("no session branch above the gate", () => {
    // A session-dependent branch above the skeleton is the sidebar-account
    // shape — element type changes when the session resolves faster than
    // hydration, and hydration errors #418 fires. If `<Seating>` ever needs
    // a session branch, wrap it in the mount-flag guard sidebar-account.tsx
    // documents.
    expect(region).not.toMatch(/authClient\.useSession\(/)
    expect(region).not.toMatch(/\buseSession\(/)
  })

  test("no wall-clock read above the gate", () => {
    // `Date.now()` and `new Date()` (both zero-arg and any-arg — parsing a
    // stored string is fine, but a bare `new Date()` picks up the wall clock)
    // desync the first client render from the server one by whatever
    // milliseconds elapsed between the two — enough for a `.toLocaleString`
    // downstream to produce a different string.
    expect(region).not.toMatch(/\bDate\.now\s*\(/)
    // `new Date(` is OK if followed by an argument (parsing a stored value);
    // `new Date()` with no argument is the wall-clock reader.
    expect(region).not.toMatch(/\bnew Date\s*\(\s*\)/)
  })

  test("no non-determinism above the gate", () => {
    // `Math.random()` in a first render is a `#418` trigger the moment the
    // random seed differs across the SSR/client boundary — which it will,
    // because the two are two runtimes.
    expect(region).not.toMatch(/\bMath\.random\s*\(/)
  })

  test("no locale-dependent formatting above the gate", () => {
    // `.toLocaleString()`, `.toLocaleDateString()`, `.toLocaleTimeString()`
    // read the platform's ICU tables, which may differ between the SSR
    // runtime (Node) and the browser. Also `.toLocaleLowerCase()` /
    // `.toLocaleUpperCase()` — the Turkish-dotless-i class of desync. All
    // legitimate uses of these belong *below* the gate, after the arc has
    // arrived.
    expect(region).not.toMatch(
      /\.toLocale(?:String|DateString|TimeString|LowerCase|UpperCase)\s*\(/,
    )
  })

  test("no `typeof window` branching above the gate", () => {
    // `typeof window === "undefined"` is the classic client-only escape
    // hatch, but a component that branches on it above hydration renders
    // one tree on the server (`undefined`) and another on the client
    // (`object`) — which is what the gate is supposed to prevent.
    expect(region).not.toMatch(/typeof\s+window\s*[!=]==/)
  })

  test("the skeleton branch renders the aria-live output the tree ships today", () => {
    // A cosmetic edit removing the `aria-live` or the `sr-only` loading
    // string would not itself break hydration, but the skeleton *shape* is
    // what SSR emits — so if a "quick fix" moved this to a `<div>` without
    // the announcement, screen readers would silently lose the loading cue.
    // Pinning the shape keeps the guard honest to the file that ships.
    expect(SEATING_TSX).toMatch(/<output\s+className="[^"]*"\s+aria-live="polite">/)
    expect(SEATING_TSX).toMatch(/sr-only/)
  })
})

/**
 * The pre-skeleton scan above catches `Seating` itself. The client subtree it
 * hands to is `PeriodScope` (above `Seating`) and the children `Seating` calls
 * (`SeatingMap`, `SeatingLegend`, `SeatingNotice`, `ColorModeToggle`); every
 * one of them shares the hydration contract, because a mismatch anywhere
 * inside the same React root has the same #418 blast radius.
 *
 * Rather than encode a list here, the check reads every `.tsx` file in
 * `components/` whose name references the seating subtree and asserts the
 * same absences against everything before its first Convex-dependent gate.
 * The list is deliberately hand-picked (`seating`, `seat-`) so a new
 * `shadcn` primitive does not become an implicit member — same shape as the
 * hand-picked list in sidebar-account.test.ts.
 */
describe("every /seating subtree component is deterministic before its data gate", () => {
  const dir = new URL(".", import.meta.url).pathname
  const files = readdirSync(dir).filter(
    (name) => /^(?:seating|seat-)/.test(name) && name.endsWith(".tsx"),
  )

  test("test-of-the-test: at least the two seating client roots are found", () => {
    // A silent regression would be the filter returning an empty list, which
    // would make every following assertion vacuous.
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files).toContain("seating.tsx")
  })

  test.each(files)("%s is deterministic above its first Convex return", (name) => {
    const source = readFileSync(join(dir, name), "utf8")
    const stripped = stripComments(source)
    // Not every file uses `useQuery` — the notice for instance is pure prose.
    // For files that do, the "pre-gate" region is everything before the first
    // Convex-dependent branch; for the rest, the whole file is the region.
    const hasQuery = /useQuery\s*\(/.test(stripped)
    const region = hasQuery
      ? stripped.slice(0, stripped.search(/if\s*\(\s*\w+\s*===\s*undefined\s*\)/))
      : stripped
    // Same set of triggers as the primary suite above — the whole tree
    // sharing one gate is what keeps hydration coherent.
    expect({ file: name, offenders: forbidden(region) }).toEqual({ file: name, offenders: [] })
  })

  function forbidden(region: string): string[] {
    const found: string[] = []
    if (/authClient\.useSession\s*\(/.test(region)) found.push("authClient.useSession")
    if (/\buseSession\s*\(/.test(region)) found.push("useSession")
    if (/\bDate\.now\s*\(/.test(region)) found.push("Date.now()")
    if (/\bnew Date\s*\(\s*\)/.test(region)) found.push("new Date()")
    if (/\bMath\.random\s*\(/.test(region)) found.push("Math.random()")
    if (/\.toLocale(?:String|DateString|TimeString|LowerCase|UpperCase)\s*\(/.test(region)) {
      found.push("toLocale*()")
    }
    if (/typeof\s+window\s*[!=]==/.test(region)) found.push("typeof window")
    return found
  }
})
