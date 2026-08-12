# Website feedback reporting — verification report

**Branch:** `website-feedback-intake`, then `feedback-auth-gate`
**Date:** 2026-08-10; revised 2026-08-12 for the sign-in gate and GitHub App
**Verified by:** running the feature, not by reading it.

> [!IMPORTANT]
> **What changed on 2026-08-12, and what it means for everything below.**
>
> Two things, both of which alter statements made further down:
>
> 1. **Reporting is signed-in only.** `submitReport`,
>    `generateScreenshotUploadUrl` and `findDuplicates` each call `requireUserId`
>    as their first statement. Sections below describing the intake as "the only
>    unauthenticated public mutation in the codebase" describe the *previous*
>    design; the abuse controls they document are all still present and
>    unchanged, because a session bounds *who* and never *how much*.
> 2. **Publication authenticates as a GitHub App.** A fine-grained PAT still
>    works and is now the fallback. See
>    [Operator setup](#operator-setup--the-one-genuinely-manual-step).
>
> A third addition is procedural rather than behavioural:
> [Live production acceptance](#live-production-acceptance) is the runbook for
> checking this against the real deployment, which nothing in this document's
> original verification could do.

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

A "Problem melden" / "Report a problem" control — in the sidebar, the mobile
drawer and the footer — opens a sheet that collects a report, shows the reporter
exactly what will be sent, checks GitHub for likely duplicates, and files a
public issue as a GitHub App, with the reporter's email address and the
screenshot deliberately excluded from that issue.

It is offered only to a signed-in reader on a deployment that can publish, and
that is enforced in each handler rather than by hiding the control.

| Layer | File | What it owns |
| --- | --- | --- |
| Privacy rules | `webapp/lib/feedback.ts` | Every sanitizer. The allowlists, the limits, the element describer. |
| Public payload | `webapp/lib/feedback-issue.ts` | The issue title, labels and body. Physically cannot render the private half. |
| Collectors | `webapp/lib/diagnostics.ts` | Errors, failed requests, breadcrumbs. Defined by what it refuses to read. |
| Screenshot | `webapp/lib/screenshot.ts` | DOM clone → redact → rasterise, in that order. |
| Backend | `webapp/convex/feedback.ts` | Public functions, the session gate, abuse gate, GitHub action, retention sweep. |
| Credentials | `webapp/lib/github-app.ts` | PEM parsing and the RS256 app JWT. Pure; reads no environment. |
| Token | `webapp/convex/lib/github-token.ts` | Installation-token minting, caching and refresh. The only reader of the key. |
| Schema | `webapp/convex/schema.ts` | `feedbackReports` + the closed `safeDiagnostics` validator. |
| UI | `webapp/components/feedback-widget.tsx` | The four-step flow. |
| Eligibility | `webapp/components/use-feedback-available.ts` | The one rule all three controls render from. |
| Sheet state | `webapp/components/providers/feedback-provider.tsx` | One sheet, three controls that open it. |
| Strings | `webapp/lib/i18n.ts` | 75 keys, German and English. |

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

Publication needs a GitHub credential. **This cannot be completed from a
branch**: creating one requires an interactive login as the repository owner,
and it must never be committed.

Two modes are supported. **A GitHub App is the preferred production mode**; the
fine-grained PAT is a fallback, kept so an existing configuration does not break
during the change that introduces its replacement.

| | GitHub App *(preferred)* | Fine-grained PAT *(fallback)* |
|---|---|---|
| Stored secret | a private key | a token |
| On the wire | an installation token, expiring in 1 h | the token itself |
| Expiry work | none — minted on demand | rotate every ≤90 days, by hand |
| Issue author | the App (a bot account) | whoever minted the token |

### Step 1 — create a GitHub App

<https://github.com/settings/apps/new> — or reuse an existing App.

- **Repository permissions**: `Issues: Read and write`, `Metadata: Read only`.
  Nothing else. It never reads code and never pushes.
- **Where can this app be installed?** Only on this account.
- Uncheck **Webhook → Active**; nothing here receives webhooks.

Then **Install** it on `joshua-e-fehn/Bundestracker` only, and **generate a
private key** (Settings → the App → Private keys → Generate). GitHub downloads a
PKCS#1 `.pem` — the `-----BEGIN RSA PRIVATE KEY-----` kind — and shows it once.

Three values come out of this:

- **App ID** — on the App's settings page.
- **Installation ID** — the number at the end of the URL after installing:
  `https://github.com/settings/installations/<INSTALLATION_ID>`.
- **The private key** — the downloaded `.pem`.

### Step 2 — set the deployment variables

```bash
cd webapp
bunx convex env set --prod GITHUB_APP_ID              "<numeric app id>"
bunx convex env set --prod GITHUB_APP_INSTALLATION_ID "<numeric installation id>"
bunx convex env set --prod GITHUB_APP_PRIVATE_KEY     "$(cat ~/Downloads/…private-key.pem)"
bunx convex env set --prod GITHUB_FEEDBACK_REPO       "joshua-e-fehn/Bundestracker"
# GITHUB_API_BASE is optional — unset means api.github.com.

# Already set for Better Auth. Verify it, because the feedback feature now
# reads it too:
bunx convex env get --prod SITE_URL      # → https://bundestracker.de
```

**The key's formatting does not matter.** Real newlines, escaped `\n`, or every
run of whitespace collapsed to single spaces all decode to the same bytes — a
secret store that reformats on save is not an operator error, and
`lib/github-app.test.ts` verifies a signature made from each encoding against the
matching public key. What *does* matter is that it is the private key rather
than the public one: that is reported as `private-key-wrong-type` rather than
being guessed at.

Then delete the downloaded `.pem`. The deployment is the only place it belongs.

> [!CAUTION]
> **A partial App configuration does not fall back to the PAT.** The fallback
> applies only when *no* App variable is set at all. Setting two of the three,
> or a malformed key, is an operator error and is reported as one — falling back
> would publish under a different identity than was configured and *succeed*,
> which hides the mistake instead of surfacing it.

Until a credential **and** the repo are set, `feedback:isConfigured` reports
`configured: false` and **no control renders at all**, for anyone. Offering a
form that queues into a deployment which will never publish is worse than
offering nothing.

### Step 2b — reporting is signed-in only

Nothing above affects who may file. Every public function in
`convex/feedback.ts` calls `requireUserId`, so an anonymous caller is refused by
the server — the hidden control is a courtesy, not the gate. A signed-in reader
finds the control in the sidebar and the mobile drawer (above Settings) as well
as in the footer.

This means **Google or GitHub OAuth must already work on the deployment**, which
it does for the existing account features. If sign-in is broken, feedback is
unavailable rather than anonymous, which is the safe direction.

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

Remove whichever credential is set — `GITHUB_APP_PRIVATE_KEY` (or
`GITHUB_FEEDBACK_TOKEN` on the fallback). Every control disappears, and anything
already queued stays queued.

### Diagnosing a report that did not publish

`failureReason` on the row names the cause, and the App arm is specific about
which variable is at fault. No reason ever quotes a value.

| Reason | What it means |
|---|---|
| `github-not-configured` | No `GITHUB_FEEDBACK_REPO`. |
| `github-not-configured` *(via credential)* | Repo set, no credential of either kind. |
| `github-app-id-invalid` / `github-installation-id-invalid` | Not a bare integer. A stray character is the usual cause. |
| `github-private-key-unparseable` | Not a PEM, or not an RSA key. |
| `github-private-key-wrong-type` | A public key or certificate was pasted instead. |
| `github-installation-token-refused` | GitHub rejected the JWT — wrong App ID, key not this App's, or the App is not installed on the repo. |
| `github-installation-token-unreachable` | Network failure reaching GitHub. |
| `github-http-404` | The App is installed but lacks `Issues: Read and write`, or the repo name is wrong. |

Re-queue everything that failed once the cause is fixed:

```bash
bunx convex run --prod feedback:republishFailed '{}'
```

---

## Live production acceptance

**Local tests and stubs do not establish that this works in production.** They
establish that the logic is right; whether the deployment's own credentials,
session cookies and GitHub installation agree is a different question, and only
production answers it.

This is the runbook for that check. It is written to be performed **after
merge and deploy**, by a maintainer, and it deliberately requires **no test
hook, no bypass flag, and no relaxation of the gate** — every step below is a
real user action or a normal operator command. There is nothing to remember to
turn off afterwards, which is the point: a verification switch left enabled in
production is a worse outcome than an unverified deployment.

Prerequisites: Step 1–3 above completed on the **prod** deployment, and the two
labels created.

### 1. Anonymous access is refused — by the server

In a private window, signed out, on the deployed site:

- **No report control** in the footer, the sidebar, or the mobile drawer.

That is the UI half, and it is the weaker half. The gate itself:

```bash
# The deployment URL is public (it is in the browser bundle); this is exactly
# the request a hand-written caller would make.
curl -s -X POST "$CONVEX_URL/api/mutation" \
  -H 'Content-Type: application/json' \
  -d '{"path":"feedback:submitReport","args":{
        "kind":"bug","title":"anon probe","description":"","contact":"",
        "pageUrl":null,"locale":"de","diagnostics":null,"screenshotId":null,
        "uploadId":null,"clientKey":"probe","dwellMs":60000,"honeypot":"",
        "duplicateCandidates":[]},"format":"json"}'
```

**Expect** `{"status":"error", ...}` naming `Not authenticated`. Repeat for
`feedback:generateScreenshotUploadUrl` and `feedback:findDuplicates` — both must
refuse the same way. A `success` from any of the three means the gate is not
deployed, and the verification has failed.

Then confirm the refusal cost nothing: no new `feedbackReports`,
`feedbackUploads` or `feedbackSearches` row was written.

```bash
bunx convex data --prod feedbackSearches --limit 5
```

### 2. A signed-in user can discover and complete the flow

Sign in with Google or GitHub, then **without using the footer**:

- **Desktop** — the sidebar's account slot (above Settings) shows *Problem
  melden*. Collapse the rail: the row becomes a glyph with a tooltip carrying
  the same label.
- **Mobile** (≤1024 px) — the drawer's foot shows the same row. Tapping it
  closes the drawer and opens the sheet; the drawer must not remain behind it.

Both open the same sheet, over the page you were on.

### 3. Duplicate search reaches GitHub through the App

Fill in a title matching an existing issue and press *Weiter*. Candidates
appearing proves the outbound search was authenticated — an unauthenticated or
refused search returns an empty list, which is indistinguishable from "no
duplicates", so **a run that finds nothing has not verified this step**. Pick a
title you know matches.

### 4. A synthetic submission, authored by the App

File a report titled exactly:

```
[verification] synthetic report — safe to close
```

with a description saying so, **a contact address filled in**, and the
screenshot and diagnostics left enabled. Then check the issue GitHub created:

- **Author** is the App (a `[bot]` account) — not a person. This is what
  distinguishes App auth from the PAT fallback, and it is visible in the issue
  header.
- **Labels** are `via-website` and the kind label.
- **Body contains** the report id, the page URL, and the diagnostics table.
- **Body does NOT contain** the contact address, anywhere. It should say a
  contact was supplied (`hasContact`), never what it was.
- **Body has no screenshot** and no image link. The picture is stored in Convex,
  not published.

The absence of the address is the assertion that matters most, and it is worth
searching the raw body for it explicitly rather than skimming.

### 5. The private half is retrievable by a maintainer

Take the report id from the issue body:

```bash
cd webapp
bunx convex run --prod feedback:getPrivateReport '{"reportId":"<id from the issue>"}'
```

**Expect** the contact address and a short-lived screenshot URL — the data
deliberately kept out of the public issue. Open the URL and confirm the
screenshot is the page the report was filed from, with input values redacted.

This is an `internalQuery`: it is reachable from the CLI and the dashboard with
deploy credentials, and **not** from any browser. Confirm that too — the same
`curl` shape as step 1, with `feedback:getPrivateReport`, must fail with "Could
not find public function".

### 6. Clean up

```bash
gh issue close <number> --repo joshua-e-fehn/Bundestracker \
  --comment "Synthetic verification report; closing."
```

Deleting it outright is also fine (`gh issue delete`), and is the better choice
if the repository's issue numbering is public-facing. The Convex row may be left
alone — the 90-day retention sweep removes it, along with the screenshot.

### What a failure at each step means

| Step | Failure | Almost certainly |
|---|---|---|
| 1 | `curl` succeeds | The deployed Convex build predates the gate. Redeploy. |
| 2 | No row in the chrome | Not signed in, or `configured: false` — check step 2 of setup. |
| 3 | Never any candidates | Credential refused; check `failureReason` on a filed report. |
| 4 | Issue authored by a person | The PAT fallback is in use — an App variable is missing. |
| 4 | Issue never appears | Read `failureReason`; the table above names each cause. |
| 4 | Labels missing | The labels were not created first — GitHub silently drops unknown ones. |
| 5 | Query not found | Expected from a browser; from the CLI it means the deploy is stale. |

---

## What is not done here

Stated plainly rather than left to be discovered.

1. **No GitHub credential is set on any deployment by this branch.** Steps 1–3
   above are manual and cannot be performed from a worktree. The feature is
   inert in production until an operator performs them.
2. **Not verified against the real GitHub API, and this branch cannot be.**
   Every GitHub interaction is verified against a local stub and against
   `openssl` — `lib/github-app.test.ts` checks that the App JWT's signature
   verifies with the matching public key, and `lib/github-token.test.ts` pins
   the mint request, the cache, the refresh margin and each failure mode. What
   none of that establishes is that *GitHub accepts this deployment's
   credentials*, which is a fact about production and not about the code.
   [Live production acceptance](#live-production-acceptance) is the runbook for
   settling it, and it must be run before this is called done.
2b. **The authorization gate is asserted from source, not by calling a handler.**
   `bun test` has no Convex runtime, so an anonymous caller cannot be simulated
   in-process — the constraint `convex/feedback.test.ts` already works under.
   `lib/feedback-authorization.test.ts` therefore asserts that each public
   handler calls `requireUserId` *before* any read, write, fetch or scheduler
   call, and that the set of public functions is exactly the four it knows
   about. Those assertions were checked against deliberate mutants (gate
   deleted, gate moved after the budget charge, a new ungated public mutation
   added) and each failed as intended. The behavioural proof is step 1 of the
   live runbook, which is a real HTTP request to the real deployment.
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
