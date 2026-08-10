# Website feedback reporting — verification report

**Branch:** `website-feedback-intake`
**Date:** 2026-08-10
**Verified by:** running the feature, not by reading it.

Every claim below is followed by the command that produced it and the output
that came back. Where something was **not** verified, or cannot be done without
a credential this branch does not hold, it says so under
[What is not done here](#what-is-not-done-here) rather than being quietly
omitted.

---

## What was built

A "Problem melden" / "Report a problem" control in the site footer opens a sheet
that collects a report, shows the reporter exactly what will be sent, checks
GitHub for likely duplicates, and files a public issue — with the reporter's
email address and the screenshot deliberately excluded from that issue.

| Layer | File | What it owns |
| --- | --- | --- |
| Privacy rules | `webapp/lib/feedback.ts` | Every sanitizer. The allowlists, the limits, the element describer. |
| Public payload | `webapp/lib/feedback-issue.ts` | The issue title, labels and body. Physically cannot render the private half. |
| Collectors | `webapp/lib/diagnostics.ts` | Errors, failed requests, breadcrumbs. Defined by what it refuses to read. |
| Screenshot | `webapp/lib/screenshot.ts` | DOM clone → redact → rasterise, in that order. |
| Backend | `webapp/convex/feedback.ts` | Public mutation, abuse gate, GitHub action, retention sweep. |
| Schema | `webapp/convex/schema.ts` | `feedbackReports` + the closed `safeDiagnostics` validator. |
| UI | `webapp/components/feedback-widget.tsx` | The four-step flow. |
| Strings | `webapp/lib/i18n.ts` | 74 keys, German and English. |

---

## 1. The four repository gates

Run from a clean worktree, after `bun install` and copying `convex/_generated`.

```
$ pixi run typecheck   → tsc --noEmit, no output (pass)
$ pixi run test        → 1346 pass, 0 fail, 16771 expect() calls, 83 files
$ pixi run lint        → Checked 343 files, 10 warnings
$ pixi run build       → compiled, 25 routes emitted
$ bun run check:codegen → ✓ api.d.ts lists all 29 Convex modules
```

The 10 lint warnings are the **pre-existing** count. Measured directly by
stashing this branch's changes and re-running: baseline `Found 10 warnings`,
with the feature `Found 10 warnings`. This branch adds none.

Test count moved 1268 → 1346, i.e. **78 new tests**.

## 2. The privacy boundary — behavioural tests

`webapp/lib/feedback.test.ts` (34 tests). Every test is a negative: a sentinel
is fed in and asserted absent from the output, because a positive test passes
just as happily when the sanitizer is deleted.

| Vector | Rule asserted |
| --- | --- |
| URL fragment | Dropped entirely and always (`#access_token=…` cannot survive) |
| URL query | Allowlist of six keys; `token`, `code`, `session` dropped |
| URL authority | `https://user:pass@host` credentials stripped by reconstruction |
| URL scheme | `javascript:`, `data:`, `file:` return `null` |
| Error message | Embedded URLs sanitized in place; capped at 300 chars |
| Error stack | Capped at 8 frames; URLs stripped per frame; V8 **and** Firefox shapes |
| Request record | Exactly 5 keys — no body, no headers, by construction |
| Request status | Network failure is `null`, never `0` |
| Element describer | Never reads `aria-label`, `textContent`, `value`, `title`, `alt` |
| Opt-in marker | A `data-feedback-id` carrying interpolated content is rejected |
| Environment | `locale`/`colorScheme`/`timeZone` shape-matched or `"unknown"` |
| `signedIn` | Coerced to boolean — a user id cannot survive as one |

`webapp/lib/feedback-issue.test.ts` (20 tests) covers the GitHub payload; see §4.

`webapp/lib/feedback-boundaries.test.ts` (17 tests) asserts guarantees that are
properties of the *source*, because no function returns them:

- the `safeDiagnostics` validator contains no `v.any()` / `v.record()` / `v.bytes()`
- `lib/diagnostics.ts` contains no `document.cookie`, `localStorage`,
  `sessionStorage`, `init.headers`, `response.body`, `response.json()`,
  `event.key`, `.value`, `textContent`, `aria-label` — with comments stripped
  first, since those modules *document* what they refuse to read
- redaction precedes `drawImage` in `captureScreenshot`
- `getReportForPublication` does not select `contact` or `screenshotId`
- the retention sweep is registered in `convex/crons.ts`
- the sweep deletes the file before the row (no orphaned storage)

## 3. The abuse gate

`webapp/convex/feedback.test.ts` (7 tests) over the pure `rejectionFor`.
Confirmed live against a local Convex backend:

```
honeypot filled  → {"accepted": false, "reason": "honeypot"}
dwellMs: 10      → {"accepted": false, "reason": "too-fast"}
ordinary report  → {"accepted": true, "reportId": "jx7e5…"}
```

## 4. End-to-end, against a real Convex deployment

Run against the cached open-source `convex-local-backend` (no cloud
credentials) with a stub GitHub API on `127.0.0.1:8099`, reached via the
`GITHUB_API_BASE` operator variable.

### 4a. The server re-sanitizes what the validator accepts

A report was submitted whose diagnostics were **valid against the schema** but
hostile in their values — the exact attack a hand-written HTTP request makes,
skipping the browser entirely.

Submitted → stored:

| Field | Sent | Stored |
| --- | --- | --- |
| `pageUrl` | `…/rankings?wp=21&token=SUPERSECRET#hash` | `…/rankings?wp=21` |
| `errors[0].message` | `boom at https://api.example.com/x?token=LEAKED` | `boom at https://api.example.com/x` |
| `errors[0].stack[0]` | `at f (https://a.b/c.js?token=LEAKED:1:1)` | `at f (https://a.b/c.js)` |
| `requests[0].url` | `https://api.example.com/login?token=LEAKED` | `https://api.example.com/login` |
| `requests[0].method` | `EVIL` | `OTHER` |
| `requests[0].status` | `0` | `null` |
| `breadcrumbs[0].target` | `https://x.y/z?token=LEAKED` | `https://x.y/z` |
| `viewport.width` | `1e9` | `20000` |
| `devicePixelRatio` | `999` | `5` |
| `locale` / `colorScheme` / `timeZone` | `NOT-A-LOCALE` / `evil` / `Europe/Berlin; DROP` | `unknown` / `unknown` / `unknown` |

Grep for `LEAKED` across the stored row: **0 occurrences.**

### 4b. The GitHub issue carries no private data

A full report was submitted with a contact address, diagnostics, a secret in
the URL, and mention-spam in the description. The stub recorded the exact HTTP
body:

```
TITLE:  [Website] Bug: Rankings blank on mobile
LABELS: ['via-website', 'bug']
```

Leak probes against the request body:

```
PASS: no CONTACT EMAIL   (private-reporter@example.org absent)
PASS: no URL SECRET      (?secret=NOPE absent — page rendered as ?wp=21)
PASS: no CLIENT KEY      (rate-limit identifier absent)
PASS: no LIVE MENTION    (@joshua-e-fehn defused to @​joshua-e-fehn)
```

The body rendered `| Reply address | provided (stored privately) |` — the
*fact* of an address, never the address.

Meanwhile the private half remains retrievable by an operator:

```
$ bunx convex run feedback:getPrivateReport '{"reportId":"jx7fh…"}'
{ "contact": "private-reporter@example.org",
  "githubIssueUrl": "https://github.com/joshua-e-fehn/Bundestracker/issues/777",
  "status": "published", … }
```

### 4c. Duplicates, retention, retry

```
feedback:findDuplicates  → [{"number":42,"state":"open","title":"Rankings table empty…"}]
feedback:sweepExpiredReports → {"deleted":0,"hasMore":false}   (no-op on fresh rows)
feedback:republishFailed → {"requeued":2}
feedback:isConfigured    → false with no token (kill switch), true once set
```

With the token unset, a submitted report was stored and marked
`status: "failed", failureReason: "github-not-configured"` — queued, not lost,
and nothing posted.

## 5. Browser verification

Playwright + Chromium against `next dev` wired to the local backend.
**21 of 21 checks passed.** Screenshots in `docs/screenshots/feedback/`.

| Check | Result |
| --- | --- |
| Trigger renders in footer (de) | pass |
| Sheet opens; focus moves into the dialog; Escape closes it | pass |
| Review panel lists what will be sent | pass |
| "Never collected" rule shown to the reporter | pass |
| Public/private split stated before submitting | pass |
| Screenshot preview rendered | pass |
| Redaction count surfaced ("2 Bereiche wurden automatisch geschwärzt") | pass |
| Screenshot can be removed | pass |
| Diagnostics can be removed | pass |
| Diagnostics detail inspectable | pass |
| Submit disabled until valid, enabled after | pass |
| Duplicate step appears before filing | pass |
| Confirmation shown after submit | pass |
| No uncaught page errors | pass |
| Localised end to end (en) | pass |
| No horizontal overflow at 390 px and 320 px | pass |

### The decisive image

`docs/screenshots/feedback/13-captured-image-redacted.png` is the **actual
WebP the widget produced**, extracted from the DOM and converted. Before
capture, every `<input>` on the page was filled with `SENSITIVE-TYPED-SECRET`.
In the produced image both fields are solid grey blocks; the page layout is
otherwise faithful, and the report widget itself is absent.

That is the whole redaction claim, verified on real pixels rather than asserted.

---

## Cost

Zero new paid infrastructure and no new npm dependency.

- **Screenshot**: hand-written SVG `foreignObject` → canvas. No `html2canvas`.
- **Storage**: Convex file storage, already in the plan. One ~35 kB WebP per
  report, deleted after 90 days by `sweepExpiredReports`.
- **GitHub**: free API. Issue creation and search are within the authenticated
  rate limits at any plausible volume for this site.
- **Anti-abuse**: no captcha service, so no vendor and no third-party script.
- **Two Convex functions per report** (one mutation, one scheduled action),
  plus a daily cron that is a no-op on most days.

---

## Operator setup — the one genuinely manual step

Publication needs a GitHub token. **This cannot be completed from this branch**:
minting one requires an interactive login as the repository owner, and a token
must never be committed. The `gh` CLI in this environment is authenticated as
`joshua-e-fehn`, but its token is a user PAT that should not be copied into a
Convex deployment as a long-lived publishing credential.

### Step 1 — create a fine-grained PAT

<https://github.com/settings/personal-access-tokens/new>

- **Repository access**: Only select repositories → `joshua-e-fehn/Bundestracker`
- **Permissions**: `Issues: Read and write`. Nothing else.
- **Expiry**: 90 days or less; rotation is the point of a fine-grained token.

A GitHub App installation token is the better long-term answer (no expiry
babysitting, tighter attribution) and the code is compatible with one — it
sends `Authorization: Bearer <token>`, which both accept. It is not required to
ship, so the PAT is the documented path.

### Step 2 — set the deployment variables

```bash
cd webapp
bunx convex env set --prod GITHUB_FEEDBACK_TOKEN "github_pat_…"
bunx convex env set --prod GITHUB_FEEDBACK_REPO  "joshua-e-fehn/Bundestracker"
# GITHUB_API_BASE is optional — unset means api.github.com.
```

Until both are set, `feedback:isConfigured` returns `false` and **the trigger
does not render at all**. Offering a form that queues into a deployment which
will never publish is worse than offering nothing, so the widget hides itself.

### Step 3 — create the labels

`POST /issues` silently **drops** a label that does not exist; it does not
create one and does not error.

```bash
gh label create via-website      --repo joshua-e-fehn/Bundestracker --color 0E8A16 --description "Filed through the website feedback form"
gh label create data-correction  --repo joshua-e-fehn/Bundestracker --color FBCA04 --description "A published figure or record is wrong"
# `bug`, `enhancement` and `question` are GitHub defaults and already exist.
```

### Step 4 — deploy

Deploys are manual for this project. `pixi run build` from `webapp/` with
`CONVEX_DEPLOY_KEY` set deploys Convex and builds the frontend; the Vercel
deploy is separate. Merging to `main` ships nothing on its own.

### Reading a report's private half

```bash
cd webapp
bunx convex run --prod feedback:getPrivateReport '{"reportId":"<id from the issue>"}'
```

Returns the contact address and a short-lived screenshot URL.

### Turning it off

`bunx convex env remove --prod GITHUB_FEEDBACK_TOKEN`. The widget disappears,
and anything already queued stays queued.

---

## What is not done here

Stated plainly rather than left to be discovered.

1. **No GitHub token is set on any deployment.** Steps 1–3 above are manual and
   have not been performed. The feature is inert in production until they are.
2. **Not verified against the real GitHub API.** Every GitHub interaction was
   verified against a local stub, deliberately — the alternative was filing junk
   issues in a public repository. The request shape (path, method, headers,
   body, API version) is pinned by tests, but the first real call will be the
   first real call.
3. **The per-browser rate limit is resettable.** It is keyed on a random
   identifier in `localStorage`, because a Convex mutation cannot see the client
   IP — there is no request object. Clearing storage resets it. This is stated in
   the code rather than papered over. The control that actually bounds a
   determined attacker is the per-deployment cap of 200 reports/24h; the honeypot
   and the 2-second dwell gate stop unsophisticated bots and nothing more. **If
   the form is ever genuinely attacked, the answer is Cloudflare Turnstile** (free
   tier, no per-request cost) validated inside `submitReport` — the rejection
   path is already a pure function with a reason code, so adding one more is a
   small change.
4. **Screenshot fidelity has limits inherent to the technique.** Web fonts do
   not load inside a `foreignObject`, so text renders in a fallback face; all
   images (MP portraits included) become grey placeholder boxes, which is both a
   limitation and, here, the desired privacy behaviour. Cross-origin images are
   never drawn, so the canvas cannot be tainted.
5. **`?q=` — the search term — is deliberately kept** in the sanitized URL. It
   is the one judgement call in `ALLOWED_QUERY_KEYS`: it is text a reader typed.
   The reasoning is in the code — on this site the search box takes a
   politician's name, a topic or a profession, a failing search is the single
   most likely thing to be reported, and the site has no free-text field that has
   ever held a credential. **If such a field is ever added, it must not be added
   to that list.**
6. **Retention is 90 days**, enforced by a daily cron. It has been executed
   (returning `{deleted: 0}` on fresh rows) but not observed deleting a real
   expired row, which would require waiting 90 days or backdating a row.
