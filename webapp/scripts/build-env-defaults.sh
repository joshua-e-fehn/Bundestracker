#!/usr/bin/env bash
# Runs its arguments with the two public Convex URLs `next build` needs, filling
# them in *only* when nothing else has.
#
#   bash scripts/build-env-defaults.sh next build
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
# Each variable is set only if unset or empty. An override would be the actual
# danger, because Vercel sets these from its dashboard and a script that
# clobbered them would compile production against a placeholder — the silent
# wrong-deployment failure lib/convex-url.ts exists to prevent, caused by the
# file meant to help it.
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
# browser bundle — so there is no secret here to leak, and none is read. The
# real secrets (`CONVEX_DEPLOY_KEY`, the OAuth pairs, `PIPELINE_API_KEY`) are
# untouched and unmentioned; webapp/.env.example says where they live.
#
# ## What a placeholder build is, and is not
#
# It is the full production compile: type checking, bundling, route collection,
# every page's module graph loaded and validated. It is *not* a build that can
# serve data — together with no `CONVEX_DEPLOY_KEY` (see
# scripts/convex-deploy-if-key.sh) it is precisely a Vercel **preview** build
# whose backend happens to be unreachable. That is the right thing for CI to
# assert and the wrong thing to deploy, which is why it announces itself in the
# build log instead of being applied silently.
#
# That announcement goes to stderr: this wraps an arbitrary command, and a
# progress line on stdout would land in the middle of whatever the wrapped
# command is producing. `next build` does not care, but a caller that parses the
# child's output would, and the convention costs nothing here.
set -euo pipefail

PLACEHOLDER_DEPLOYMENT="placeholder-build-check-000"

if [ -z "${NEXT_PUBLIC_CONVEX_URL:-}" ] || [ -z "${NEXT_PUBLIC_CONVEX_SITE_URL:-}" ]; then
  # Both or neither. Filling in only the missing half could pair a real URL with
  # a placeholder, which `requireConvexUrls` rejects as "different Convex
  # deployments" — a baffling error for a half-configured environment, where the
  # honest report is that this build is not talking to a real backend at all.
  export NEXT_PUBLIC_CONVEX_URL="https://${PLACEHOLDER_DEPLOYMENT}.convex.cloud"
  export NEXT_PUBLIC_CONVEX_SITE_URL="https://${PLACEHOLDER_DEPLOYMENT}.convex.site"
  echo "▸ No Convex URLs set — building against ${PLACEHOLDER_DEPLOYMENT}" \
    "(compile check only; this build cannot serve data)" >&2
else
  echo "▸ Convex URLs set — building against the configured deployment" >&2
fi

# `NEXT_PUBLIC_SITE_URL` is where the app is served from — used by
# next.config.ts for the /api/auth rewrite and by the auth client. Unlike the
# pair above it has no validator, and .env.example already documents localhost
# as its development value, so the same default is the honest one for a build
# that is not being deployed anywhere.
: "${NEXT_PUBLIC_SITE_URL:=http://localhost:3000}"
export NEXT_PUBLIC_SITE_URL

exec "$@"
