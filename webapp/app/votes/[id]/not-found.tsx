import { NotFoundPage } from "@/components/not-found-page"

/**
 * What `notFound()` renders for an unknown ballot id.
 *
 * A segment boundary rather than the app-wide 404, for the reason
 * app/mps/[id]/not-found.tsx gives: "this URL is not a page" and "this page
 * exists but that ballot does not" are different answers, and the second wants
 * a way back to the list.
 *
 * Layout, the German-only decision, and the note on the HTTP 200 status live in
 * `NotFoundPage`, shared with the other two boundaries.
 */
export default function VoteNotFound() {
  return (
    <NotFoundPage messageKey="votes.notFound" backHref="/votes" backLabelKey="votes.backToList" />
  )
}
