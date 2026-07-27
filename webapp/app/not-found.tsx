import { NotFoundPage } from "@/components/not-found-page"

/**
 * The app-wide 404, for a URL that matches no route at all.
 *
 * Without this file Next.js serves its own built-in 404, and a browser sweep of
 * every route found what that costs: the page reads "This page could not be
 * found." in English, unstyled, inside an app that is German by default
 * (lib/i18n.ts) and themed by `.dark`/`:root` custom properties it knows
 * nothing about (app/globals.css). It also renders outside the root layout's
 * shell, so the header, the nav and the footer all vanish and the reader is
 * left on a blank page with no way back that is not the browser's own back
 * button. Three of the site's defining choices are contradicted at once, on
 * the one page a lost reader sees.
 *
 * Note the theme half of that sentence no longer reads "and dark by default":
 * the app now defaults to *light*, so Next's white built-in would be closer to
 * right than it was — but only by accident, and it would still be wrong for
 * every reader who has chosen dark. The reason this file exists is unchanged.
 *
 * The two `[id]` segments answer their own narrower question — "this MP does not
 * exist" and "this ballot does not exist" are not "this URL is not a page", and
 * each links back to the list that was probably meant. This is the general case
 * they leave, so the only useful destination is the home page.
 *
 * Layout, the German-only decision and the note on HTTP status all live in
 * `NotFoundPage`, which all three boundaries share.
 */
export default function NotFound() {
  return (
    <NotFoundPage messageKey="common.notFoundPage" backHref="/" backLabelKey="common.backHome" />
  )
}
