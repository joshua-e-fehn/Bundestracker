/**
 * The first click on a cold load must navigate.
 *
 * ## The bug this reproduces
 *
 * `UserMenu` rendered `<Skeleton>` — a `<div>` — while `authClient.useSession()`
 * reported `isPending`, and the signed-out `<Button asChild><Link>` — an `<a>` —
 * once it did not. The server has no session, so the server HTML *always* held
 * the `<div>`. On the client the session can resolve from Better Auth's store
 * before React hydrates, and then React's first client render put an `<a>` where
 * the server had put a `<div>`.
 *
 * A differing element *type* at the same position is not a recoverable
 * difference. React throws
 *
 *   Hydration failed because the server rendered HTML didn't match the client
 *   (minified: #418, args[]=HTML)
 *
 * and regenerates the tree. In React 19 that detaches the whole of `<head>`,
 * including every `<meta>`/`<link>` it hoisted there. Each is then a node whose
 * `parentNode` is null, so the *next* commit — the reader's first client-side
 * navigation — dies in the tag-26 (HostHoistable) unmount path:
 *
 *   Uncaught TypeError: Cannot read properties of null (reading 'removeChild')
 *       at i7 … at i9 … at ur … at ua
 *
 * The click is swallowed and the page does not move. That is the whole of the
 * production report: "on a fresh load the first click on an MP link does
 * nothing".
 *
 * ## Why it needs CPU throttling
 *
 * It is a race between hydration and the session resolving, so it does not
 * appear on a fast machine — which is why it shipped. Measured against
 * production: the throw fires at 6× and 10× CPU throttling on every route, and
 * never at 1× or 4×. The throttling is not a trick to force a failure, it is
 * what a mid-range phone *is*; `THROTTLE` below is the whole of the difference
 * between reproducing this and never seeing it.
 *
 * Verified to fail on the unfixed code and pass on the fixed code — reverting
 * the `mounted` guard in components/user-menu.tsx brings the failure back.
 *
 * Run against a **production** build (`bun run build && bun run start`), since
 * dev-mode React recovers differently:
 *
 *   BASE_URL=http://localhost:3000 node scripts/verify-first-click-navigation.mjs
 */

import { chromium } from "playwright"

const BASE = process.env.BASE_URL ?? "http://localhost:3000"
/** Slow enough to lose the race. See the header — 6 reproduces, 4 does not. */
const THROTTLE = Number(process.env.THROTTLE ?? 6)
const RUNS = Number(process.env.RUNS ?? 3)

const failures = []
const skipped = []
const check = (label, condition, detail) => {
  if (condition) console.log(`  ✓ ${label}`)
  else {
    console.log(`  ✗ ${label} — ${detail}`)
    failures.push(label)
  }
}

/**
 * One cold load, one click.
 *
 * A fresh context every time is what makes it cold: no HTTP cache, no
 * localStorage, no session — the state a first-time reader arrives in, and the
 * only state in which the race is lost.
 */
async function coldLoadAndClick(browser, { width, height, label, selector }) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "de-DE",
  })
  const page = await context.newPage()

  const hydrationErrors = []
  const removeChildErrors = []
  page.on("pageerror", (error) => {
    const text = String(error?.message ?? error)
    // #418 is the minified hydration mismatch; the unminified text is what dev
    // builds print. #423/#425 are the same family (recoverable hydration
    // errors) and are worth failing on for the same reason.
    if (/#418|#423|#425|Hydration failed/.test(text)) hydrationErrors.push(text)
    if (/removeChild/.test(text)) removeChildErrors.push(text)
  })

  const session = await context.newCDPSession(page)
  await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE })

  // `commit`, not `networkidle`: waiting for the network to go quiet waits out
  // the very race under test.
  //
  // Retried because a refused connection is a statement about the server being
  // up, not about the page — and reporting "the first click did not navigate"
  // for a server that was not listening would be a false failure in the
  // direction that matters most, since this test exists to be believed when it
  // goes red.
  let lastNavigationError = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(BASE, { waitUntil: "commit" })
      lastNavigationError = null
      break
    } catch (error) {
      lastNavigationError = error
      await page.waitForTimeout(2000)
    }
  }
  if (lastNavigationError) {
    await context.close()
    return { label, unreachable: String(lastNavigationError).split("\n")[0] }
  }

  // Long enough that hydration has certainly been attempted at this throttle,
  // short enough to still be inside the window a real reader clicks in.
  await page.waitForTimeout(3500)

  const before = page.url()
  const link = page.locator(selector).first()
  let clicked = null
  let clickError = null

  try {
    clicked = await link.getAttribute("href")
    await link.scrollIntoViewIfNeeded({ timeout: 5000 })
    await link.click({ timeout: 5000 })
  } catch (error) {
    clickError = String(error?.message ?? error).split("\n")[0]
  }

  await page.waitForTimeout(2500)
  const after = page.url()

  await context.close()
  return {
    label,
    clicked,
    before,
    after,
    navigated: before !== after,
    clickError,
    hydrationErrors,
    removeChildErrors,
  }
}

const browser = await chromium.launch()

// Desktop and mobile, and both an MP link and a chrome link: the report named
// MP links, but the cause is in the shared chrome, so every link on every route
// is affected and the test should say so.
// The chrome link is the "Dashboard" entry rather than the wordmark: the
// wordmark points at `/`, which is the page under test, so a working click
// would leave the URL unchanged and be indistinguishable from a swallowed one.
//
// It is matched in the *sidebar* rather than in the header. This check was
// written when the header carried the destinations; they now live in the rail
// (components/nav-sidebar.tsx), so `header a[href="/dashboard"]` matches
// nothing — Playwright would time out on a build that is working and report
// "the first click did not navigate", which is a false red in the one direction
// this test cannot afford, since it exists to be believed when it goes red.
//
// `nav[aria-label]` rather than the label's text: the rail's name is
// translated ("Hauptnavigation" / "Main navigation"), and matching the string
// would make the check pass in one locale and time out in the other. The rail
// is the first labelled `<nav>` in the document and the only one carrying this
// href — the footer's copy sits in an unlabelled `<nav>`, and picking that one
// would test the footer twice and the primary navigation never.
//
// The rail is in the server HTML in both states, so this does not depend on the
// `bt_sidebar` cookie: collapsed it is a 3.5rem icon row whose anchor is still
// present, visible and clickable, only without its label.
const scenarios = [
  { label: "desktop 1440 — MP link", width: 1440, height: 900, selector: 'a[href^="/mps/"]' },
  {
    label: "desktop 1440 — sidebar link",
    width: 1440,
    height: 900,
    selector: 'nav[aria-label] a[href="/dashboard"]',
  },
  { label: "mobile 390 — MP link", width: 390, height: 844, selector: 'a[href^="/mps/"]' },
  { label: "mobile 390 — footer link", width: 390, height: 844, selector: 'footer a[href^="/"]' },
]

console.log(
  `first-click navigation @ ${BASE} (CPU throttle ${THROTTLE}×, ${RUNS} cold loads each)\n`,
)

for (const scenario of scenarios) {
  for (let run = 1; run <= RUNS; run++) {
    const result = await coldLoadAndClick(browser, scenario)
    const name = `${scenario.label} · run ${run}`

    // Reported rather than counted: an unreachable server is a fact about the
    // harness, and silently skipping it would let a run of zero real checks
    // print "all checks passed".
    if (result.unreachable) {
      console.log(`  – ${name}: SKIPPED, server unreachable — ${result.unreachable}`)
      skipped.push(name)
      continue
    }

    check(
      `${name}: no hydration mismatch`,
      result.hydrationErrors.length === 0,
      result.hydrationErrors[0] ?? "",
    )
    check(
      `${name}: no removeChild TypeError`,
      result.removeChildErrors.length === 0,
      result.removeChildErrors[0] ?? "",
    )
    check(
      `${name}: the first click navigated`,
      result.navigated,
      `still at ${result.after} after clicking ${result.clicked ?? "nothing"}` +
        (result.clickError ? ` (${result.clickError})` : ""),
    )
  }
}

await browser.close()

console.log()
if (skipped.length) console.log(`– ${skipped.length} scenario(s) skipped (server unreachable)`)
if (failures.length) {
  console.log(`✗ ${failures.length} check(s) failed`)
  process.exit(1)
}
// A run that checked nothing is not a pass. Guards the case where every
// scenario was skipped, which would otherwise print the same line as a clean
// sweep.
if (!skipped.length) console.log("✓ all checks passed")
else if (skipped.length === scenarios.length * RUNS) {
  console.log("✗ nothing was verified — every scenario was skipped")
  process.exit(1)
} else console.log("✓ all executed checks passed")
