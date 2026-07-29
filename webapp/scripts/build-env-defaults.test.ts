import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { requireConvexUrls } from "../lib/convex-url"

/**
 * The build's environment contract, exercised by actually running the script.
 *
 * Worth testing out of proportion to its twelve lines of shell, because both of
 * its failure directions are silent and one of them is dangerous.
 *
 * **Too little** and `pixi run build` fails in any environment that has not
 * configured a Convex deployment — which is what happened: the CI workflow set
 * the variables in its own YAML, the documented command did not, and the build
 * gate failed independent verification while passing in CI's own hands.
 *
 * **Too much** — a script that *overrode* rather than defaulted — would compile
 * production against `placeholder-build-check-000`. That build would not crash.
 * `lib/convex-url.ts` would accept the pair (it is well-formed and agrees with
 * itself), every query would fail to reach a backend that does not exist, and
 * the failure would surface as an empty site rather than as a build error. The
 * guard exists to prevent exactly that class of mistake, so a helper that
 * caused it would be the worst possible bug in this file.
 *
 * Hence: run the real script, in a real subprocess, with a real environment.
 * Asserting on the shell is the only thing that proves the shell is right.
 */

const SCRIPT = new URL("./build-env-defaults.sh", import.meta.url).pathname

const PLACEHOLDER = {
  cloud: "https://placeholder-build-check-000.convex.cloud",
  site: "https://placeholder-build-check-000.convex.site",
}

const REAL = {
  cloud: "https://whimsical-bandicoot-307.convex.cloud",
  site: "https://whimsical-bandicoot-307.convex.site",
}

/**
 * A minimal environment the script can run in. Deliberately *not* built from
 * `process.env`: a developer whose shell exports `NEXT_PUBLIC_CONVEX_URL` would
 * otherwise make these tests pass or fail by accident, and the whole subject
 * here is what the script does with an environment that does or does not have
 * those variables. PATH is carried through because the script needs a shell.
 *
 * `NODE_ENV` is here because Next declares it non-optional on `ProcessEnv`
 * (next/types/global.d.ts), and `production` is what a real build runs under —
 * so including it makes this environment more faithful, not less.
 */
function baseEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "production" }
}

/**
 * Runs the script with a controlled environment and reports what the wrapped
 * command actually saw.
 *
 * The three URLs come back on stdout; the script's own progress line goes to
 * stderr, which is what keeps the two separable here.
 */
function run(env: Record<string, string>) {
  const result = spawnSync(
    "bash",
    [
      SCRIPT,
      "sh",
      "-c",
      'printf "%s\\n%s\\n%s\\n" "$NEXT_PUBLIC_CONVEX_URL" "$NEXT_PUBLIC_CONVEX_SITE_URL" "$NEXT_PUBLIC_SITE_URL"',
    ],
    { env: { ...baseEnv(), ...env }, encoding: "utf8" },
  )
  const [cloud, site, app] = result.stdout.trim().split("\n")
  return { cloud, site, app, status: result.status, stderr: result.stderr }
}

describe("build-env-defaults.sh", () => {
  test("fills in a valid pair when nothing is set", () => {
    // The clean-checkout and CI case. Before this script, `pixi run build` here
    // died in page-data collection with "NEXT_PUBLIC_CONVEX_URL must be a
    // Convex deployment URL … received undefined".
    const { cloud, site, app, status } = run({})
    expect(status).toBe(0)
    expect(cloud).toBe(PLACEHOLDER.cloud)
    expect(site).toBe(PLACEHOLDER.site)
    expect(app).toBe("http://localhost:3000")
  })

  test("never overrides a configured deployment", () => {
    // The property that matters most. Vercel sets these from its dashboard; a
    // script that clobbered them would ship production pointed at a deployment
    // that does not exist, and lib/convex-url.ts could not catch it because the
    // placeholder pair is internally consistent.
    const { cloud, site, app, status } = run({
      NEXT_PUBLIC_CONVEX_URL: REAL.cloud,
      NEXT_PUBLIC_CONVEX_SITE_URL: REAL.site,
      NEXT_PUBLIC_SITE_URL: "https://www.bundestracker.de",
    })
    expect(status).toBe(0)
    expect(cloud).toBe(REAL.cloud)
    expect(site).toBe(REAL.site)
    expect(app).toBe("https://www.bundestracker.de")
  })

  test("treats an empty value as unset", () => {
    // A CI runner that declares `NEXT_PUBLIC_CONVEX_URL: ""`, or a `.env` line
    // with nothing after the `=`. `-n "$VAR"` would call that configured and
    // hand the empty string to the guard, which is the "received undefined"
    // failure with an extra step.
    const { cloud, site, status } = run({
      NEXT_PUBLIC_CONVEX_URL: "",
      NEXT_PUBLIC_CONVEX_SITE_URL: "",
    })
    expect(status).toBe(0)
    expect(cloud).toBe(PLACEHOLDER.cloud)
    expect(site).toBe(PLACEHOLDER.site)
  })

  test("replaces both halves when only one is set", () => {
    // Half-configured. Filling in only the missing half would pair a real URL
    // with a placeholder, and `requireConvexUrls` rejects that as "different
    // Convex deployments" — a confusing error when the true situation is that
    // this environment has not been configured for a real build.
    const { cloud, site, status } = run({ NEXT_PUBLIC_CONVEX_URL: REAL.cloud })
    expect(status).toBe(0)
    expect(cloud).toBe(PLACEHOLDER.cloud)
    expect(site).toBe(PLACEHOLDER.site)
  })

  test("the placeholder pair is one lib/convex-url.ts accepts", () => {
    // The script and the guard have to agree, and they are written in different
    // languages in different files. If the guard's rules tighten — a stricter
    // deployment-name shape, say — this fails here rather than in a build log.
    expect(
      requireConvexUrls({
        NEXT_PUBLIC_CONVEX_URL: PLACEHOLDER.cloud,
        NEXT_PUBLIC_CONVEX_SITE_URL: PLACEHOLDER.site,
      }),
    ).toEqual({ cloudUrl: PLACEHOLDER.cloud, siteUrl: PLACEHOLDER.site })
  })

  test("passes the child's exit code through", () => {
    // It wraps `next build`. Swallowing a non-zero status would turn a failed
    // build into a green CI run, which is worse than having no gate at all.
    expect(run({}).status).toBe(0)
    const failed = spawnSync("bash", [SCRIPT, "sh", "-c", "exit 42"], {
      env: baseEnv(),
      encoding: "utf8",
    })
    expect(failed.status).toBe(42)
  })
})
