import { NotFoundPage } from "@/components/not-found-page"

/**
 * What `notFound()` renders for an unknown MP id.
 *
 * A segment boundary rather than the app-wide 404, because the two are
 * different questions: "this URL is not a page" and "this page exists but that
 * MP does not". The second wants a way back to the roster, which is almost
 * always what the reader meant.
 *
 * Layout, the German-only decision, and the note on why this renders with HTTP
 * 200 under Next 16.2.12 all live in `NotFoundPage` — shared with the ballot
 * boundary and the app-wide one, which had the same body to the byte.
 */
export default function MPNotFound() {
  return <NotFoundPage messageKey="mp.notFound" backHref="/mps" backLabelKey="mp.backToList" />
}
