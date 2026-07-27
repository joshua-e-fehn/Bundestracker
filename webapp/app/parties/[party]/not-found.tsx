import { NotFoundPage } from "@/components/not-found-page"

/**
 * The boundary `/parties/[party]` renders for a segment naming no Fraktion.
 *
 * The third of these on the site, beside `/mps/[id]` and `/votes/[id]`, and it
 * exists for the same reason: "this group does not exist" is a more useful
 * sentence than "this page does not exist", and the way back is the group
 * comparison rather than the home page. Everything else — the layout, the
 * heading, the German-only rendering and the ⚠ note about the HTTP status —
 * lives in `NotFoundPage`.
 */
export default function PartyNotFound() {
  return (
    <NotFoundPage
      messageKey="parties.notFound"
      backHref="/parties"
      backLabelKey="parties.backToParties"
    />
  )
}
