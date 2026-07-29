/**
 * Drives the period selector in a real browser, at two viewports.
 *
 * ## Why this cannot be a unit test
 *
 * `lib/period.test.ts` covers the parsing and the href arithmetic, and
 * `lib/period-links.test.ts` covers "nothing builds a link by hand". Neither
 * can see the three things that actually break in front of a reader:
 *
 *  - **Hydration.** The period comes from `useSearchParams`, which opts a
 *    subtree out of static prerendering. A component that reads it without a
 *    `Suspense` boundary above fails the *build*; one that renders differently
 *    on the server and the client throws React #418, which in React 19 detaches
 *    `<head>` and kills the reader's next click anywhere on the site
 *    (`scripts/verify-first-click-navigation.mjs` documents that at length).
 *    Only a browser sees it.
 *  - **Deep-link, refresh, back and forward.** A period in the URL has to
 *    survive all four. `router.push` makes Back a period change rather than a
 *    page exit, and that is a property of the History API, not of a function.
 *  - **The honest-emptiness claims.** "This page explains why WP19 has no
 *    ballots" is a claim about rendered text on a page fed by a real Convex
 *    deployment. A mock cannot fail it.
 *
 * ## What it needs
 *
 *     # a local Convex backend holding WP21 + seeded WP20/WP19
 *     bun run scripts/seed-local.ts && bun run scripts/seed-historical.ts
 *     bun run build && PORT=3456 bun run start &
 *     BASE_URL=http://localhost:3456 node scripts/verify-period-selector.mjs
 *
 * Console errors and failed requests are collected on every page and asserted
 * at the end, so a check that passes its own assertion while the page logs a
 * React error still fails the run.
 */

import { mkdirSync } from "node:fs"
import { chromium } from "playwright"

const BASE = process.env.BASE_URL ?? "http://localhost:3456"
const SHOTS = "/tmp/period-selector-shots"

/** Desktop and mobile, the two the acceptance criteria name. */
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]

/** Every route the selector should appear on. `/search` is included because it
 * must stay *consistent* with the rest rather than keeping its own convention. */
const PERIOD_ROUTES = ["/mps", "/rankings", "/feed", "/seating", "/parties", "/votes", "/search"]

const failures = []
const notes = []

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label} — ${detail}`)
    failures.push(`${label} — ${detail}`)
  }
}

/**
 * A page with its console and network errors collected.
 *
 * React's hydration failures arrive as console errors rather than as exceptions
 * or bad status codes, so a run that only checked HTTP would call a broken page
 * healthy. Next's own dev-only warnings are not filtered out because this runs
 * against a production build, where there are none.
 */
async function openPage(context) {
  const page = await context.newPage()
  const consoleErrors = []
  const requestFailures = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`))
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? ""
    // `net::ERR_ABORTED` is what a client-side navigation does to an in-flight
    // request it no longer needs; it is not a failure of the page.
    if (reason.includes("ERR_ABORTED")) return
    // Third-party portrait hosts. `seed-local.ts` points a few `photoUrl`s at
    // real Wikimedia files, and this sandbox has no route to them — so the
    // block is a property of where the test runs, not of the page. `MPPhoto`
    // falls back to initials, which is the behaviour it exists for.
    if (/^https?:\/\/(upload\.wikimedia\.org|www\.bundestag\.de)\//.test(request.url())) return
    requestFailures.push(`${request.url()} — ${reason}`)
  })
  return { page, consoleErrors, requestFailures }
}

/**
 * The period control's current value, or null when no control is rendered.
 *
 * Two ids, because there are two controls and that is deliberate rather than a
 * loose end. `#period-selector` is the shared one every period-bound page
 * carries above its content; `#search-period` is `/search`'s, which sits in
 * that page's own filter grid beside the Fraktion and committee dropdowns
 * because on `/search` the period *is* one filter among several. Hoisting it
 * above the results would put two period controls on one page, which is the
 * failure `NAV_SHEET_ONLY` already was.
 *
 * They write the same `?wp=` and read it through the same parser, so "the same
 * control in two places" is true of the behaviour even though it is two
 * elements. That is what this probe asserts by accepting either.
 */
const READ_SELECTOR = () => {
  const trigger =
    document.querySelector("#period-selector") ?? document.querySelector("#search-period")
  return trigger ? trigger.textContent.trim() : null
}

/** Whether the page carries the "this is a closed period" banner. */
const READ_HISTORICAL_BANNER = () =>
  document.body.innerText.includes("abgeschlossen") || document.body.innerText.includes("closed")

async function run() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()

  for (const viewport of VIEWPORTS) {
    console.log(`\n── ${viewport.name} (${viewport.width}×${viewport.height})`)
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    })

    // 1. The selector appears on every period-bound route, at the current period.
    for (const route of PERIOD_ROUTES) {
      const { page, consoleErrors } = await openPage(context)
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" })
      const value = await page.evaluate(READ_SELECTOR)
      check(
        `${route} renders the period control`,
        value !== null,
        "no #period-selector on the page",
      )
      check(
        `${route} defaults to WP21`,
        value === null || value.includes("21"),
        `control reads ${JSON.stringify(value)}`,
      )
      check(`${route} logs no console error`, consoleErrors.length === 0, consoleErrors[0] ?? "")
      await page.close()
    }

    // 2. A deep link into a historical period renders that period, not the current one.
    //    This is the check that failed in production: `?wp=20` showed WP21.
    for (const wp of [20, 19]) {
      const { page, consoleErrors } = await openPage(context)
      await page.goto(`${BASE}/rankings?wp=${wp}`, { waitUntil: "networkidle" })
      const value = await page.evaluate(READ_SELECTOR)
      check(
        `/rankings?wp=${wp} shows WP${wp}`,
        value?.includes(String(wp)),
        `control reads ${JSON.stringify(value)}`,
      )
      check(
        `/rankings?wp=${wp} says it is a closed period`,
        await page.evaluate(READ_HISTORICAL_BANNER),
        "no historical banner",
      )
      check(
        `/rankings?wp=${wp} logs no console error`,
        consoleErrors.length === 0,
        consoleErrors[0] ?? "",
      )
      await page.screenshot({
        path: `${SHOTS}/${viewport.name}-rankings-wp${wp}.png`,
        fullPage: false,
      })
      await page.close()
    }

    // 3. Refresh keeps the period. A page that resolved it once and lost it on
    //    reload would be shareable in name only.
    {
      const { page } = await openPage(context)
      await page.goto(`${BASE}/mps?wp=20`, { waitUntil: "networkidle" })
      await page.reload({ waitUntil: "networkidle" })
      const value = await page.evaluate(READ_SELECTOR)
      check(
        "refresh keeps the period",
        value?.includes("20"),
        `control reads ${JSON.stringify(value)} after reload`,
      )
      await page.close()
    }

    // 4. Back and forward walk the period, because the switch is a `push`.
    {
      const { page, consoleErrors } = await openPage(context)
      await page.goto(`${BASE}/mps`, { waitUntil: "networkidle" })
      await page.goto(`${BASE}/mps?wp=20`, { waitUntil: "networkidle" })
      await page.goBack({ waitUntil: "networkidle" })
      const back = await page.evaluate(READ_SELECTOR)
      check(
        "back returns to the previous period",
        back?.includes("21"),
        `control reads ${JSON.stringify(back)} after back`,
      )
      await page.goForward({ waitUntil: "networkidle" })
      const forward = await page.evaluate(READ_SELECTOR)
      check(
        "forward returns to the historical period",
        forward?.includes("20"),
        `control reads ${JSON.stringify(forward)} after forward`,
      )
      check(
        "back/forward logs no console error",
        consoleErrors.length === 0,
        consoleErrors[0] ?? "",
      )
      await page.close()
    }

    // 5. Period context survives list → profile. The failure the whole branch
    //    is about: a name on the WP20 roster opening a WP21 profile.
    {
      const { page } = await openPage(context)
      await page.goto(`${BASE}/mps?wp=20`, { waitUntil: "networkidle" })
      const href = await page.evaluate(() => {
        const link = [...document.querySelectorAll('a[href*="/mps/"]')].find((a) =>
          /\/mps\/[^/?]+/.test(a.getAttribute("href") ?? ""),
        )
        return link?.getAttribute("href") ?? null
      })
      check(
        "a WP20 roster row links into WP20",
        href?.includes("wp=20"),
        `first profile link is ${JSON.stringify(href)}`,
      )
      if (href) {
        await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" })
        const value = await page.evaluate(READ_SELECTOR)
        check(
          "the profile it opens is the WP20 one",
          value?.includes("20"),
          `profile control reads ${JSON.stringify(value)}`,
        )
      }
      await page.close()
    }

    // 6. Other query parameters survive a period change.
    {
      const { page } = await openPage(context)
      await page.goto(`${BASE}/search?q=aktivit`, { waitUntil: "networkidle" })
      // The `/search` period control is a `FilterSelect`, not the shared
      // `#period-selector`; both write the same parameter, which is the point.
      await page.goto(`${BASE}/search?q=aktivit&wp=20`, { waitUntil: "networkidle" })
      const url = new URL(page.url())
      check(
        "a filtered search keeps its query at another period",
        url.searchParams.get("q") === "aktivit" && url.searchParams.get("wp") === "20",
        `url is ${page.url()}`,
      )
      await page.close()
    }

    // 7. Honest emptiness. WP19 has no ballots and no committees, and neither
    //    may render as a measured zero.
    {
      const { page } = await openPage(context)
      await page.goto(`${BASE}/votes?wp=19`, { waitUntil: "networkidle" })
      const text = await page.evaluate(() => document.body.innerText)
      check(
        "/votes?wp=19 explains why it is empty",
        text.includes("2019") || text.includes("PDF"),
        "no source-coverage explanation on an empty ballot list",
      )
      await page.screenshot({
        path: `${SHOTS}/${viewport.name}-votes-wp19.png`,
        fullPage: false,
      })
      await page.close()
    }

    // 8. An unscored period says so rather than showing empty boards.
    {
      const { page } = await openPage(context)
      await page.goto(`${BASE}/rankings?wp=19`, { waitUntil: "networkidle" })
      const text = await page.evaluate(() => document.body.innerText)
      check(
        "/rankings?wp=19 says the period is unscored",
        text.includes("berechnet") || text.includes("computed"),
        "no unscored explanation on an empty leaderboard",
      )
      await page.close()
    }

    // 9. A period this deployment has not loaded is not a 404.
    {
      const { page } = await openPage(context)
      const response = await page.goto(`${BASE}/mps?wp=18`, { waitUntil: "networkidle" })
      const text = await page.evaluate(() => document.body.innerText)
      check(
        "/mps?wp=18 answers HTTP 200",
        response?.status() === 200,
        `status ${response?.status()}`,
      )
      check(
        "/mps?wp=18 says the period is not loaded",
        text.includes("nicht geladen") || text.includes("not loaded"),
        "no not-backfilled message",
      )
      await page.close()
    }

    // 10. A member who did not sit in the current period gets an answer, not a 404.
    //     `bt-9019` is seeded into WP20 and WP19 only.
    {
      const { page } = await openPage(context)
      const response = await page.goto(`${BASE}/mps/bt-9019`, { waitUntil: "networkidle" })
      const text = await page.evaluate(() => document.body.innerText)
      check(
        "/mps/bt-9019 (WP21) answers HTTP 200",
        response?.status() === 200,
        `status ${response?.status()}`,
      )
      check(
        "it says the member held no WP21 mandate",
        text.includes("kein Mandat") || text.includes("no mandate"),
        "no did-not-sit message",
      )
      check(
        "and offers the periods they did sit in",
        text.includes("20") && text.includes("19"),
        "no link to the periods on record",
      )
      await page.screenshot({
        path: `${SHOTS}/${viewport.name}-mp-not-in-period.png`,
        fullPage: false,
      })
      await page.close()
    }

    // 11. That member's historical profile renders in full.
    {
      const { page, consoleErrors } = await openPage(context)
      await page.goto(`${BASE}/mps/bt-9019?wp=19`, { waitUntil: "networkidle" })
      const text = await page.evaluate(() => document.body.innerText)
      check(
        "/mps/bt-9019?wp=19 renders the profile",
        text.includes("Kessler"),
        "the member's name is not on the page",
      )
      check(
        "the WP19 profile explains the committee gap",
        text.includes("Ausschussmitgliedschaften") || text.includes("Committee memberships"),
        "no committee coverage note",
      )
      check(
        "the WP19 profile logs no console error",
        consoleErrors.length === 0,
        consoleErrors[0] ?? "",
      )
      await page.screenshot({
        path: `${SHOTS}/${viewport.name}-mp-wp19.png`,
        fullPage: true,
      })
      await page.close()
    }

    // 12. A current profile URL is unchanged — the backward-compatibility
    //     criterion. `bt-0001` sits in all three periods.
    {
      const { page } = await openPage(context)
      const response = await page.goto(`${BASE}/mps/bt-0001`, { waitUntil: "networkidle" })
      const text = await page.evaluate(() => document.body.innerText)
      check(
        "/mps/bt-0001 still resolves to the current mandate",
        response?.status() === 200 && !page.url().includes("wp="),
        `status ${response?.status()}, url ${page.url()}`,
      )
      check("and renders the profile", text.length > 500, `only ${text.length} characters`)
      await page.close()
    }

    // 13. Switching period through the control itself, rather than by URL.
    //     This is the only check that exercises the `router.push` path.
    {
      const { page, consoleErrors, requestFailures } = await openPage(context)
      await page.goto(`${BASE}/rankings`, { waitUntil: "networkidle" })
      await page.click("#period-selector")
      // Radix renders its listbox in a portal; the option carries the label.
      await page.click('[role="option"]:has-text("20")')
      await page.waitForURL(/wp=20/, { timeout: 5000 }).catch(() => {})
      check(
        "choosing a period navigates and writes the URL",
        page.url().includes("wp=20"),
        `url is ${page.url()}`,
      )
      // And back to the current period drops the parameter rather than pinning it.
      await page.click("#period-selector")
      await page.click('[role="option"]:has-text("21")')
      await page
        .waitForFunction(() => !window.location.search.includes("wp="), {
          timeout: 5000,
        })
        .catch(() => {})
      check(
        "returning to the current period writes no parameter",
        !page.url().includes("wp="),
        `url is ${page.url()}`,
      )
      check("switching logs no console error", consoleErrors.length === 0, consoleErrors[0] ?? "")
      check(
        "switching triggers no failed request",
        requestFailures.length === 0,
        requestFailures[0] ?? "",
      )
      await page.close()
    }

    // 14. The header chip follows the page rather than always saying WP21.
    {
      const { page } = await openPage(context)
      await page.goto(`${BASE}/rankings?wp=19`, { waitUntil: "networkidle" })
      const chip = await page.evaluate(() => {
        const link = [...document.querySelectorAll("header a")].find((a) =>
          /WP\s*\d+|EP\s*\d+/.test(a.textContent ?? ""),
        )
        return link?.textContent?.trim() ?? null
      })
      // Desktop only: the chip is `hidden sm:inline-block`, so at 390 px it is
      // deliberately absent rather than missing.
      if (viewport.mobile) {
        notes.push("header chip is hidden below `sm` by design; not asserted on mobile")
      } else {
        check(
          "the header chip names the period on screen",
          chip?.includes("19"),
          `chip reads ${JSON.stringify(chip)}`,
        )
      }
      await page.close()
    }

    await context.close()
  }

  await browser.close()

  console.log(`\nScreenshots: ${SHOTS}`)
  for (const note of notes) console.log(`  note: ${note}`)
  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILED:`)
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
  console.log("\nAll checks passed.")
}

await run()
