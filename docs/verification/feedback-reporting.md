# Website feedback reporting — verification report

**Branch:** `website-feedback-intake`
**Date:** 2026-08-10 (revised after independent review)
**Verified by:** running the feature, not by reading it.

Every claim below is followed by the command that produced it and the output
that came back. Where something was **not** verified, or cannot be done without
a credential this branch does not hold, it says so under
[What is not done here](#what-is-not-done-here) rather than being quietly
omitted.

> [!IMPORTANT]
> **An earlier revision of this document overstated one result, and the mistake
> is worth recording rather than editing away.**
>
> §5 called `13-captured-image-redacted.png` "the whole redaction claim, verified
> on real pixels". It was not. That test filled only `<input>` elements — and
> form controls are saved by `assertFormControlsRedacted`, a **separate**
> backstop that removes any control lacking `data-redacted`. So the image proved
> the backstop worked and said nothing about the redaction walk itself, which
> was broken: a live `TreeWalker` advanced while the clone was being mutated
> desynchronised from the first redaction onward, and the **account surfaces —
> which have no backstop — were never covered**. A signed-in reader's name and
> email address would have entered the stored image, while the reporter's own
> preview and the "2 Bereiche wurden automatisch geschwärzt" counter both read
> as confirmation.
>
> The lesson generalises: a test that exercises a path protected by a *different*
> mechanism proves nothing about the mechanism under test. §2 and §5 now assert
> coverage of *specific nodes*, and §5b photographs the case that has no
> backstop. See [What is not done here](#what-is-not-done-here) item 7.

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
$ pixi run test        → 1402 pass, 0 fail, 16925 expect() calls, 84 files
$ pixi run lint        → Checked 344 files, 10 warnings
$ pixi run build       → compiled, 25 routes emitted
$ bun run check:codegen → ✓ api.d.ts lists all 29 Convex modules
```

The 10 lint warnings are the **pre-existing** count. Measured directly by
stashing this branch's changes and re-running: baseline `Found 10 warnings`,
with the feature `Found 10 warnings`. This branch adds none.

Test count moved 1268 → 1402, i.e. **134 new tests** — 78 in the original pass,
41 for the first review, 15 for the second.

## 2. The privacy boundary — behavioural tests

`webapp/lib/feedback.test.ts` (46 tests). Every test is a negative: a sentinel
is fed in and asserted absent from the output, because a positive test passes
just as happily when the sanitizer is deleted.

| Vector | Rule asserted |
| --- | --- |
| URL fragment | Dropped entirely and always (`#access_token=…` cannot survive) |
| URL query (first-party) | Allowlist of six keys; `token`, `code`, `session` dropped |
| **URL path (foreign)** | **Reduced to origin — a secret in any path position cannot survive** |
| **URL query (foreign)** | **The first-party allowlist does not apply; `?q=` is not kept** |
| **Origin confusion** | **`localhost.evil.com` is foreign, not localhost** |
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

`webapp/lib/feedback-issue.test.ts` (30 tests) covers the GitHub payload; see
§4. Six of them are Markdown-injection tests over a report whose `userAgent`,
`error.message`, `error.stack`, `request.url` and `breadcrumb.target` each carry
a fence, a pipe, a newline and a `> [!NOTE]`. They assert exactly one banner is
*rendered*, that no forged block marker reaches column zero, and that no payload
can close the fence containing it. **All six fail against the pre-fix renderer**,
which protected only the title and description.

`webapp/lib/screenshot.test.ts` (9 tests) is the behavioural counterpart to the
redaction walk, against a hand-built tree shaped like the real page — a
`happy-dom` dependency would be large for one traversal, and the bug was in the
ordering rather than in the DOM API. **7 of the 9 fail against the pre-fix
algorithm**, replayed as a faithful live `TreeWalker`.

`webapp/lib/feedback-boundaries.test.ts` (37 tests) asserts guarantees that are
properties of the *source*, because no function returns them:

- the `safeDiagnostics` validator contains no `v.any()` / `v.record()` / `v.bytes()`
- `lib/diagnostics.ts` contains no `document.cookie`, `localStorage`,
  `sessionStorage`, `init.headers`, `response.body`, `response.json()`,
  `event.key`, `.value`, `textContent`, `aria-label` — with comments stripped
  first, since those modules *document* what they refuse to read
- no `createTreeWalker` survives in `lib/screenshot.ts` (the desync pattern)
- the screenshot ceiling is `LIMITS.screenshotBytes`, not a duplicated literal
- `getReportForPublication` does not select `contact` or `screenshotId`
- minting an upload writes a row the orphan sweep can find; the mint gate counts
  mints rather than reports; the size ceiling is enforced against stored metadata
- the mint returns its row id, and `bindUpload` distrusts it — an already-claimed
  or already-bound row is not re-bound (the binding is exact, not a guess)
- report retention deletes the claimed upload row, in file → record → row order
- `findDuplicates` **charges** the budget before reaching GitHub, and that budget
  counts `feedbackSearches` rows rather than reports
- `claimSearchBudget` is a mutation, because counting a search means recording it
- search records are reaped rather than accumulating forever
- `publishReport` searches for an existing issue before re-POSTing on a retry
- `recordPublication` cannot overwrite `duplicateCandidates`
- all three sweeps delete the file before the row (no orphaned storage)

⚠ These are source assertions and they are the weaker kind. Where the review
found one standing in for a behavioural test that *was* available — redaction
coverage — the behavioural test now exists (`screenshot.test.ts`) and the source
assertion was kept only as a guard against the pattern reappearing.

## 3. The abuse gate

`webapp/convex/feedback.test.ts` (12 tests) over the pure `rejectionFor`,
`persistsRejection` and `consumesDeploymentQuota`. The last two exist because
the original suite tested the *rule* while the defect was in its **caller** —
each rejection inserted a row that the deployment counter then counted, so being
refused made the next refusal more likely. That invariant is now stated as two
pure functions and asserted directly, and confirmed live in §5c.

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

### Images

`13-captured-image-redacted.png` is the **actual WebP the widget produced**,
after every `<input>` on the page was filled with `SENSITIVE-TYPED-SECRET`. Both
fields are solid grey blocks and the layout is otherwise faithful.

⚠ That image is **not** the whole redaction claim — see the note at the top of
this document. Form controls are covered by a second, independent backstop, so
this photograph could not have failed even while the redaction walk was broken.
The case that actually tests the walk is below.

## 5b. Redaction of the surfaces that have no backstop

The check the earlier revision never ran, and the one that would have caught the
P0.

A `[data-feedback-account]` region carrying a display name, a second one
carrying a name **and an email address** mounted last in `<body>` inside a portal
wrapper (as Radix mounts the real account menu), and a `[data-feedback-redact]`
region were injected into a live page, alongside the page's own filled inputs.
The widget was opened and the WebP it produced was extracted from the DOM.

```
redaction caption: 5 Bereiche wurden automatisch geschwärzt.
PASS a screenshot was produced
PASS account/marked regions exist on the live page — 3 found
PASS every sensitive region was redacted — reported 5, expected >= 3
live page still intact (INNOCENT present): True
live page still holds account name       : True
```

`15-captured-account-redaction.png` is that image. All five regions are solid
grey blocks — the account trigger at the top, the marked region and the account
menu at the bottom, and both search inputs. **No sentinel text appears
anywhere.** The last two lines confirm the live DOM was never mutated: redaction
happens on the detached clone, so the page the reader is looking at is untouched.

Replayed against the pre-fix algorithm (a faithful live-`TreeWalker` model, in
`lib/screenshot.test.ts`), the same tree yields `account menu redacted? false`
with the name and email intact, and an innocent sibling blacked out in their
place. 7 of the 9 tests in that file fail against it.

## 5c. Abuse and lifecycle, against a live backend

Each of these ran against the local Convex deployment and is the *behavioural*
counterpart to a source-level assertion.

**A rejection flood no longer closes the form.** 220 forged submissions carrying
`honeypot: "spam"`, each from a distinct `clientKey`, then one genuine report
from a fresh browser:

```
=== 220 forged rejections sent ===
{"accepted":true,"reportId":"jx7dm428tz74cztvp9z8p781718c607e"}

rows written by the whole exercise:
{ "byStatus": { "published": 1 }, "total": 1 }
```

Zero rows from 220 forged rejections, and the genuine reporter is served. Before
the fix this wrote 220 counted rows and refused every real report for 24 hours.

**An abandoned upload is now reclaimed.** A URL was minted, a file uploaded, and
no report filed — the orphan case:

```
feedbackUploads row: { storageId: null, claimed: false, clientKey: "orphan-maker" }
after backdating past the TTL and running the sweep:
  sweepOrphanedUploads → { "deleted": 1, "hasMore": false }
  storage: { files: 0, uploadRows: 0 }
```

Before the fix that file was unreachable from any query and was never deleted by
anything, ever.

**An oversized screenshot is refused server-side.** A 3 MB file was uploaded
directly to a minted URL and named in a submission:

```
attaching storageId=kg2ansrk… size=3000000
{"accepted":true,"reportId":"jx7fhvap…"}
report row → screenshotId: null      storage → storedFiles: 0
```

The report is accepted without the picture; the file is deleted. The ceiling was
previously enforced only in the browser, against a duplicated literal.

**A retry after a lost response files no duplicate.** A published report was
marked `failed` (what a dropped response produces) and re-queued:

```
republishFailed → { "requeued": 1 }
  searches performed : 2
  NEW issue POSTs    : 0
row → { status: "published", url: ".../issues/777" }
```

**The published body survives an injection attempt.** A report whose
`userAgent`, `error.message`, `error.stack`, `request.url` and
`breadcrumb.target` each carried ``` ``` ```, `|`, a newline and `> [!NOTE]`,
with a secret in a third-party URL path:

```
rendered '> [!NOTE]' at line start : 1
forged banner at column zero       : False
PATHSECRET present (foreign path)  : False
contact email present              : False
   - on `https://api.evil.com/…`
   | +0.1s | `POST` | 500 | 10 ms | `https://api.evil.com/…` |
```

**`duplicateCandidates` survives publication.** `[42, 43]` sent with a report
were still on the row after it published — the column was previously emptied by
`recordPublication` on every write.

## 5d. The second review pass

Four further items, each verified against the live backend rather than by
reading.

**The first-party check now works in the runtime that matters.** With only
`SITE_URL` set — exactly the Convex deployment's configuration — a report
carrying a first-party URL, a first-party URL inside an error message, and a
third-party URL with a path secret:

```
| Page | `https://bundestracker.de/rankings?wp=20&metric=speeches` |
- **+0.0s** — `Cannot load https://bundestracker.de/api/mps/bt-0007 in list`
  - on `https://bundestracker.de/mps/bt-0007`
| +0.0s | `GET` | 500 | 1 ms | `https://api.evil.com/…` |

first-party path preserved server-side : True
first-party path in error text         : True
token still stripped                   : True
fragment still dropped                 : True
foreign path still reduced             : True
```

The reproduction survives and nothing that should be stripped is kept. Two tests
in `lib/feedback.test.ts` fail against the single-variable version.

**The duplicate search is bounded on searches.** The gate previously counted
*reports*, which a search does not create — so a caller rotating `clientKey` was
never bounded, and a quiet deployment's total was permanently zero.
`claimSearchBudget` records each search before the outbound call:

```
searches recorded after 60 rotating-key calls : 60 rows, 60 distinct keys
served from a single key                      : 30 / 40   (client cap 30)
rotating-key calls served past the cap        : 10 / 30   (1990 + 10 = 2000)
total rows                                    : 2000      (hard ceiling)
outbound GitHub calls the mock saw            : 100       (only the served ones)
```

Key rotation no longer defeats the bound, and a refused search never reaches
GitHub.

**An upload is bound to its file exactly, not guessed.** `generateUploadUrl`
returns its own row id and the client hands it back at submission:

```
mint returned uploadId : k57ck2ns0e6ahnqpyp9yw87a3s8c79zb
uploaded storageId     : kg25a2cyw96j4599a29s9b4hhn8c6zsd
upload row  → { claimed: true, storageId: "kg25a2cyw96j4599a29s9b4hhn8c6zsd" }
report row  → screenshotId: "kg25a2cyw96j4599a29s9b4hhn8c6zsd"
```

The previous version looked up by `storageId` and fell back to "the newest
unclaimed row" — but a mint row never carries the id on a first claim, so the
fallback was the *only* path that ever ran while the comment called it the rare
branch.

**A claimed upload row dies with its report.** Retention previously deleted the
file and the report and left the mint row forever, one per screenshot ever
uploaded:

```
before sweep : reports 2, uploadRows 1, files 1
after  sweep : reports 0, uploadRows 0, files 0
```

**Browser checks re-run: 21/21, plus the account-redaction check 3/3.** One
transient failure during this pass was the duplicate-check step returning
nothing — caused by the 2000-row search budget this very section had just
exhausted. That is the designed degradation (a refused search returns `[]` and
the reporter files as normal); it passed once the budget was cleared.

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

# Already set for Better Auth. Verify it, because the feedback feature now
# reads it too:
bunx convex env get --prod SITE_URL      # → https://bundestracker.de
```

Until the first two are set, `feedback:isConfigured` returns `false` and **the
trigger does not render at all**. Offering a form that queues into a deployment
which will never publish is worse than offering nothing, so the widget hides
itself.

> [!IMPORTANT]
> **`SITE_URL` must name the real deployed origin, or every report loses its
> page path.**
>
> `sanitizeUrl` keeps the path and the allowlisted query for *this app's* URLs
> and reduces a foreign URL to its origin. It decides which is which from
> `NEXT_PUBLIC_SITE_URL` (the browser's build-time variable) **or** `SITE_URL`
> (the one the Convex deployment carries, for Better Auth).
>
> Both are consulted because `sanitizeUrl` runs in both runtimes — the server
> deliberately re-sanitizes what the browser sent. Reading only the Next.js
> variable meant the server, which does not have it, classified the app's own
> URL as foreign and stored `https://bundestracker.de/…` for every report. It
> failed safe and silently, and cost exactly what `ALLOWED_QUERY_KEYS` calls the
> difference between a reproduction and no reproduction. With neither variable
> set, everything is treated as foreign — over-redaction, never a leak.

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
   expired *report*, which would require waiting 90 days. The **orphan-upload**
   sweep beside it *was* observed deleting a real row and its file, by
   backdating the row past its one-hour TTL (§5c).
7. **The first revision of this document asserted a guarantee it had not
   tested.** Recorded at the top rather than silently corrected. The specific
   failure — photographing a path protected by a different mechanism than the
   one under test — is the reason §5b exists and the reason the redaction tests
   now assert coverage of named nodes instead of "the function ran".
8. **Foreign URLs keep only their origin**, so a third-party path is no longer
   published. That is a deliberate loss of diagnostic detail: a maintainer sees
   `https://api.example.com/…` and not which endpoint failed. The alternative
   was publishing path segments from servers whose URL conventions this project
   does not control, where a session token or reset nonce in a path is ordinary.
9. **The anti-abuse controls remain resettable per browser.** Unchanged by this
   pass and still the honest summary in item 3 — what changed is that being
   *refused* can no longer inflate the deployment counter, which had turned the
   strongest control into the cheapest attack.
10. **A saturated deployment still writes one `rejected` row per refused
    submission.** Reaching saturation now costs 200 *accepted* reports (each
    filing a real public issue) rather than 200 free POSTs, and the rows carry no
    text — so this is strictly weaker than the original defect, but the "no
    ceiling on inserts" property is reduced rather than eliminated. Bounded in
    practice by the 90-day sweep.
11. **`SITE_URL` is now load-bearing for report quality, not only for auth.** If
    it is ever changed to something other than the deployed origin, every report
    silently loses its page path — the same failure the first-party fix closed,
    reintroduced by configuration rather than by code. The Step 2 note says so;
    there is no runtime assertion, because the value that would prove it correct
    is the one being checked.
12. **`feedbackSearches` grows with search volume** and is reaped two days
    after the 24-hour counting window. That reaper has been executed
    (`{deleted: 0}` on fresh rows) but not observed deleting a genuinely aged
    row, which would need a backdated timestamp or a two-day wait.
