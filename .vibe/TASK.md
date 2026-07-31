# Make MP contact details visible and honest (GAP-002, GAP-003)

Read `docs/implementation-gap-audit-2026-07-29.md` and inspect the current MP profile implementation and existing design system. Implement the user-facing contact-quality fixes only; do not change the Python pipeline or production data.

Acceptance criteria:
- When populated, the Kontakt/Contact surface is visible near the top of an MP profile rather than ~1.5 viewports down. Target heading offset <800px on desktop 1440x900 and mobile 390x844.
- Add a clear contact affordance/anchor in the profile header if appropriate to the existing visual language.
- When official source contact data is absent/null, render an honest bilingual empty state explaining that Bundestag does not publish direct email/phone and provide any valid official substitute available from existing fields; never silently hide the entire contact surface.
- Preserve rendering of contact form, homepage, Berlin/constituency offices, and all social links when data exists.
- Do not invent email addresses, phone numbers, or external social URLs.
- Add/update tests for populated and absent contact states.
- Verify responsive behavior in a browser at desktop and mobile widths using representative fixtures/local data. Check console errors and links.
- Write `/tmp/contact-profile-visibility-report.md` with screenshots/measurements or exact browser evidence.
- Commit all changes. Do not push, deploy, or open a PR. Stop idle with the commit SHA.

Avoid unrelated redesign. Do not ask questions; proceed autonomously.