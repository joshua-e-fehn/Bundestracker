#!/usr/bin/env bash
# Runs its arguments with the two public Convex URLs `next build` needs, filling
# in a placeholder pair *only* for a build that is going nowhere.
#
#   bash scripts/build-env-defaults.sh next build
#
# ## The matrix, which is the whole contract
#
# | `NEXT_PUBLIC_CONVEX_URL` / `…_SITE_URL` | deploying? | result |
# |---|---|---|
# | both set        | either | pass through untouched |
# | **exactly one** | either | **exit 1** — never substitute |
# | neither set     | yes    | **exit 1** — a shipped build must name its backend |
# | neither set     | no     | placeholder pair; compile check only |
#
# "Deploying" means `CONVEX_DEPLOY_KEY`, `VERCEL` or `VERCEL_ENV` is set.
#
# Only the last row substitutes anything. Every other row either leaves the
# environment exactly as it found it or refuses to run — so the placeholder can
# only ever reach a build whose output nobody will serve.
#
# ## Why a build needs them at all
#
# `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` are read at module
# load by lib/auth-server.ts, which `next build` imports while collecting page
# data. `lib/convex-url.ts` validates them there and throws if either is absent,
# malformed, or names a different deployment from the other. That check is
# deliberate and load-bearing: a build compiled against the wrong deployment
# does not crash, it *lies* — every query succeeds and returns empty, so a real
# ballot renders "Diese Abstimmung existiert nicht". Nothing here weakens it;
# the guard still runs, still on every build, with the same rules.
#
# So `bun run build` fails outright without the pair. On Vercel that is exactly
# right — a production build that cannot name its backend must not ship. But it
# also means a plain `pixi run build` fails in a clean checkout, which left the
# repo's own build gate unrunnable by anyone who had not first configured a
# Convex deployment. CI is precisely that reader, and this is the gap that made
# the CI workflow fail its own verification.
#
# ## The one property that matters: a real value always wins
#
# No configured value is ever replaced. Vercel sets these from its dashboard,
# and a script that clobbered them would compile production against a
# placeholder — the silent wrong-deployment failure lib/convex-url.ts exists to
# prevent, caused by the file meant to help it.
#
# The first version of this script held that property for a *complete* pair but
# broke it for a half-configured one: it filled in both URLs whenever either was
# missing, on a "both or neither" argument about not handing `requireConvexUrls`
# a mismatched pair. Code review (PR #50, F1) found the hole, and it was the
# serious one — with `CONVEX_DEPLOY_KEY` set and one URL missing, Convex would
# deploy to the *real* backend while the frontend compiled against a deployment
# that does not exist. Loud failure became a successful, broken deploy.
#
# So the rule is narrower now: substitute only when there is nothing to discard
# (neither URL set) *and* nothing to break (not a deploying build). A
# half-configured pair is a mistake to report, not a state to paper over —
# someone who set one variable is configuring a real deployment and mistyped the
# other, and silently throwing their value away is the least helpful response
# available.
#
# An `exec` wrapper rather than something to `source`: the variables have to
# reach the child process and nothing else, and `exec` makes that structural.
# Sourcing would leak them into the caller's shell, where they would go on
# quietly applying to the next command someone ran.
#
# `pixi.toml`'s `[tasks.*.env]` cannot express this. Pixi's task env *overrides*
# the ambient value rather than defaulting to it (measured: a task env of
# `MYVAR = "default"` beats `MYVAR=from-shell pixi run …`), and it does not
# expand `${VAR:-default}` — the literal string is passed through. Either way a
# real deployment URL would be replaced by a placeholder.
#
# ## Why this placeholder is safe
#
# `placeholder-build-check-000` is not a Convex deployment. The name states its
# purpose, and Convex mints names as `adjective-animal-NNN` from a fixed word
# list, so this cannot collide with a real deployment now or later. It is never
# contacted either: `next build` renders no page against live data here — every
# route in this app is dynamic (`ƒ` in the build output), and the only
# prerendered outputs are two icons. The value's whole job is to be a
# well-formed *pair* that satisfies the guard so the compile can be exercised.
#
# It is a public value by construction — `NEXT_PUBLIC_*` is inlined into the
# browser bundle — so there is no secret here to leak, and none is read.
# `CONVEX_DEPLOY_KEY` is *tested for* and never read; the OAuth pairs and
# `PIPELINE_API_KEY` are untouched and unmentioned. webapp/.env.example says
# where those live.
#
# ## What a placeholder build is, and is not
#
# It is the full production compile: type checking, bundling, route collection,
# every page's module graph loaded and validated. It is *not* a build that can
# serve data, and the matrix above is what keeps those two facts from being
# confused: a placeholder build cannot happen where a deploy could follow it.
# It announces itself in the build log rather than being applied silently, so
# nobody reads a green compile as a working site.
#
# That announcement goes to stderr: this wraps an arbitrary command, and a
# progress line on stdout would land in the middle of whatever the wrapped
# command is producing. `next build` does not care, but a caller that parses the
# child's output would, and the convention costs nothing here.
set -euo pipefail

PLACEHOLDER_DEPLOYMENT="placeholder-build-check-000"

cloud_set=false
site_set=false
[ -n "${NEXT_PUBLIC_CONVEX_URL:-}" ] && cloud_set=true
[ -n "${NEXT_PUBLIC_CONVEX_SITE_URL:-}" ] && site_set=true

# Whether this build's output is going somewhere real. Any one of these is
# enough — they are independent signals and a placeholder is wrong under all of
# them, so the check is a disjunction rather than a guess at which is canonical.
#
#   CONVEX_DEPLOY_KEY  scripts/convex-deploy-if-key.sh has already deployed the
#                      backend by the time this runs. A frontend compiled
#                      against a placeholder would then be shipped *alongside* a
#                      real deployment — the worst case in the matrix.
#   VERCEL             set to "1" on every Vercel build, preview included. A
#                      preview that silently serves no data is still a broken
#                      preview, and previews are what reviewers look at.
#   VERCEL_ENV         production/preview/development. Checked as well as VERCEL
#                      so an environment that forwards only this one still trips.
deploying=false
if [ -n "${CONVEX_DEPLOY_KEY:-}" ] || [ -n "${VERCEL:-}" ] || [ -n "${VERCEL_ENV:-}" ]; then
  deploying=true
fi

if [ "$cloud_set" = true ] && [ "$site_set" = true ]; then
  echo "▸ Convex URLs set — building against the configured deployment" >&2

elif [ "$cloud_set" = true ] || [ "$site_set" = true ]; then
  # Exactly one half. Never substitute here, in any context.
  #
  # This used to fill in *both* — "both or neither", to avoid handing
  # `requireConvexUrls` a mismatched pair and getting its "different Convex
  # deployments" error for what is really a half-configured environment. That
  # reasoning was wrong in the direction that matters: it replaced a **real**
  # URL somebody had deliberately set, and it turned a loud failure into a
  # successful build. Someone who set one variable is configuring a real
  # deployment and mistyped or forgot the other; the honest answer is to say so
  # and stop, not to quietly discard their value.
  missing="NEXT_PUBLIC_CONVEX_SITE_URL"
  present="NEXT_PUBLIC_CONVEX_URL"
  [ "$cloud_set" = true ] || { missing="NEXT_PUBLIC_CONVEX_URL"; present="NEXT_PUBLIC_CONVEX_SITE_URL"; }
  echo "✖ ${present} is set but ${missing} is not." >&2
  echo "  Both are required and must name the same Convex deployment." >&2
  echo "  Refusing to substitute a placeholder: that would discard the value you set" >&2
  echo "  and compile this build against a deployment that does not exist." >&2
  echo "  Set ${missing}, or unset ${present} for a credential-free compile check." >&2
  exit 1

elif [ "$deploying" = true ]; then
  # Neither is set, but this build is going somewhere. A placeholder would
  # produce exactly the failure lib/convex-url.ts exists to prevent — a site
  # that loads, answers every query with nothing, and tells readers a real
  # ballot does not exist — except shipped rather than caught.
  reason="CONVEX_DEPLOY_KEY is set"
  [ -n "${CONVEX_DEPLOY_KEY:-}" ] || reason="this is a Vercel build (VERCEL/VERCEL_ENV set)"
  echo "✖ No Convex URLs set, but ${reason}." >&2
  echo "  A deploying build must name its backend: the placeholder is a compile" >&2
  echo "  check only, and shipping it would serve a site where every query returns" >&2
  echo "  nothing and real ballots render as \"does not exist\"." >&2
  echo "  Set NEXT_PUBLIC_CONVEX_URL and NEXT_PUBLIC_CONVEX_SITE_URL." >&2
  exit 1

else
  export NEXT_PUBLIC_CONVEX_URL="https://${PLACEHOLDER_DEPLOYMENT}.convex.cloud"
  export NEXT_PUBLIC_CONVEX_SITE_URL="https://${PLACEHOLDER_DEPLOYMENT}.convex.site"
  echo "▸ No Convex URLs set — building against ${PLACEHOLDER_DEPLOYMENT}" \
    "(compile check only; this build cannot serve data)" >&2
fi

# `NEXT_PUBLIC_SITE_URL` is where the app is served from — used by
# next.config.ts for the /api/auth rewrite and by the auth client. Unlike the
# pair above it has no validator, and .env.example already documents localhost
# as its development value, so the same default is the honest one for a build
# that is not being deployed anywhere.
: "${NEXT_PUBLIC_SITE_URL:=http://localhost:3000}"
export NEXT_PUBLIC_SITE_URL

exec "$@"
