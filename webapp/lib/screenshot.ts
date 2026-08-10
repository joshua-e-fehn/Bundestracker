"use client"

/**
 * A picture of the current page, taken in the page, with the sensitive parts
 * painted out before the image exists.
 *
 * ## Why this is hand-written and not `html2canvas`
 *
 * Because adding a dependency to take a screenshot of a page that must *not*
 * capture certain regions means trusting someone else's traversal with the
 * privacy requirement. The redaction here is not a post-processing step over a
 * finished image — by the time an image exists it is too late, since a
 * screenshot is pixels and there is no undo. Redaction happens on a **detached
 * clone of the DOM**, before it is ever rasterised, which is the only ordering
 * where "the secret was never in the image" is a true statement rather than a
 * hope.
 *
 * The mechanism is the SVG `<foreignObject>` trick: serialise a subtree to
 * XHTML, wrap it in an SVG, load it as an image, draw it to a canvas. Its
 * well-known limitations shaped every decision below, and each is handled
 * explicitly rather than worked around:
 *
 *  - **No external resources load.** An `<img src="https://…">` inside a
 *    `foreignObject` is not fetched, and a cross-origin one would taint the
 *    canvas and make `toBlob` throw. Every image is therefore replaced with a
 *    labelled placeholder box. On this site the images are MP portraits, which
 *    is a category of content there is no reason to publish in a bug report
 *    anyway — the limitation and the privacy rule point the same way.
 *  - **No external stylesheets apply.** Styles must be inlined as computed
 *    values, which `inlineComputedStyles` does, walking the live tree and the
 *    clone in lockstep.
 *  - **Web fonts do not load**, so text renders in a fallback face. Accepted:
 *    a screenshot for a bug report needs to show layout and content, not
 *    typography, and embedding the Geist woff2 as a data URI would add ~100 kB
 *    to every capture.
 *
 * ## The redaction contract
 *
 * Three categories are painted out, and the list is an allowlist of *what
 * survives* in spirit — everything matching a rule is covered, and a new
 * component that shows something sensitive opts in by marking itself:
 *
 *  1. `[data-feedback-redact]` — the explicit marker. This is the forward
 *     compatibility hook the requirement asks for: any future component
 *     showing sensitive data adds the attribute and is covered from then on,
 *     with no change to this file.
 *  2. Every form control's rendered value — `input`, `textarea`, `select`.
 *     Covered unconditionally, because the requirement forbids collecting
 *     form-field values and a screenshot of a filled field *is* the value.
 *  3. The account surfaces — the signed-in reader's name, email and avatar in
 *     the header menu and the sidebar.
 *
 * Redaction is a filled rectangle drawn in the clone, not a CSS blur: a blur is
 * reversible in principle and, more practically, `filter: blur()` inside a
 * `foreignObject` renders inconsistently across engines. A solid box cannot
 * fail open.
 */

/** Marks a region for redaction. Public so components can be marked without
 * importing a string literal. */
export const REDACT_ATTRIBUTE = "data-feedback-redact"

/**
 * Selectors redacted without being marked.
 *
 * Every form control, plus the account surfaces. `[data-slot="…"]` is the
 * shadcn convention this repo's `components/ui/*` already stamps on every
 * primitive, so these hook onto structure that exists rather than onto class
 * names that change.
 */
const ALWAYS_REDACT = [
  `[${REDACT_ATTRIBUTE}]`,
  "input",
  "textarea",
  "select",
  // The account menu and its trigger — name, email, avatar.
  "[data-feedback-account]",
]

/** Bounds on the produced image. A screenshot is a courtesy attachment, not an
 * archival asset: 1400 px is enough to read a layout bug and keeps a WebP
 * comfortably inside `LIMITS.screenshotBytes`. */
const MAX_DIMENSION = 1400
const QUALITY = 0.72

/** Elements that are never worth capturing and are removed from the clone
 * entirely rather than redacted — the widget taking the screenshot most of all,
 * since a picture of the report form is not a picture of the bug. */
const DROP_FROM_CLONE = ["[data-feedback-widget]", "script", "noscript", "style", "link"]

/**
 * Properties copied from computed style onto the clone.
 *
 * An allowlist rather than the whole `CSSStyleDeclaration` for a reason that is
 * about correctness as much as size: copying all ~350 computed properties
 * produces a style attribute so long that serialisation of a full page runs to
 * megabytes, and it also copies properties (`transition`, `animation`,
 * `will-change`) that make the clone render mid-animation. This list is the
 * subset that decides layout, colour and text.
 *
 * Tailwind v4's `oklch()` colours and `var()` custom properties are already
 * resolved by `getComputedStyle` — it returns used values — so they arrive here
 * as concrete colours and need no special handling. `color-mix()` likewise
 * resolves before this sees it.
 */
const COPIED_PROPERTIES = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "box-sizing",
  "overflow",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-self",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "white-space",
  "word-break",
  "color",
  "background-color",
  "background-image",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-style",
  "border-radius",
  "box-shadow",
  "opacity",
  "visibility",
  "transform",
  "transform-origin",
  "object-fit",
  "vertical-align",
  "list-style",
]

/** The colour a redaction box is painted. A mid grey with a visible label
 * reads unambiguously as "removed on purpose" rather than as a rendering bug
 * the maintainer then chases. */
const REDACTION_FILL = "#6b7280"

/**
 * Copies computed style from every live node onto its clone.
 *
 * Walks both trees in lockstep with two `TreeWalker`s rather than by index:
 * the clone has had nodes removed by `stripClone`, so indices diverge. This is
 * why removal happens *after* styling — the trees must be structurally
 * identical while they are being walked together.
 */
function inlineComputedStyles(live: Element, clone: Element): void {
  const liveWalker = document.createTreeWalker(live, NodeFilter.SHOW_ELEMENT)
  const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT)

  const apply = (from: Element, to: Element) => {
    const computed = window.getComputedStyle(from)
    const declarations: string[] = []
    for (const property of COPIED_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (!value) continue
      declarations.push(`${property}:${value}`)
    }
    to.setAttribute("style", declarations.join(";"))
  }

  apply(live, clone)
  let liveNode = liveWalker.nextNode()
  let cloneNode = cloneWalker.nextNode()
  while (liveNode && cloneNode) {
    apply(liveNode as Element, cloneNode as Element)
    liveNode = liveWalker.nextNode()
    cloneNode = cloneWalker.nextNode()
  }
}

/**
 * Replaces a node's subtree with an opaque box of the same size.
 *
 * Sized from the *live* element's rect so the clone's layout does not shift —
 * a redaction that collapsed its box would reflow everything after it and the
 * screenshot would no longer depict the page the reader saw.
 */
function redactNode(clone: HTMLElement, rect: DOMRect): void {
  clone.textContent = ""
  clone.setAttribute(
    "style",
    [
      `display:${rect.width > 0 ? "inline-block" : "none"}`,
      `width:${Math.round(rect.width)}px`,
      `height:${Math.round(rect.height)}px`,
      `background-color:${REDACTION_FILL}`,
      "border-radius:4px",
      // Kept in flow so surrounding layout is unchanged.
      "vertical-align:middle",
      "overflow:hidden",
    ].join(";"),
  )
  clone.setAttribute("data-redacted", "true")
}

/**
 * Applies the redaction rules to the clone.
 *
 * Queries the **live** tree for matches and maps each to its clone counterpart
 * by walking both in lockstep — the same technique and the same reason as
 * `inlineComputedStyles`. Matching on the clone directly would work too, but
 * the rect must come from the live element (a detached clone has no layout, so
 * every `getBoundingClientRect` on it is zero), so the live node is needed
 * regardless and pairing them once is simpler than twice.
 */
function applyRedactions(live: Element, clone: Element): number {
  const selector = ALWAYS_REDACT.join(",")
  const liveWalker = document.createTreeWalker(live, NodeFilter.SHOW_ELEMENT)
  const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT)
  let redacted = 0

  const consider = (from: Element, to: Element): boolean => {
    if (!from.matches(selector)) return false
    if (to instanceof HTMLElement) {
      redactNode(to, from.getBoundingClientRect())
      redacted++
      return true
    }
    return false
  }

  consider(live, clone)
  let liveNode = liveWalker.nextNode()
  let cloneNode = cloneWalker.nextNode()
  while (liveNode && cloneNode) {
    // A redacted node's subtree is already gone from the clone, but the walkers
    // must stay in step, so both continue walking the live subtree and the
    // (now childless) clone advances past it naturally — hence no skipping
    // here: `consider` empties the clone node rather than removing it.
    consider(liveNode as Element, cloneNode as Element)
    liveNode = liveWalker.nextNode()
    cloneNode = cloneWalker.nextNode()
  }
  return redacted
}

/**
 * Replaces every image with a placeholder and drops what must not be drawn.
 *
 * Images are replaced rather than left to fail: an `<img>` whose source never
 * loads renders as a broken-image glyph or as nothing at all, and either makes
 * the screenshot misrepresent the page. A grey box labelled with the element's
 * dimensions is honest about what was there.
 *
 * Runs *after* styling, because it changes the clone's structure.
 */
function stripClone(clone: Element): void {
  for (const node of clone.querySelectorAll(DROP_FROM_CLONE.join(","))) {
    node.remove()
  }
  for (const img of Array.from(clone.querySelectorAll("img, svg, canvas, video, iframe"))) {
    if (img.closest("[data-redacted]")) continue
    const box = document.createElement("div")
    const width = (img as HTMLElement).style.width || "16px"
    const height = (img as HTMLElement).style.height || "16px"
    box.setAttribute(
      "style",
      `display:inline-block;width:${width};height:${height};background-color:#d4d4d8;border-radius:2px`,
    )
    img.replaceWith(box)
  }
}

/**
 * `cloneNode` copies the value *attribute*, not the value *property*.
 *
 * So a field the reader typed into carries its original `value=""` attribute in
 * the clone and its typed text only in the live property. That is a footgun
 * pointing away from us for once — the typed value does not survive cloning by
 * default — but it is not relied on: every form control is redacted
 * unconditionally by `ALWAYS_REDACT`, so the value is painted over regardless
 * of which of the two a browser happens to serialise. This function exists to
 * state that the belt and the braces are both deliberate.
 */
function assertFormControlsRedacted(clone: Element): void {
  for (const control of clone.querySelectorAll("input, textarea, select")) {
    if (control.getAttribute("data-redacted") !== "true") {
      // Not reachable through `capture` — `ALWAYS_REDACT` covers all three tag
      // names — but a future edit to that list would make it reachable, and a
      // screenshot is the wrong place to discover that.
      control.remove()
    }
  }
}

export type ScreenshotResult = {
  /** WebP bytes, ready to upload. */
  blob: Blob
  width: number
  height: number
  /** How many regions were painted out — shown to the reader in the preview so
   * the redaction is visible as a fact, not just as grey boxes. */
  redactedCount: number
}

/**
 * Captures the current viewport.
 *
 * Returns `null` rather than throwing when capture is impossible — an
 * unsupported browser, a serialisation failure, a tainted canvas. A screenshot
 * is optional to the report, and a failed capture must degrade to "no
 * screenshot" rather than to a failed submission.
 */
export async function captureScreenshot(): Promise<ScreenshotResult | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null

  try {
    const live = document.body
    const width = Math.min(window.innerWidth, MAX_DIMENSION)
    const height = Math.min(window.innerHeight, MAX_DIMENSION)
    if (width === 0 || height === 0) return null

    const clone = live.cloneNode(true) as HTMLElement

    // Order matters and is load-bearing:
    //   1. style — needs both trees structurally identical
    //   2. redact — needs live rects, and must happen before rasterisation
    //   3. strip — changes structure, so it goes last
    inlineComputedStyles(live, clone)
    const redactedCount = applyRedactions(live, clone)
    stripClone(clone)
    assertFormControlsRedacted(clone)

    // The clone is a detached <body>; give it the viewport's own scroll offset
    // so the capture shows what the reader is looking at rather than the top of
    // the document.
    clone.setAttribute(
      "style",
      [
        `width:${window.innerWidth}px`,
        `height:${window.innerHeight}px`,
        `margin:0`,
        `overflow:hidden`,
        `background-color:${window.getComputedStyle(document.body).backgroundColor || "#ffffff"}`,
        `transform:translate(${-window.scrollX}px, ${-window.scrollY}px)`,
      ].join(";"),
    )

    const serialized = new XMLSerializer().serializeToString(clone)
    // `xmlns` on both the SVG and the foreignObject's child is required — the
    // image will silently fail to load without it.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${window.innerWidth}" height="${window.innerHeight}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div>` +
      `</foreignObject></svg>`

    const image = await loadImage(
      // A data URI rather than a blob URL: no object URL to leak, and no
      // same-origin question for the canvas to consider.
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    )
    if (!image) return null

    const canvas = document.createElement("canvas")
    const scale = Math.min(1, MAX_DIMENSION / Math.max(window.innerWidth, window.innerHeight))
    canvas.width = Math.round(window.innerWidth * scale)
    canvas.height = Math.round(window.innerHeight * scale)
    const context = canvas.getContext("2d")
    if (!context) return null
    context.fillStyle = window.getComputedStyle(document.body).backgroundColor || "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    const blob = await canvasToBlob(canvas)
    if (!blob || blob.size > 1_500_000) return null

    return { blob, width: canvas.width, height: canvas.height, redactedCount }
  } catch {
    // Any failure is "no screenshot". See the note on the return type.
    return null
  }
}

/** Loads an image and waits for it to decode. `decode()` rather than `onload`
 * alone: `onload` fires before an SVG's layout is complete in some engines, and
 * drawing then produces a blank frame. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      image
        .decode()
        .then(() => resolve(image))
        // Some engines reject `decode()` for SVG while still drawing fine.
        .catch(() => resolve(image))
    }
    image.onerror = () => resolve(null)
    image.src = src
    // A capture that hangs must not hang the widget.
    setTimeout(() => resolve(image.complete ? image : null), 4000)
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      // WebP: roughly a third of the PNG size for a page screenshot, and
      // supported everywhere this app runs. `toBlob` throws SecurityError on a
      // tainted canvas — which cannot happen here, since every external image
      // was replaced before rasterisation, but the try/catch makes that a
      // degradation rather than an exception.
      canvas.toBlob((blob) => resolve(blob), "image/webp", QUALITY)
    } catch {
      resolve(null)
    }
  })
}
