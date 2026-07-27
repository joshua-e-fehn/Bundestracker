import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * No MP portrait is rendered without its photographer credit.
 *
 * A filesystem check rather than a render test, in the same spirit as
 * lib/auth-routes.test.ts reading `app/` — the failure this guards against is
 * *a new component forgetting*, and no test of the components that exist today
 * can catch that. `MPPhoto` makes `credit` a required prop, so a caller cannot
 * omit it; this covers the other route, where someone reaches past `MPPhoto`
 * for a bare `<AvatarImage>` because it is two lines shorter.
 *
 * That is not hypothetical: it is exactly what four components did.
 * `rankings-table`, `party-members`, `activity-feed-item` and `mp-card` each
 * built their own Avatar, so the credit landed nowhere on the rankings, the
 * party pages, the feed or the home page — while `convex/schema.ts:207` states
 * that displaying it is the **licence condition** on these photographs, and the
 * pipeline honours that on the way in by dropping any portrait that arrives
 * without one.
 *
 * `components/user-menu.tsx` is the one legitimate exception: that avatar is the
 * signed-in reader's own OAuth picture from Google, not a Bundestag portrait,
 * and it carries no such condition.
 */

const COMPONENTS_DIR = join(import.meta.dir)

/** The reader's own OAuth avatar — not an MP portrait. See the header. */
const ALLOWED = new Set(["user-menu.tsx", "mp-photo.tsx"])

function componentFiles(): string[] {
  return readdirSync(COMPONENTS_DIR)
    .filter((name) => name.endsWith(".tsx"))
    .filter((name) => !ALLOWED.has(name))
}

describe("MP portraits carry their credit", () => {
  test("no component renders AvatarImage directly", () => {
    const offenders = componentFiles().filter((name) =>
      readFileSync(join(COMPONENTS_DIR, name), "utf8").includes("<AvatarImage"),
    )

    // Named in the failure rather than a bare count: the fix is to route that
    // component through `MPPhoto`, and knowing which one it is is the whole
    // value of the message.
    expect(offenders).toEqual([])
  })

  test("every MPPhoto call site passes a credit", () => {
    // `credit` is a required prop, so `tsc` already enforces this — but it
    // enforces it as a type error in a file someone may be tempted to silence
    // with `credit={null}`. Spelling the expectation out here states *why* the
    // prop is required, which a type signature cannot.
    const missing: string[] = []
    for (const name of componentFiles()) {
      const source = readFileSync(join(COMPONENTS_DIR, name), "utf8")
      // `[^>]*` over a newline-joined copy rather than the `s` flag, which
      // tsconfig's target predates. The call sites span several lines, so the
      // newlines have to go before the tag can be matched as one thing.
      const flattened = source.replace(/\s+/g, " ")
      for (const match of flattened.matchAll(/<MPPhoto\b[^>]*\/>/g)) {
        if (!match[0].includes("credit=")) missing.push(name)
      }
    }
    expect(missing).toEqual([])
  })
})
