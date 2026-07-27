# Task — fix-search-i18n

URGENT FIX: Vercel build fails because the search page (webapp/app/search/page.tsx) references i18n keys like 'search.title' and 'search.subtitle' that don't exist in webapp/lib/i18n.ts.

Fix: Add ALL missing search-related i18n keys to webapp/lib/i18n.ts in both German and English. Check webapp/app/search/page.tsx for all t() calls and ensure every key exists.

Also run 'cd webapp && bun run typecheck' to find any other missing keys or type errors and fix them all.

Then deploy: cd webapp && VERCEL_TOKEN=<redacted — see /opt/data/.env> vercel --prod

Commit and push. Do NOT wait for input.
