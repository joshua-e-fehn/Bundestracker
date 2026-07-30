import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Every page's `<title>` reads the reader's language, not the site's default.
 *
 * ## The regression this catches
 *
 * `generateMetadata` runs on the server and can read `cookies()` and
 * `headers()` — the language toggle writes a `LOCALE_COOKIE` on press, and
 * `Accept-Language` is the fallback before any toggle has been pressed (see
 * lib/i18n-server.ts). Nothing forces a new page to use those, though: the
 * shortcut `export const metadata: Metadata = { title: t("x", DEFAULT_LOCALE) }`
 * compiles, ships, and works — except a reader in English gets a German
 * `<title>` above the English body, and every social-share preview carries
 * the wrong language. Ten pages did this until the fix; the file scan below
 * makes sure the eleventh one cannot.
 *
 * ## What it asserts, and what it does not
 *
 * Two claims per page, plus one negative:
 *
 *  - Every `webapp/app/**\/page.tsx` under this scan exports metadata via
 *    `generateMetadata`, an async function that can await `resolveServerLocale`
 *    — never a static `export const metadata`, which is evaluated once at
 *    module load with no request in view.
 *  - Every page whose metadata calls `t(...)` also calls `resolveServerLocale`.
 *    A page that names no translated string does not need the locale (a
 *    metadata block that only sets `robots` would pass this without either).
 *  - No page calls `t(key, DEFAULT_LOCALE)` inside metadata. The fallback is
 *    the point `resolveServerLocale` covers.
 *
 * A source scan rather than a live render because `generateMetadata` sits
 * behind `next/headers`, and spinning up Next inside `bun test` would trade
 * pinning the shape for a fixture that only checks one path. The failing
 * fixture is exactly the shape the old code had; the fixture that would let a
 * regression through is the same one the failed assertions look for. See
 * webapp/app/page.test.ts and webapp/components/providers/theme-color.test.ts
 * for the codebase's existing precedent of asserting on the source string
 * where DOM/render tools would drag in machinery the sandbox cannot run.
 */

const APP_DIR = join(import.meta.dir)

/** Recursive `page.tsx` walk. Skips node_modules and .next just in case a
 * checkout has stray build output; every real page lives directly under
 * `app/`, so a `next/font` fixture cannot slip past. */
function pageFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...pageFiles(full))
    } else if (entry.name === "page.tsx") {
      out.push(full)
    }
  }
  return out
}

/** Strip block and line comments so a `/* DEFAULT_LOCALE *\/` in prose does
 * not fail the "no DEFAULT_LOCALE in metadata" check. Same trick the sibling
 * source-scan tests use. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

/** Where the metadata declaration ends, so subsequent handler code that
 * legitimately reads DEFAULT_LOCALE (there is none today, but there could be)
 * would not fail the scan. Metadata is either the static `export const
 * metadata: Metadata = { ... }` block or the `export async function
 * generateMetadata(...) { ... }` body, both ending at the first top-level
 * `}` after the opening `{`.
 *
 * ⚠ The dynamic-form pattern deliberately matches the whole signature
 * (including the parameter list and return type) and the brace walker
 * anchors on the LAST character of the match — the body's opening brace —
 * not on the next `{` after the export keyword. A signature like
 * `generateMetadata({ params }: Params): Promise<Metadata> {` contains the
 * destructure's `{` before the body's `{`, so a naïve
 * `indexOf("{", start)` opens the walker on the destructure, closes on
 * its matching `}`, and returns the parameter clause instead of the body.
 * The three dynamic pages on the site (`/mps/[id]`, `/parties/[party]`,
 * `/votes/[id]`) all use destructured params, so that regression left the
 * two body-content assertions vacuous for exactly the highest-traffic
 * pages the file exists to guard. Two guards below fail loudly if either
 * half regresses: the per-dynamic-page region-length assertion, and the
 * synthesised old-shape regression sample.
 */
function metadataRegion(source: string): string {
  const stripped = stripComments(source)
  const staticMatch = stripped.match(/export const metadata[^=]*=\s*\{/)
  const dynamicMatch = stripped.match(
    /export async function generateMetadata\s*\([^)]*\)[^{]*\{/,
  )
  const match = staticMatch ?? dynamicMatch
  if (!match || match.index === undefined) return ""
  const start = match.index
  // Anchor the brace walker at the LAST character of the signature match —
  // the opening brace the regex found. `indexOf("{", start)` would land on
  // the destructure's `{` in `generateMetadata({ params }: Params) {` and
  // return the parameter clause instead of the body. Using
  // `match.index + match[0].length - 1` skips the whole signature and
  // opens the walker on the true body brace.
  const opening = start + match[0].length - 1
  let depth = 0
  for (let i = opening; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++
    else if (stripped[i] === "}") {
      depth--
      if (depth === 0) return stripped.slice(start, i + 1)
    }
  }
  return stripped.slice(start)
}

const pages = pageFiles(APP_DIR)

describe("every page negotiates its <title> per request", () => {
  test("at least one page.tsx is scanned (test-of-the-test)", () => {
    // A silent regression here would be the walker returning zero paths and
    // every subsequent assertion passing vacuously. This is the check that
    // the file discovery works at all — the number matters less than that it
    // is non-zero, so no periodic update is needed as new pages ship.
    expect(pages.length).toBeGreaterThan(5)
  })

  test("test-of-the-test: every dynamic page's region contains its function body", () => {
    // Directly guards the H1 defect the independent review caught: an
    // earlier `[^{]*\{` in `metadataRegion` stopped at the destructure's
    // opening brace in signatures like
    // `generateMetadata({ params }: Params): Promise<Metadata> {`, so the
    // brace walker closed on the destructure and returned the parameter
    // clause instead of the body — the two "no DEFAULT_LOCALE inside
    // metadata" and "t() implies resolveServerLocale" assertions below
    // then early-returned because they saw no `t(` in a 49–63-character
    // region, and every dynamic page passed vacuously.
    //
    // A parameter clause is a few dozen characters; a real function body
    // is hundreds. Asserting the region on each dynamic page is at least
    // 200 characters (against actual bodies of ~500-1000) means the
    // extractor got past the destructure. If the extractor ever regresses
    // to skipping the body again, this test fires long before the two
    // vacuous assertions do.
    const dynamicPages = pages.filter((path) => /\/\[[^\]]+\]\/page\.tsx$/.test(path))
    expect(dynamicPages.length).toBeGreaterThanOrEqual(3)
    for (const path of dynamicPages) {
      const region = metadataRegion(readFileSync(path, "utf8"))
      const relPath = relative(APP_DIR, path)
      // The region must contain the whole body, so the two downstream
      // scans see the `t(...)` / `DEFAULT_LOCALE` calls they exist to
      // refuse. The 200-character floor is comfortably above any
      // parameter clause (the widest destructure in the tree is 63
      // characters) and comfortably below the shortest real body.
      expect({
        path: relPath,
        regionLength: region.length,
        containsBodyMarker: region.includes("resolveServerLocale") || region.includes("return"),
      }).toEqual({
        path: relPath,
        regionLength: expect.any(Number),
        containsBodyMarker: true,
      })
      expect(region.length).toBeGreaterThan(200)
    }
  })

  test("test-of-the-test: the old-shape regression is caught by the extractor", () => {
    // A synthesised source shaped like the pre-NEW-01 regression the file
    // exists to prevent: a dynamic `generateMetadata` whose body reaches
    // for `DEFAULT_LOCALE` directly instead of threading
    // `resolveServerLocale` through the params `Promise.all`. Under the
    // old `[^{]*\{` regex this returned the destructure clause only
    // (`DEFAULT_LOCALE` absent from the 49-char region → false negative);
    // under the fix the region contains the body and the check trips.
    //
    // Kept as a synthesised source rather than a live-file check so the
    // test's demonstration of the fix is deterministic — a future edit
    // that flipped a real dynamic page back to `DEFAULT_LOCALE` would
    // fail the per-page assertion below, but this one always sees the
    // shape whether the tree currently ships it or not.
    const regressionSample = `
import type { Metadata } from "next"
type Params = { params: Promise<{ id: string }> }
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  // The pre-NEW-01 shape — the exact call the fix removed everywhere.
  return { title: t("common.notFound", DEFAULT_LOCALE, { id }) }
}
`
    const region = metadataRegion(regressionSample)
    // The whole body reaches the region, so both downstream scans fire.
    expect(region.length).toBeGreaterThan(150)
    expect(region).toContain("DEFAULT_LOCALE")
    expect(region).toContain("t(")
    // …which is precisely what the "no DEFAULT_LOCALE inside metadata"
    // assertion below matches on. Under the old extractor this would have
    // been empty of both markers, and the sample would have passed the
    // per-page loop untouched.
    expect(region.match(/DEFAULT_LOCALE/g) ?? []).not.toEqual([])
  })

  test.each(pages.map((path) => [relative(APP_DIR, path), path]))(
    "%s uses generateMetadata, not a static metadata constant",
    (_relative, path) => {
      const source = stripComments(readFileSync(path, "utf8"))
      // `export const metadata` is evaluated once, at module load, with no
      // request in view — so it cannot see cookies or headers. Pages that
      // literally have no metadata (a nested `[id]/error.tsx` for instance)
      // are fine; the scan is only for `page.tsx` files.
      const hasStatic = /^\s*export\s+const\s+metadata\b/m.test(source)
      const hasDynamic = /^\s*export\s+async\s+function\s+generateMetadata\b/m.test(source)
      const hasAnyMetadata =
        /(?:^|\n)\s*export\s+(?:const\s+metadata|async\s+function\s+generateMetadata)\b/.test(
          source,
        )
      if (!hasAnyMetadata) return // a `page.tsx` that inherits everything from the layout
      expect({ path: _relative, hasStatic, hasDynamic }).toEqual({
        path: _relative,
        hasStatic: false,
        hasDynamic: true,
      })
    },
  )

  test.each(pages.map((path) => [relative(APP_DIR, path), path]))(
    "%s does not call t(..., DEFAULT_LOCALE) inside its metadata",
    (_relative, path) => {
      const region = metadataRegion(readFileSync(path, "utf8"))
      if (region === "") return
      // The old shape was `t("x.title", DEFAULT_LOCALE)`. `resolveServerLocale`
      // is what replaced it — the fallback is applied inside that helper, not
      // at the metadata call site.
      expect({ path: _relative, matches: region.match(/DEFAULT_LOCALE/g) ?? [] }).toEqual({
        path: _relative,
        matches: [],
      })
    },
  )

  test.each(pages.map((path) => [relative(APP_DIR, path), path]))(
    "%s calls resolveServerLocale whenever its metadata calls t()",
    (_relative, path) => {
      const source = stripComments(readFileSync(path, "utf8"))
      const region = metadataRegion(source)
      if (region === "") return
      const readsT = /\bt\s*\(/.test(region)
      if (!readsT) return // a metadata block that only sets `robots` needs no locale
      // The helper must be imported (top-level `import { resolveServerLocale }
      // from "@/lib/i18n-server"`) and called (inside generateMetadata,
      // typically threaded through `Promise.all` alongside the route params).
      const imports = /from\s+["']@\/lib\/i18n-server["']/.test(source)
      const calls = /\bresolveServerLocale\s*\(/.test(source)
      expect({ path: _relative, imports, calls }).toEqual({
        path: _relative,
        imports: true,
        calls: true,
      })
    },
  )
})
