/**
 * The one place the sidebar's two widths are written down.
 *
 * Three components have to agree on these numbers or the shell comes apart at
 * the seams, and until now each held its own copy:
 *
 *  - `components/nav-sidebar.tsx` sized the rail itself (`w-64` / `w-14`).
 *  - `components/app-shell.tsx` insets the content column by the same amount,
 *    spelled in rem (`16rem` / `3.5rem`) because it feeds a CSS variable.
 *  - `components/site-header.tsx` now draws the header's left cell at exactly
 *    the collapsed rail's width, so the cell's right border and the rail's
 *    right border are one continuous vertical line down the page.
 *
 * The third is what forced the extraction. Two copies of a number that must
 * match can drift and only look slightly wrong; three copies, one of which
 * exists *solely* to line up with another, drift into a visibly broken join —
 * a divider that stops 1 px short of the rail below it is the kind of defect a
 * reader sees immediately and nobody can name.
 *
 * ## Why both a class and a length
 *
 * They are consumed in two places that cannot take the same form. A Tailwind
 * utility cannot appear inside an inline `style`, and a `var()`-bearing length
 * cannot be a class name. So the pair is written once, here, beside the
 * statement that they are the same measurement — rather than in two files that
 * would each look self-consistent while disagreeing.
 *
 * ⚠ The class strings must stay literal. Tailwind v4 extracts candidates from
 * the raw text of every scanned source file, this one included, so `w-14` is
 * generated because it is spelled out below. Building either name by
 * concatenation (`` `w-${n}` ``) would compile and typecheck and silently emit
 * no CSS at all.
 */

/** The collapsed rail: an icon column, 56 px. */
export const SIDEBAR_RAIL_WIDTH = "3.5rem"
/** @see SIDEBAR_RAIL_WIDTH — the same measurement as a utility class. */
export const SIDEBAR_RAIL_WIDTH_CLASS = "w-14"

/** The expanded rail: icons with their labels, 256 px. */
export const SIDEBAR_EXPANDED_WIDTH = "16rem"
/** @see SIDEBAR_EXPANDED_WIDTH — the same measurement as a utility class. */
export const SIDEBAR_EXPANDED_WIDTH_CLASS = "w-64"
