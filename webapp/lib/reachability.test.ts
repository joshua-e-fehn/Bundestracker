import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Every public Convex function has a runtime caller, or an explicit reason it
 * does not.
 *
 * ## The regression this catches
 *
 * Both audits that led to this branch — the 2026-07-29 implementation-gap
 * audit and the 2026-07-30 reachability audit — landed the same finding:
 * roughly a quarter of the public Convex surface was published functions no
 * UI actually called. Each was a real read path (a `.collect()` or a joined
 * roster scan) reachable by anyone who guessed the path, feeding no reader.
 * A backend export that ships in a PR meant to enable a UI, without the UI,
 * is the shape of that regression — it clears CI on the day it lands and
 * never surfaces again.
 *
 * This test refuses that class of PR at the door: every `query({...})`,
 * `mutation({...})` or `action({...})` under `convex/*.ts` must either
 *
 *   1. be referenced somewhere under `app/` / `components/` / `lib/` /
 *      `providers/` / `hooks/` / `scripts/` / the repo-root `scripts/` /
 *      `pipeline/`, or
 *   2. carry an entry in `ALLOWLIST` below stating **why**.
 *
 * The allowlist is small on purpose: each entry is a claim that a caller
 * exists which a static grep cannot see (framework-driven hydration, an
 * out-of-band operator call, a script that POSTs to `/api/query`
 * dynamically). Adding an entry is what makes a backend-only public
 * function reviewable rather than accidental; deleting a caller when its
 * caller goes away is the sibling check the assertion at the end enforces.
 *
 * ## Method mirrors `scripts/check-codegen.ts`
 *
 * Same tree-walk (`readdirSync`, skip `_generated`, skip a second dot in the
 * filename), same trade — `node:fs` rather than shelling out to `rg`, so it
 * runs in every bun sandbox and does not depend on a binary a CI container
 * may not carry. The regex extractors are the smallest thing that answers
 * the question; they are not TypeScript AST parsers by design.
 *
 * ## Test file lives in `lib/`, not `convex/`
 *
 * `webapp/convex/*.ts` is compiled to a V8 isolate that has no Node
 * builtins, and the codebase's `convex-lint` refuses `node:fs` imports
 * from that directory even in test files. `lib/` is the plain Bun test
 * environment; `readCost.test.ts` sits in `convex/` because it exercises
 * Convex handlers directly, which this test does not.
 *
 * ## What a passing test does *not* prove
 *
 * A wired export need not be well-wired. This proves the string
 * `api.foo.bar` appears in a scanned tree, not that the caller works or is
 * reachable at runtime. `webapp/app/metadata-locale.test.ts` is the
 * companion pattern: source-scan tests pin *shape* claims; behavioural
 * claims live in each function's own unit test.
 *
 * Dynamic access (`api[key]`, `(api as any).bar`) would blind this test to
 * a real caller — see the `no dynamic api[...] access` invariant below.
 */

const WEBAPP_ROOT = join(import.meta.dir, "..")
const CONVEX_DIR = join(WEBAPP_ROOT, "convex")
const REPO_ROOT = join(WEBAPP_ROOT, "..")

/** Every tree grep-ed for `api.<module>.<name>` references. A missing root
 * is tolerated (there is no `hooks/` today), so the walker is honest about
 * what it saw rather than failing on a directory that has never existed. */
const USAGE_ROOTS: string[] = [
  join(WEBAPP_ROOT, "app"),
  join(WEBAPP_ROOT, "components"),
  join(WEBAPP_ROOT, "lib"),
  join(WEBAPP_ROOT, "providers"),
  join(WEBAPP_ROOT, "hooks"),
  join(WEBAPP_ROOT, "scripts"),
  join(REPO_ROOT, "scripts"),
  join(REPO_ROOT, "pipeline"),
]

/**
 * The public exports the reachability check cannot find a caller for, with
 * the reason each is legitimately here.
 *
 * Adding an entry is an editorial decision: prefer wiring or deleting. If a
 * function has to stay public and unreferenced, describe *who* reaches it
 * (framework, script, dashboard) — the reason text is what a future reviewer
 * uses to judge whether the exception is still earning its keep. The
 * companion assertion below fails when an allowlisted key becomes referenced,
 * so a live caller never silently stops the check.
 */
const ALLOWLIST: Record<string, string> = {
  "auth.getCurrentUser":
    "read by the @convex-dev/better-auth React hooks during session hydration — no static api.auth.getCurrentUser reference exists in the tree",
  // The four rows below are the 'backend built, no UI' shape the 2026-07-30
  // audit called out (RES-01, RES-02, RES-03). Each has a UI it was
  // designed for — /committees drilldown, per-MP §31 declarations,
  // per-sitting speech view — that has not been built yet. Kept public
  // because the intent is genuinely to wire them, not to keep the surface;
  // an audit run in Q4 2026 that still finds them here should treat that
  // as evidence to delete rather than to renew the exception.
  "committees.getCommittees":
    "reserved for the /committees index page (RES-01); delete this entry and the export when the /committees route ships, or delete both if the page is dropped from scope",
  "committees.getCommitteeMembers":
    "reserved for the /committees drilldown (RES-01, pairs with getCommittees); same disposition as above — wire or delete together",
  "voteExplanations.getExplanationsByMP":
    "reserved for a per-MP §31 declarations tab on the profile (RES-02); if the tab does not ship in the next audit cycle, delete both this export and the entry",
  "speeches.getSpeechesBySitting":
    "reserved for a per-sitting speech view (RES-03); if the sitting-detail route does not ship in the next audit cycle, delete both this export and the entry",
}

/** File extensions worth scanning for callers. Python is here because
 * `pipeline/` and the repo-root `scripts/` reach public queries by string
 * path (`"mps:getMPs"`) — a POST body, not a static import, so a Python
 * scan is the only way to catch a caller `mps.getMPs` claims. */
const CALLER_EXTENSIONS = /\.(?:tsx?|mjs|js|py)$/
const TEST_FILE = /\.test\.tsx?$/

/** Walk a subtree, returning every file whose extension matches
 * `CALLER_EXTENSIONS` and which is not a test file. Missing roots are
 * tolerated — see the note on `USAGE_ROOTS`. */
function callerFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const stat = statSync(root)
  if (!stat.isDirectory()) return []
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    if (entry.name === "node_modules" || entry.name === ".next") continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...callerFiles(full))
    } else if (CALLER_EXTENSIONS.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Every `${module}.${name}` public export declared in `convex/*.ts`.
 * Skips subdirs (`convex/lib/`, `convex/betterAuth/`), dotfiles, `schema.ts`,
 * and anything with a second dot — mirrors `scripts/check-codegen.ts` and
 * the entryPoints rule Convex itself uses. */
function publicExports(dir: string): Map<string, { module: string; name: string; file: string }> {
  const out = new Map<string, { module: string; name: string; file: string }>()
  const publicExportPattern = /^export const ([A-Za-z0-9_]+) = (?:query|mutation|action)\(/gm
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    if (entry.name.startsWith(".")) continue
    if (!entry.name.endsWith(".ts")) continue
    if (entry.name === "schema.ts") continue
    if ((entry.name.match(/\./g) ?? []).length > 1) continue
    const module = entry.name.replace(/\.ts$/, "")
    const file = join(dir, entry.name)
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(publicExportPattern)) {
      out.set(`${module}.${match[1]}`, { module, name: match[1], file })
    }
  }
  return out
}

/** Every `${module}.${name}` referenced under any tree in `USAGE_ROOTS`.
 *
 * The TS/JS pattern matches `api.mod.name`; the Python pattern matches the
 * string form `"mod:name"` used by the pipeline's HTTP body (`{path:
 * "mps:getMPs"}`). Both live in the same set — the reachability question
 * ("does anyone actually call this") does not care what language the
 * caller is written in. See the dynamic-access invariant below for what
 * this can and cannot see. */
function callerReferences(): Set<string> {
  const tsReferencePattern = /\bapi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g
  const pyReferencePattern = /["']([A-Za-z][A-Za-z0-9_]*):([A-Za-z0-9_]+)["']/g
  const refs = new Set<string>()
  for (const root of USAGE_ROOTS) {
    for (const file of callerFiles(root)) {
      const source = readFileSync(file, "utf8")
      const pattern = file.endsWith(".py") ? pyReferencePattern : tsReferencePattern
      for (const match of source.matchAll(pattern)) {
        refs.add(`${match[1]}.${match[2]}`)
      }
    }
  }
  return refs
}

const exportsByKey = publicExports(CONVEX_DIR)
const references = callerReferences()

describe("every public Convex function has a caller — or an allowlist reason", () => {
  test("test-of-the-test: at least a dozen public exports were scanned", () => {
    // A silent failure would be the walker returning an empty map and every
    // subsequent assertion passing vacuously. The number matters less than
    // that it's plausible — the surface today is in the tens.
    expect(exportsByKey.size).toBeGreaterThan(20)
  })

  test("test-of-the-test: at least a few caller references were found", () => {
    // Same logic on the other side: a walker that found no callers would
    // report every export as unreached.
    expect(references.size).toBeGreaterThan(20)
  })

  test("no unreferenced public export escapes the allowlist", () => {
    const unreferenced = [...exportsByKey.keys()]
      .filter((key) => !references.has(key))
      .filter((key) => !(key in ALLOWLIST))
      .sort()
    // A single assertion (rather than `test.each`) so the failure message
    // names the full set — otherwise a bulk deletion becomes N red tests
    // instead of one that tells the reviewer exactly what to do about them.
    expect({
      unreferenced,
      hint:
        "For each entry above: (a) wire it into app/ or components/ so the check finds a caller, " +
        "(b) delete the export if there is no caller planned, or (c) add it to ALLOWLIST in " +
        "lib/reachability.test.ts with a one-line reason describing who reaches it.",
    }).toEqual({ unreferenced: [], hint: expect.anything() })
  })

  test("no allowlist entry has become a real caller (allowlist rot)", () => {
    // The dual assertion. If a UI caller is added later for a function on
    // the allowlist, the exception should disappear with it — otherwise the
    // allowlist becomes a graveyard that hides the next real unreached
    // function. Fails naming the stale keys so the fix is remove-from-list,
    // not rewrite-the-reason.
    const stale = Object.keys(ALLOWLIST).filter((key) => references.has(key)).sort()
    expect({
      staleAllowlistEntries: stale,
      hint:
        "For each entry above: a static caller now exists, so the 'no static caller' claim in " +
        "ALLOWLIST is no longer true. Remove the entry — the existing static reference is enough " +
        "to keep the check green.",
    }).toEqual({ staleAllowlistEntries: [], hint: expect.anything() })
  })

  test("no allowlist entry names an export that no longer exists", () => {
    // The sibling check to allowlist rot: a rename or deletion leaves the
    // allowlist mentioning a ghost, and the next PR that adds a real
    // unreached function might be silently accepted because someone read
    // the allowlist and assumed everything on it was still exported.
    const ghosts = Object.keys(ALLOWLIST).filter((key) => !exportsByKey.has(key)).sort()
    expect({ ghostAllowlistEntries: ghosts }).toEqual({ ghostAllowlistEntries: [] })
  })

  test("no dynamic api[...] access in the scanned trees — the check would go blind", () => {
    // The regex above matches `api.mod.name` and nothing else. A dynamic
    // access like `api[key].getFoo` or `(api as any).mod.getFoo` reaches
    // real functions without leaving a static reference this test can find,
    // so an unwatched dynamic access would let an unreached export pass —
    // and let a real caller trip the "no unreferenced" check. Refuse the
    // whole shape at test time so the choice is visible to the reviewer.
    const dynamicPattern = /\bapi\s*\[|\(\s*api\s+as\s+any\s*\)|api\?\.\[/
    const offenders: string[] = []
    for (const root of USAGE_ROOTS) {
      for (const file of callerFiles(root)) {
        if (file.endsWith(".py")) continue
        if (dynamicPattern.test(readFileSync(file, "utf8"))) {
          offenders.push(relative(REPO_ROOT, file))
        }
      }
    }
    expect({
      dynamicApiAccess: offenders,
      hint:
        "Dynamic access to the `api` object blinds lib/reachability.test.ts to whichever " +
        "public functions it reaches. Either replace the dynamic access with a static one " +
        "(`api.mps.getMP`), or refactor this test to accept the shape you intended.",
    }).toEqual({ dynamicApiAccess: [], hint: expect.anything() })
  })
})
