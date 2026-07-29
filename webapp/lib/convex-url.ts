/**
 * The Convex deployment this build talks to, checked once at module load.
 *
 * ## The bug this exists to prevent
 *
 * `NEXT_PUBLIC_CONVEX_URL` is inlined at build time. Point a build at the wrong
 * deployment and nothing fails: the URL is well-formed, the deployment answers,
 * and — because a sibling deployment carries the same schema and the same
 * functions — every query returns a *successful* result. It is just empty.
 *
 * That matters here because of what the vote page does with an empty result.
 * `getVoteSheetById` ends in `ctx.db.get(id)`, which returns `null` for an id
 * naming no row, and `app/votes/[id]/page.tsx` turns `null` into `notFound()`.
 * So a real ballot id, requested from a deployment that does not hold it,
 * renders "Diese Abstimmung existiert nicht oder wurde noch nicht geladen." —
 * a page stating as fact that a division the Bundestag actually held does not
 * exist. The shell renders, the nav renders, nothing is logged, and the site
 * looks healthy while lying about the record.
 *
 * ⚠ The asymmetry that makes this invisible: an id that is *malformed*, or that
 * belongs to another table, makes `ctx.db.get` **throw**, which surfaces as an
 * error page. Only a well-formed id from a *different deployment of the same
 * schema* comes back as a quiet `null`. The failure mode is therefore silent
 * exactly in the case where the configuration is wrong, and loud in the cases
 * where it is right.
 *
 * ## Why a check rather than a fallback
 *
 * There is no correct value to fall back to. Guessing a deployment would be the
 * same class of mistake in the other direction — serving one deployment's data
 * from another's build — so this throws instead. A build that cannot name its
 * backend has nothing to serve, and `lib/auth-server.ts` already takes that
 * position for the same two variables (its `!` assertions are the same claim,
 * stated as a type rather than as a check).
 *
 * Throwing at module load also means it fails during `next build`, where the
 * page-data collection imports this — a broken deploy that never goes live,
 * rather than a 404 a reader has to notice and report.
 */

/**
 * A Convex deployment URL, as Convex itself formats them.
 *
 * Deliberately a shape check rather than an allowlist of deployment names: the
 * name changes when the project is recreated, and a test that hard-codes today's
 * name is one that has to be edited to stay true. What is worth asserting is
 * that the value is a Convex cloud URL at all — the misconfiguration this has
 * actually seen is a *different Convex deployment*, and no regex can catch that.
 * `assertSameDeployment` is the part that can.
 */
const CONVEX_CLOUD_URL = /^https:\/\/[a-z0-9-]+\.convex\.cloud$/

/** The `.site` origin, which Better Auth is served from. Same host, different
 * suffix — that pairing is what `assertSameDeployment` checks. */
const CONVEX_SITE_URL = /^https:\/\/[a-z0-9-]+\.convex\.site$/

/**
 * The deployment name out of either origin — `whimsical-bandicoot-307` from
 * `https://whimsical-bandicoot-307.convex.cloud`.
 *
 * Returns null rather than throwing for anything that is not one of the two
 * shapes, so the callers can say which variable was wrong.
 */
export function deploymentName(url: string): string | null {
  const match = /^https:\/\/([a-z0-9-]+)\.convex\.(cloud|site)$/.exec(url)
  return match?.[1] ?? null
}

/**
 * Whether `cloudUrl` and `siteUrl` name the same deployment.
 *
 * The pair is set by hand in the Vercel dashboard, one variable at a time, so
 * "half-updated" is a state this has been in: queries against one deployment
 * while auth talks to another. Neither side errors — the reader is simply never
 * signed in, on a site where being signed in is optional and therefore
 * unremarkable.
 */
export function isSameDeployment(cloudUrl: string, siteUrl: string): boolean {
  const cloud = deploymentName(cloudUrl)
  const site = deploymentName(siteUrl)
  return cloud !== null && cloud === site
}

/**
 * Reads and validates the deployment URLs this build was compiled against.
 *
 * Called at module load by the places that hold a Convex client. The message
 * names the variable and what it looked like, because the person reading it is
 * looking at a build log rather than at this file.
 */
export function requireConvexUrls(env: {
  NEXT_PUBLIC_CONVEX_URL?: string
  NEXT_PUBLIC_CONVEX_SITE_URL?: string
}): { cloudUrl: string; siteUrl: string } {
  const cloudUrl = env.NEXT_PUBLIC_CONVEX_URL
  const siteUrl = env.NEXT_PUBLIC_CONVEX_SITE_URL

  if (!cloudUrl || !CONVEX_CLOUD_URL.test(cloudUrl)) {
    throw new Error(
      `NEXT_PUBLIC_CONVEX_URL must be a Convex deployment URL like ` +
        `https://example-animal-123.convex.cloud — received ${JSON.stringify(cloudUrl)}. ` +
        `Without it every query returns null and the site renders "not found" for real data.`,
    )
  }
  if (!siteUrl || !CONVEX_SITE_URL.test(siteUrl)) {
    throw new Error(
      `NEXT_PUBLIC_CONVEX_SITE_URL must be a Convex site URL like ` +
        `https://example-animal-123.convex.site — received ${JSON.stringify(siteUrl)}.`,
    )
  }
  if (!isSameDeployment(cloudUrl, siteUrl)) {
    throw new Error(
      `NEXT_PUBLIC_CONVEX_URL (${deploymentName(cloudUrl)}) and NEXT_PUBLIC_CONVEX_SITE_URL ` +
        `(${deploymentName(siteUrl)}) name different Convex deployments. Queries and auth ` +
        `would be served by different backends.`,
    )
  }

  return { cloudUrl, siteUrl }
}
