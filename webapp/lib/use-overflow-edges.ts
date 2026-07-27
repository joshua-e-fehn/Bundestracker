"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Which edges of a horizontal scroller have content beyond them.
 *
 * Drives the `scroll-strip` utility's edge fade (app/globals.css). The fade has
 * to be conditional or it lies: a strip whose content fits would dim its first
 * and last item for no reason, and a strip scrolled to its end would keep
 * fading the right edge as though more were coming.
 *
 * ## Why this is measured rather than a media query
 *
 * Because overflow is not a function of viewport width. The rankings' nine
 * board tabs are wider than their 1152 px container at *every* size; the
 * seating map's five colour modes fit from `sm` up. A breakpoint cannot
 * distinguish those, and the two strips are the same component. `scrollWidth`
 * against `clientWidth` can.
 *
 * ## What it watches
 *
 * Three things change the answer and all three are covered:
 *
 *  - **Scrolling**, obviously — passive, since nothing here calls
 *    `preventDefault` and a non-passive listener on a scroller costs frames.
 *  - **Resizing the element**, via `ResizeObserver`. Not `window.resize`: the
 *    strip also changes width when a sibling appears beside it or a parent
 *    grid reflows, neither of which is a window event.
 *  - **Its contents changing**, via the same observer on the scrolling
 *    content — switching language re-labels every tab, and "Höchste
 *    Abstimmungsbeteiligung" and "Highest voting participation" are not the
 *    same width.
 *
 * Returns a `data-overflow` value ready to spread, so the caller states which
 * element scrolls and nothing else:
 *
 *   const { ref, dataOverflow } = useOverflowEdges<HTMLDivElement>()
 *   <div ref={ref} data-overflow={dataOverflow} className="scroll-strip">
 */
export function useOverflowEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const element = ref.current
    if (element === null) return
    const { scrollLeft, scrollWidth, clientWidth } = element
    // A pixel of slack: fractional layout widths mean `scrollWidth` and
    // `clientWidth` differ by sub-pixel amounts on a strip that visibly fits,
    // and a fade over nothing is exactly what this hook exists to avoid.
    setEdges({
      start: scrollLeft > 1,
      end: scrollLeft + clientWidth < scrollWidth - 1,
    })
  }, [])

  useEffect(() => {
    const element = ref.current
    if (element === null) return

    measure()
    element.addEventListener("scroll", measure, { passive: true })

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The content, not only the box: a wider label set overflows a box that
    // never changed size, which the element's own entry would not report.
    for (const child of element.children) observer.observe(child)

    return () => {
      element.removeEventListener("scroll", measure)
      observer.disconnect()
    }
  }, [measure])

  /** `undefined` rather than `""` when neither edge overflows, so the attribute
   * is absent from the DOM instead of present and empty — the CSS keys on
   * `~=`, which an empty value would not match, but an attribute that is there
   * and says nothing is a worse thing to read in a devtools inspector. */
  const dataOverflow =
    [edges.start ? "start" : null, edges.end ? "end" : null].filter(Boolean).join(" ") || undefined

  return { ref, dataOverflow, ...edges }
}
