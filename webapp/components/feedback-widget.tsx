"use client"

import { useAction, useMutation, useQuery } from "convex/react"
import {
  AlertTriangleIcon,
  CheckIcon,
  ExternalLinkIcon,
  ImageIcon,
  MessageSquareWarningIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { authClient } from "@/lib/auth-client"
import {
  clearDiagnostics,
  collectDiagnostics,
  currentPageUrl,
  installDiagnostics,
} from "@/lib/diagnostics"
import {
  FEEDBACK_KINDS,
  type FeedbackKind,
  LIMITS,
  type SafeDiagnostics,
  validateReport,
} from "@/lib/feedback"
import type { TranslationKey } from "@/lib/i18n"
import { captureScreenshot } from "@/lib/screenshot"
import { cn } from "@/lib/utils"

/**
 * "Report a problem" — the whole intake flow, in one sheet.
 *
 * ## The order of the flow is the privacy argument
 *
 * Describe → **review what will be sent** → check for duplicates → send. The
 * review step is not a disclosure buried in a link; it is a step the reporter
 * passes through, showing the actual collected values and offering a checkbox
 * against each of the two collected artefacts. That is what "users must be
 * shown what will be submitted and be able to remove it" means when taken
 * literally, and taking it literally is the point: a privacy notice nobody
 * reads protects nobody.
 *
 * The screenshot is captured **when the sheet opens**, before the reporter has
 * typed anything, for two reasons. It has to depict the page they were looking
 * at rather than the page with a form over it — `lib/screenshot.ts` drops the
 * widget from the clone, but the page beneath has already been dimmed and
 * scroll-locked by the sheet — and capturing early means the preview is ready
 * by the time they scroll to it, rather than making them wait at the end.
 *
 * ## Why a sheet and not a page
 *
 * A bug report is filed *about the page you are on*, and navigating away to
 * file it loses that context — both for the reporter, who can no longer see the
 * thing they are describing, and for the collectors, whose breadcrumb trail
 * would end with "navigated to /feedback". The sheet keeps the report attached
 * to where it came from.
 *
 * ## What happens when the backend is not configured
 *
 * `feedback.isConfigured` reports whether a GitHub token and repository are
 * set. When they are not, the trigger does not render at all: offering a form
 * that silently queues into a deployment which will never publish is worse than
 * offering nothing, because the reporter believes they have been heard.
 */

/** Where the anonymous rate-limit key lives. Not a cookie: a cookie is sent on
 * every request to this origin, and this value has no business travelling with
 * anything but a report. See the `clientKey` note in convex/schema.ts for what
 * it does and does not stop. */
const CLIENT_KEY_STORAGE = "bundestrack.feedback.client"

/**
 * A stable random identifier for this browser.
 *
 * Created on first use and reused after. Deliberately random rather than
 * derived from anything about the device: a fingerprint would be both more
 * effective as a limiter and a tracking identifier, which is not a trade this
 * feature is entitled to make on a reader's behalf.
 */
function clientKey(): string {
  if (typeof window === "undefined") return "server"
  try {
    const existing = window.localStorage.getItem(CLIENT_KEY_STORAGE)
    if (existing) return existing
    const minted = crypto.randomUUID()
    window.localStorage.setItem(CLIENT_KEY_STORAGE, minted)
    return minted
  } catch {
    // Private mode, or storage disabled. A per-session key still bounds a
    // runaway loop, and the deployment cap covers the rest.
    return "ephemeral"
  }
}

type Step = "form" | "duplicates" | "sent"

type Duplicate = { number: number; title: string; url: string; state: string }

export function FeedbackWidget() {
  const { t, locale } = useLocale()
  const configured = useQuery(api.feedback.isConfigured, {})
  const submitReport = useMutation(api.feedback.submitReport)
  const generateUploadUrl = useMutation(api.feedback.generateScreenshotUploadUrl)
  const findDuplicates = useAction(api.feedback.findDuplicates)
  const session = authClient.useSession()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("form")
  const [kind, setKind] = useState<FeedbackKind>("bug")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [contact, setContact] = useState("")
  const [honeypot, setHoneypot] = useState("")
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true)
  const [includeScreenshot, setIncludeScreenshot] = useState(true)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<SafeDiagnostics | null>(null)
  const [screenshot, setScreenshot] = useState<{
    blob: Blob
    url: string
    redactedCount: number
  } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [duplicates, setDuplicates] = useState<Duplicate[]>([])
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openedAt = useRef(0)
  const formId = useId()

  /**
   * ⚠ The first client render must match the server's.
   *
   * The same hydration contract as components/sidebar-account.tsx and
   * components/follow-button.tsx, guarded by components/sidebar-account.test.ts
   * — which walks this directory and fails on any component reading
   * `authClient.useSession()` without the flag.
   *
   * It is load-bearing here for two independent reasons. The session is read to
   * fill `environment.signedIn`, and Better Auth can resolve it before React
   * hydrates. And `isConfigured` is a Convex query that is `undefined` on the
   * server and may be `true` by the client's first paint — returning `null`
   * from one and a `<button>` from the other is a differing element type at the
   * same position, which throws React #418, regenerates the tree, and in React
   * 19 detaches `<head>`.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // The collectors run for the life of the page, not the life of the widget —
  // a bug that already happened is the one worth reporting. See
  // lib/diagnostics.ts.
  useEffect(() => installDiagnostics(), [])

  /** Takes the screenshot and builds its preview URL. */
  const capture = useCallback(async () => {
    setCapturing(true)
    try {
      const result = await captureScreenshot()
      if (result) {
        setScreenshot((previous) => {
          if (previous) URL.revokeObjectURL(previous.url)
          return {
            blob: result.blob,
            url: URL.createObjectURL(result.blob),
            redactedCount: result.redactedCount,
          }
        })
      } else {
        setScreenshot(null)
      }
    } finally {
      setCapturing(false)
    }
  }, [])

  const openWidget = useCallback(() => {
    openedAt.current = Date.now()
    setStep("form")
    setError(null)
    setOpen(true)
    // Collected at open time so the snapshot reflects the moment the reporter
    // decided something was wrong.
    setDiagnostics(collectDiagnostics({ locale, signedIn: Boolean(session.data) }))
    void capture()
  }, [capture, locale, session.data])

  // Object URLs are a leak if they are not revoked, and this one outlives the
  // component only if the reader navigates away mid-report.
  useEffect(() => {
    return () => {
      if (screenshot) URL.revokeObjectURL(screenshot.url)
    }
  }, [screenshot])

  const resetForm = useCallback(() => {
    setTitle("")
    setDescription("")
    setContact("")
    setHoneypot("")
    setDuplicates([])
    setStep("form")
    setError(null)
    setScreenshot((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
  }, [])

  /**
   * Uploads the screenshot, returning the stored file **and the mint row it
   * belongs to** — or nulls, which is a complete answer: a report without a
   * picture is still a report.
   *
   * The `uploadId` matters on the server, not here. A mint row cannot know its
   * own `storageId` (the file does not exist when the URL is issued), so
   * carrying the row's id back through submission is what lets the server bind
   * the two exactly instead of guessing which unclaimed row a file came from.
   * See `bindUpload` in convex/feedback.ts.
   */
  async function uploadScreenshot(): Promise<{
    storageId: Id<"_storage"> | null
    uploadId: Id<"feedbackUploads"> | null
  }> {
    const none = { storageId: null, uploadId: null }
    if (!includeScreenshot || !screenshot) return none
    try {
      const minted = await generateUploadUrl({ clientKey: clientKey() })
      if (!minted) return none
      const response = await fetch(minted.url, {
        method: "POST",
        headers: { "Content-Type": screenshot.blob.type },
        body: screenshot.blob,
      })
      // A mint row was written; leaving it unclaimed is correct — the orphan
      // sweep reclaims it, which is exactly what that sweep is for.
      if (!response.ok) return none
      const body = (await response.json()) as { storageId?: string }
      if (!body.storageId) return none
      return { storageId: body.storageId as Id<"_storage">, uploadId: minted.uploadId }
    } catch {
      return none
    }
  }

  const validationError = validateReport({ title, description, contact })

  /** Step one of submitting: look for duplicates, and show them if any. The
   * check never blocks — a GitHub outage returns an empty list. */
  async function handleContinue() {
    if (validationError) {
      setError(t(errorKey(validationError)))
      return
    }
    setError(null)
    setCheckingDuplicates(true)
    try {
      // `clientKey` so the search is capped like every other public call —
      // it reaches GitHub on the deployment's own credential.
      const found = await findDuplicates({ title, description, clientKey: clientKey() })
      if (found.length > 0) {
        setDuplicates(found)
        setStep("duplicates")
        return
      }
      await handleSubmit()
    } catch {
      // The duplicate check is an assist. Its failure must not stop a report.
      await handleSubmit()
    } finally {
      setCheckingDuplicates(false)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const { storageId, uploadId } = await uploadScreenshot()
      const result = await submitReport({
        kind,
        title,
        description,
        contact,
        pageUrl: currentPageUrl(),
        locale,
        diagnostics: includeDiagnostics ? diagnostics : null,
        screenshotId: storageId,
        uploadId,
        clientKey: clientKey(),
        dwellMs: Date.now() - openedAt.current,
        honeypot,
        // What the reporter was shown and filed anyway. Empty when the check
        // found nothing or never ran — a triage signal, never a gate.
        duplicateCandidates: duplicates.map((duplicate) => duplicate.number),
      })
      if (!result.accepted) {
        setError(t(rejectionKey(result.reason)))
        setStep("form")
        return
      }
      // A second report in the same session must not re-send the first one's
      // errors — those have been filed already.
      clearDiagnostics()
      setStep("sent")
    } catch {
      setError(t("feedback.error.failed"))
      setStep("form")
    } finally {
      setSubmitting(false)
    }
  }

  // `undefined` is "still loading" and `false` is "not configured". Neither
  // renders a trigger; only an affirmative answer does — and not before mount,
  // so the server's HTML and the client's first render agree. See `mounted`.
  if (!mounted || configured !== true) return null

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openWidget}
        data-feedback-id="open-feedback"
        className="gap-1.5"
      >
        <MessageSquareWarningIcon />
        {t("feedback.open")}
      </Button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next && step === "sent") resetForm()
        }}
      >
        {/* `data-feedback-widget` is what lib/screenshot.ts drops from the
            clone — a picture of the report form is not a picture of the bug. */}
        <SheetContent
          side="right"
          data-feedback-widget=""
          className="w-full gap-0 overflow-y-auto sm:max-w-md"
        >
          <SheetHeader className="border-border/60 border-b">
            <SheetTitle>{t("feedback.title")}</SheetTitle>
            <SheetDescription>{t("feedback.description")}</SheetDescription>
          </SheetHeader>

          {step === "sent" ? (
            <SentPanel onClose={() => setOpen(false)} />
          ) : step === "duplicates" ? (
            <DuplicatePanel
              duplicates={duplicates}
              submitting={submitting}
              onBack={() => setStep("form")}
              onSubmitAnyway={handleSubmit}
            />
          ) : (
            <div className="flex flex-col gap-5 p-4">
              {error ? (
                <p
                  // `alert` so the message is announced when it replaces a
                  // submission the reporter was waiting on.
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm"
                >
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              <fieldset className="grid gap-2">
                <legend className="mb-2 font-medium text-sm">{t("feedback.kind.label")}</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {FEEDBACK_KINDS.map((option) => (
                    <label
                      key={option}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 rounded-lg border border-border p-2.5 text-sm transition-colors",
                        "has-[:checked]:border-primary has-[:checked]:bg-primary/5",
                        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <input
                          type="radio"
                          name={`${formId}-kind`}
                          value={option}
                          checked={kind === option}
                          onChange={() => setKind(option)}
                          className="size-3.5 accent-primary"
                        />
                        {t(`feedback.kind.${option}`)}
                      </span>
                      <span className="pl-5.5 text-muted-foreground text-xs">
                        {t(`feedback.kind.${option}Hint`)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-title`}>{t("feedback.field.title")}</Label>
                <Input
                  id={`${formId}-title`}
                  value={title}
                  maxLength={LIMITS.title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("feedback.field.titlePlaceholder")}
                  aria-invalid={Boolean(error && !title.trim())}
                  required
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-description`}>{t("feedback.field.description")}</Label>
                <Textarea
                  id={`${formId}-description`}
                  value={description}
                  maxLength={LIMITS.description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("feedback.field.descriptionPlaceholder")}
                  rows={4}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-contact`}>{t("feedback.field.contact")}</Label>
                <Input
                  id={`${formId}-contact`}
                  type="email"
                  value={contact}
                  maxLength={LIMITS.contact}
                  onChange={(event) => setContact(event.target.value)}
                  aria-describedby={`${formId}-contact-hint`}
                />
                <p id={`${formId}-contact-hint`} className="text-muted-foreground text-xs">
                  {t("feedback.field.contactHint")}
                </p>
              </div>

              {/* The honeypot. `aria-hidden` and off-screen rather than
                  `display:none` — some bots skip hidden inputs, and a
                  screen-reader user never reaches it because it is removed from
                  the accessibility tree and taken out of the tab order. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-[-9999px] size-px overflow-hidden"
              >
                <label htmlFor={`${formId}-website`}>{t("feedback.field.honeypot")}</label>
                <input
                  id={`${formId}-website`}
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                />
              </div>

              <ReviewPanel
                diagnostics={diagnostics}
                includeDiagnostics={includeDiagnostics}
                onToggleDiagnostics={setIncludeDiagnostics}
                showDiagnostics={showDiagnostics}
                onToggleShow={setShowDiagnostics}
                screenshot={screenshot}
                includeScreenshot={includeScreenshot}
                onToggleScreenshot={setIncludeScreenshot}
                capturing={capturing}
                onRetake={capture}
                formId={formId}
              />
            </div>
          )}

          {step === "form" ? (
            <SheetFooter className="border-border/60 border-t">
              <p className="text-muted-foreground text-xs">{t("feedback.publicNote")}</p>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {t("feedback.cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleContinue}
                  disabled={submitting || checkingDuplicates || Boolean(validationError)}
                  data-feedback-id="submit-feedback"
                >
                  {checkingDuplicates
                    ? t("feedback.duplicates.checking")
                    : submitting
                      ? t("feedback.submitting")
                      : t("feedback.submit")}
                </Button>
              </div>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

/**
 * Maps a `ValidationError` to its translation key.
 *
 * Whole keys rather than a suffix interpolated at the call site: `t()` takes a
 * `TranslationKey`, and a template literal widens to `string`, which defeats
 * the check that makes a missing translation a compile error rather than a
 * key rendered raw to a reader. The same reason lib/i18n.ts states for typing
 * the dictionary at all.
 */
function errorKey(error: NonNullable<ReturnType<typeof validateReport>>): TranslationKey {
  const keys: Record<NonNullable<ReturnType<typeof validateReport>>, TranslationKey> = {
    "title-missing": "feedback.error.titleMissing",
    "title-too-long": "feedback.error.titleTooLong",
    "description-too-long": "feedback.error.descriptionTooLong",
    "contact-invalid": "feedback.error.contactInvalid",
  }
  return keys[error]
}

/** Maps a server rejection reason to a message. Unknown reasons fall back to
 * the generic failure rather than rendering a raw backend string to a reader. */
function rejectionKey(reason: string | null): TranslationKey {
  switch (reason) {
    case "too-many-from-client":
    case "too-many-for-deployment":
      return "feedback.error.tooMany" as const
    case "too-fast":
    case "honeypot":
      return "feedback.error.tooFast" as const
    case "title-missing":
      return "feedback.error.titleMissing" as const
    case "title-too-long":
      return "feedback.error.titleTooLong" as const
    case "description-too-long":
      return "feedback.error.descriptionTooLong" as const
    case "contact-invalid":
      return "feedback.error.contactInvalid" as const
    default:
      return "feedback.error.failed" as const
  }
}

/**
 * The review step: exactly what will be sent, and the two switches that remove
 * it.
 *
 * The values are rendered from the same object that is submitted, not from a
 * description of it — so the panel cannot drift out of step with reality, which
 * is the failure mode that makes a "what we collect" screen worse than nothing.
 */
function ReviewPanel({
  diagnostics,
  includeDiagnostics,
  onToggleDiagnostics,
  showDiagnostics,
  onToggleShow,
  screenshot,
  includeScreenshot,
  onToggleScreenshot,
  capturing,
  onRetake,
  formId,
}: {
  diagnostics: SafeDiagnostics | null
  includeDiagnostics: boolean
  onToggleDiagnostics: (next: boolean) => void
  showDiagnostics: boolean
  onToggleShow: (next: boolean) => void
  screenshot: { url: string; redactedCount: number } | null
  includeScreenshot: boolean
  onToggleScreenshot: (next: boolean) => void
  capturing: boolean
  onRetake: () => void
  formId: string
}) {
  const { t } = useLocale()

  return (
    <section className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <h3 className="flex items-center gap-2 font-medium text-sm">
        <ShieldCheckIcon className="size-4 text-muted-foreground" />
        {t("feedback.privacy.heading")}
      </h3>

      {/* The screenshot */}
      <div className="grid gap-2">
        <div className="flex items-start gap-2">
          <Checkbox
            id={`${formId}-screenshot`}
            checked={includeScreenshot && screenshot !== null}
            disabled={screenshot === null}
            onCheckedChange={(next) => onToggleScreenshot(next === true)}
          />
          <div className="grid gap-0.5">
            <Label htmlFor={`${formId}-screenshot`} className="gap-1.5">
              <ImageIcon className="size-3.5 text-muted-foreground" />
              {t("feedback.screenshot.label")}
            </Label>
            <p className="text-muted-foreground text-xs">
              {capturing
                ? t("feedback.screenshot.capturing")
                : screenshot === null
                  ? t("feedback.screenshot.failed")
                  : !includeScreenshot
                    ? t("feedback.screenshot.removed")
                    : t("feedback.screenshot.redactionNote")}
            </p>
          </div>
        </div>

        {screenshot && includeScreenshot ? (
          <figure className="grid gap-1">
            {/* biome-ignore lint/performance/noImgElement: a blob: URL from a
                canvas cannot go through next/image, which needs a loader and a
                remote pattern. */}
            <img
              src={screenshot.url}
              alt={t("feedback.screenshot.alt")}
              className="max-h-40 w-full rounded-md border border-border object-cover object-top"
            />
            <figcaption className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
              <span>
                {screenshot.redactedCount > 0
                  ? t("feedback.screenshot.redacted", { count: screenshot.redactedCount })
                  : null}
              </span>
              <Button variant="ghost" size="xs" onClick={onRetake} disabled={capturing}>
                {t("feedback.screenshot.retake")}
              </Button>
            </figcaption>
          </figure>
        ) : null}
      </div>

      {/* The diagnostics */}
      <div className="grid gap-2 border-border/60 border-t pt-3">
        <div className="flex items-start gap-2">
          <Checkbox
            id={`${formId}-diagnostics`}
            checked={includeDiagnostics}
            onCheckedChange={(next) => onToggleDiagnostics(next === true)}
          />
          <div className="grid gap-0.5">
            <Label htmlFor={`${formId}-diagnostics`}>{t("feedback.diagnostics.label")}</Label>
            <p className="text-muted-foreground text-xs">
              {includeDiagnostics
                ? t("feedback.diagnostics.hint")
                : t("feedback.diagnostics.removed")}
            </p>
          </div>
        </div>

        {includeDiagnostics && diagnostics ? (
          <div className="grid gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              className="justify-self-start"
              onClick={() => onToggleShow(!showDiagnostics)}
              aria-expanded={showDiagnostics}
              aria-controls={`${formId}-diagnostics-detail`}
            >
              {showDiagnostics ? t("feedback.diagnostics.hide") : t("feedback.diagnostics.show")}
            </Button>
            {showDiagnostics ? (
              <dl
                id={`${formId}-diagnostics-detail`}
                className="grid gap-1 rounded-md bg-background/60 p-2 font-mono text-[0.7rem] text-muted-foreground"
              >
                <DiagnosticRow label="User agent" value={diagnostics.environment.userAgent} />
                <DiagnosticRow
                  label="Viewport"
                  value={`${diagnostics.environment.viewport.width}×${diagnostics.environment.viewport.height} @${diagnostics.environment.devicePixelRatio}×`}
                />
                <DiagnosticRow label="Theme" value={diagnostics.environment.colorScheme} />
                <DiagnosticRow label="Time zone" value={diagnostics.environment.timeZone} />
                <DiagnosticRow
                  label={t("feedback.diagnostics.errors", { count: diagnostics.errors.length })}
                  value={diagnostics.errors[0]?.message ?? "—"}
                />
                <DiagnosticRow
                  label={t("feedback.diagnostics.requests", {
                    count: diagnostics.requests.length,
                  })}
                  value={diagnostics.requests[0]?.url ?? "—"}
                />
                <DiagnosticRow
                  label={t("feedback.diagnostics.breadcrumbs", {
                    count: diagnostics.breadcrumbs.length,
                  })}
                  value={diagnostics.breadcrumbs.at(-1)?.target ?? "—"}
                />
              </dl>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="border-border/60 border-t pt-3 text-muted-foreground text-xs leading-relaxed">
        {t("feedback.privacy.never")}
      </p>
    </section>
  )
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-foreground/70">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  )
}

/** The duplicate step. Never a dead end: "report anyway" is always available
 * and always the primary action, because a reporter is better placed than a
 * keyword search to know whether their problem is the same one. */
function DuplicatePanel({
  duplicates,
  submitting,
  onBack,
  onSubmitAnyway,
}: {
  duplicates: Duplicate[]
  submitting: boolean
  onBack: () => void
  onSubmitAnyway: () => void
}) {
  const { t } = useLocale()
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid gap-1">
        <h3 className="font-medium text-sm">{t("feedback.duplicates.heading")}</h3>
        <p className="text-muted-foreground text-sm">{t("feedback.duplicates.hint")}</p>
      </div>
      <ul className="grid gap-2">
        {duplicates.map((duplicate) => (
          <li key={duplicate.number}>
            <a
              href={duplicate.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{duplicate.title}</span>
                <span className="text-muted-foreground text-xs">
                  #{duplicate.number} ·{" "}
                  {duplicate.state === "closed"
                    ? t("feedback.duplicates.closed")
                    : t("feedback.duplicates.open")}
                </span>
              </span>
              <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </a>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={submitting}>
          {t("feedback.duplicates.back")}
        </Button>
        <Button size="sm" onClick={onSubmitAnyway} disabled={submitting}>
          {submitting ? t("feedback.submitting") : t("feedback.duplicates.submitAnyway")}
        </Button>
      </div>
    </div>
  )
}

function SentPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLocale()
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <p className="flex items-center gap-2 font-medium text-sm">
        <CheckIcon className="size-4 text-primary" />
        {t("feedback.success.heading")}
      </p>
      <p className="text-muted-foreground text-sm">{t("feedback.success.body")}</p>
      <Button variant="outline" size="sm" onClick={onClose}>
        {t("feedback.success.close")}
      </Button>
    </div>
  )
}
