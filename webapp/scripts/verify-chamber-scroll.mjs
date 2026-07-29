/**
 * Scroll-choreography check for `/`'s Chapter 1 hemicycle.
 *
 * Not a unit test and deliberately not in `bun test`: what it measures is a
 * *rendered* relationship between three things a jsdom-less unit test cannot
 * see — how many seat circles exist in the SVG, where the chapter's copy is on
 * screen, and how much scroll separates the finished chamber from the end of
 * the pin. lib/protokoll.test.ts covers the pure curve; this covers the page.
 *
 * Run against a production server:
 *
 *     bun run build && bun run start &
 *     node scripts/verify-chamber-scroll.mjs
 *
 * It prints a table of seat counts at each scroll position, asserts the four
 * properties the fix is *for*, and writes screenshots to /tmp/chamber-shots.
 */

import { mkdirSync } from "node:fs"
import { chromium } from "playwright"

const BASE = process.env.BASE_URL ?? "http://localhost:3000"
const SHOTS = "/tmp/chamber-shots"

/** The viewports the report came from, plus a mobile one. Safari's desktop
 * default and a large desktop are the two the screenshot showed. */
const VIEWPORTS = [
  { name: "desktop-1680x1050", width: 1680, height: 1050, mobile: false },
  { name: "desktop-1440x900", width: 1440, height: 900, mobile: false },
  { name: "mobile-390x844", width: 390, height: 844, mobile: true },
]

/** Reads the live state of the chapter: seats drawn, and where the copy and
 * the arc sit relative to the viewport. */
const PROBE = () => {
  const svg = document.querySelector('#kapitel-1 svg')
  const heading = document.querySelector('#kapitel-1-heading')
  const track = document.querySelector('#kapitel-1 .chamber-pin')
  const count = document.querySelector('#kapitel-1 p.tabular-nums')
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
  }
  return {
    seats: svg ? svg.querySelectorAll('circle').length : -1,
    // Circles the browser is actually painting — an opacity-0 circle is in the
    // DOM but is not on screen, and "blank hemicycle" is a claim about paint.
    painted: svg
      ? [...svg.querySelectorAll('circle')].filter(
          (c) => parseFloat(getComputedStyle(c).opacity) > 0.05,
        ).length
      : -1,
    svgRect: rect(svg),
    headingRect: rect(heading),
    trackRect: rect(track),
    countText: count ? count.textContent.trim() : null,
    scrollY: Math.round(window.scrollY),
    docHeight: document.documentElement.scrollHeight,
  }
}

const failures = []
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`    ✓ ${label}`)
  } else {
    console.log(`    ✗ ${label} — ${detail}`)
    failures.push(`${label}: ${detail}`)
  }
}

mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  console.log(`\n=== ${vp.name} ===`)
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: "networkidle" })

  // The splash overlays the page for ~1 s and swallows the first frame; every
  // gesture dismisses it, so press a key and wait for it to leave.
  await page.keyboard.press("Escape")
  await page.waitForTimeout(600)
  // The arc needs `getFractionSizes`; wait for real seats rather than a skeleton.
  await page.waitForFunction("document.querySelectorAll('#kapitel-1 svg circle').length > 0", {
    timeout: 20000,
  })

  const chapterTop = await page.evaluate(
    () => document.querySelector("#kapitel-1").getBoundingClientRect().top + window.scrollY,
  )

  // The roster's size, from the count's *second* figure ("271 von 635 Sitzen").
  // Deliberately not `svg circle`.length at rest: the arc now opens partly drawn
  // by design, so counting the DOM before scrolling measures the floor and calls
  // it the total — which silently turns every ratio below into a tautology.
  const total = await page.evaluate(() => {
    const text = document.querySelector("#kapitel-1 p.tabular-nums")?.textContent ?? ""
    const figures = text.match(/\d[\d.,  ]*/g) ?? []
    return figures.length < 2
      ? -1
      : Number.parseInt(figures[figures.length - 1].replace(/[^\d]/g, ""), 10)
  })
  if (total < 2) throw new Error(`could not read the seat total (got ${total})`)

  // --- the moment the chapter first becomes visible --------------------------
  // Scroll so the chapter's top edge sits at the bottom of the viewport: the
  // first instant any of it is on screen. This is the frame the bug report was
  // about — the arc must already be a chamber here.
  await page.evaluate(`window.scrollTo(0, ${chapterTop} - ${vp.height} + 40)`)
  await page.waitForTimeout(450)
  const onEntry = await page.evaluate(PROBE)

  // --- walking the whole chapter --------------------------------------------
  const trackHeight = onEntry.trackRect?.height ?? 0
  const samples = []
  for (let step = 0; step <= 10; step++) {
    const y = chapterTop - vp.height + 40 + (step / 10) * (trackHeight + vp.height - 40)
    await page.evaluate(`window.scrollTo(0, ${Math.round(y)})`)
    await page.waitForTimeout(320)
    const probe = await page.evaluate(PROBE)
    samples.push({ step, ...probe })
    if (step % 2 === 0) {
      await page.screenshot({ path: `${SHOTS}/${vp.name}-step${step}.png` })
    }
  }

  console.log(
    `  total seats: ${total}   track: ${trackHeight}px   viewport: ${vp.width}x${vp.height}`,
  )
  console.log("  step | scrollY | painted | heading top | svg top | count")
  for (const s of samples) {
    console.log(
      `  ${String(s.step).padStart(4)} | ${String(s.scrollY).padStart(7)} | ${String(
        s.painted,
      ).padStart(7)} | ${String(s.headingRect?.top ?? "-").padStart(11)} | ${String(
        s.svgRect?.top ?? "-",
      ).padStart(7)} | ${s.countText ?? "-"}`,
    )
  }

  // --- the four properties the fix exists to establish -----------------------

  // 1. The visualisation is established the moment it is on screen.
  check(
    "arc is substantially drawn as the chapter enters view",
    onEntry.painted > total * 0.25,
    `only ${onEntry.painted}/${total} painted on entry`,
  )

  // 2. Continuity: while the heading is still on screen, the arc is growing —
  //    and by the time the copy has left, the chamber is near complete.
  const whileCopyVisible = samples.filter(
    (s) => (s.headingRect?.bottom ?? -1) > 0 && (s.headingRect?.top ?? 0) < vp.height,
  )
  check(
    "arc is present throughout the copy being on screen",
    whileCopyVisible.every((s) => s.painted > total * 0.25),
    `min ${Math.min(...whileCopyVisible.map((s) => s.painted))}/${total} while copy visible`,
  )

  const afterCopyGone = samples.filter((s) => (s.headingRect?.bottom ?? 1) <= 0)
  if (afterCopyGone.length > 0) {
    check(
      "chamber is essentially complete once the copy has left",
      afterCopyGone[0].painted > total * 0.75,
      `${afterCopyGone[0].painted}/${total} at the first frame after the copy left`,
    )
  }

  // 3. It finishes, and the finished picture is actually on screen when it does.
  const completed = samples.filter((s) => s.painted >= total)
  check(
    "reaches a complete chamber",
    completed.length > 0,
    `max ${Math.max(...samples.map((s) => s.painted))}/${total}`,
  )
  if (completed.length > 0) {
    const first = completed[0]
    check(
      "the finished arc is fully within the viewport when it completes",
      (first.svgRect?.top ?? -1) >= 0 && (first.svgRect?.bottom ?? 1e9) <= vp.height,
      `svg at top ${first.svgRect?.top}, bottom ${first.svgRect?.bottom} in ${vp.height}px`,
    )

    // 4. No excessive dead scroll. Measured from completion to the moment the
    //    pin *releases* — the frame's top leaving its sticky offset — rather
    //    than to the last sample, which is an arbitrary point past the chapter.
    //    That span is the intended pause on the finished chamber.
    const released = samples.find(
      (s) => s.scrollY > first.scrollY && (s.svgRect?.top ?? 0) < 0,
    )
    const deadScroll = (released?.scrollY ?? samples[samples.length - 1].scrollY) - first.scrollY
    check(
      "dead scroll after completion is under one viewport",
      deadScroll < vp.height,
      `${deadScroll}px of scroll after completion (viewport ${vp.height}px)`,
    )
    console.log(`    · completes at scrollY ${first.scrollY}, ${deadScroll}px before release`)
  }

  // The count must agree with the picture, at every frame.
  check(
    "the printed count never disagrees with the seats drawn",
    samples.every((s) => {
      const printed = Number.parseInt((s.countText ?? "").replace(/[^\d]/, ""), 10)
      return Number.isNaN(printed) || Math.abs(printed - s.painted) <= 2
    }),
    "a sample printed a figure that did not match its arc",
  )

  await context.close()
}

await browser.close()

console.log(`\nScreenshots: ${SHOTS}`)
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURE(S):`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("\nAll checks passed.")
