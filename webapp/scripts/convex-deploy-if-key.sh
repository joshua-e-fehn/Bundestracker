#!/usr/bin/env bash
# Skip Convex deploy when no CONVEX_DEPLOY_KEY is set (Vercel preview builds).
# Production builds set CONVEX_DEPLOY_KEY and will deploy normally.
# Use `bun run build:full` to force convex deploy locally.
set -euo pipefail

if [ -n "${CONVEX_DEPLOY_KEY:-}" ]; then
  echo "▸ CONVEX_DEPLOY_KEY found — deploying Convex…"
  bunx convex deploy
else
  echo "▸ No CONVEX_DEPLOY_KEY — skipping Convex deploy (preview build)"
fi
