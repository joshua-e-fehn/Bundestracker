/**
 * The reduced-motion contract for `/`'s Chapter 1.
 *
 * Separate from verify-chamber-scroll.mjs because it asserts the *inverse*: no
 * pin, no travel, and the finished chamber on the first paint. That is the
 * promise app/globals.css's `chamber-pin` rule and `useReducedMotion` make
 * together, and it is the one that has already regressed once (the tall track
 * survived hydration and left a reduced-motion reader two viewports of empty
 * scrolling — see the note at the utility).
 */

import { chromium } from "playwright"

const BASE = process.env.BASE_URL ?? "http://localhost:3000"

const failures = []
const check = (label, condition, detail) => {
  if (condition) console.log(`  ✓ ${label}`)
  else {
    console.log(`  ✗ ${label} — ${detail}`)
    failures.push(label)
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  reducedMotion: "reduce",
})
const page = await context.newPage()
await page.goto(BASE, { waitUntil: "networkidle" })
await page.waitForFunction("document.querySelectorAll('#kapitel-1 svg circle').length > 0", {
  timeout: 20000,
})
await page.waitForTimeout(500)

const state = await page.evaluate(() => {
  const svg = document.querySelector("#kapitel-1 svg")
  const track = document.querySelector("#kapitel-1 .chamber-pin")
  const count = document.querySelector("#kapitel-1 p.tabular-nums")?.textContent?.trim() ?? ""
  const figures = count.match(/\d[\d.,  ]*/g) ?? []
  return {
    painted: [...svg.querySelectorAll("circle")].filter(
      (c) => Number.parseFloat(getComputedStyle(c).opacity) > 0.05,
    ).length,
    total: Number.parseInt((figures[figures.length - 1] ?? "0").replace(/[^\d]/g, ""), 10),
    trackHeight: Math.round(track.getBoundingClientRect().height),
    svgHeight: Math.round(svg.getBoundingClientRect().height),
    countText: count,
  }
})

console.log("reduced motion @ 1680x1050 (no scrolling performed):")
console.log(`  ${JSON.stringify(state)}`)

// The finished chamber, immediately — not a half-drawn one, and without the
// reader having scrolled at all.
check(
  "the chamber is complete on the first paint",
  state.painted === state.total && state.total > 0,
  `${state.painted}/${state.total} painted`,
)

// And no pin: the track collapses to the frame's own height, so there is no
// empty travel after the picture.
check(
  "the pin is collapsed — no dead scroll after the chamber",
  state.trackHeight < state.svgHeight * 2,
  `track ${state.trackHeight}px against an svg of ${state.svgHeight}px`,
)

await page.screenshot({ path: "/tmp/chamber-shots/reduced-motion.png" })
await browser.close()

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURE(S)`)
  process.exit(1)
}
console.log("\nAll checks passed.")
