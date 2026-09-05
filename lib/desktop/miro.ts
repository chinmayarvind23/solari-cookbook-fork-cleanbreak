import { z } from "zod"
import type { DesktopDecision, DesktopPolicy } from "./decision"

// Observed URL stays in memory. Only surface/role enums may enter safe evidence.
export const miroObservationSchema = z
  .object({
    pageUrl: z.string().max(2048).nullable(),
    // Immediate control/active-dialog context, never unrelated billing chrome.
    targetContext: z.string().max(3000).nullable(),
    surface: z.enum([
      "BILLING_PAGE",
      "CANCELLATION_DIALOG",
      "CANCELLATION_CHOICE",
      "REASON",
      "TOOL_SWITCH",
      "FINAL_CONFIRMATION",
      "UNKNOWN",
    ]),
    targetRole: z.enum(["BUTTON", "OPTION", "RADIO", "CHECKBOX", "UNKNOWN"]),
  })
  .strict()
export type MiroRule =
  | "ENTRY"
  | "CONTINUE_DIALOG"
  | "CONTINUE_REASON"
  | "CANCEL_CHOICE"
  | "NEXT_REVIEW"
  | "NEUTRAL_TOOL_CHOICE"
  | "FINAL"
  | "AMBIGUOUS"
export type MiroScope = {
  providerName: string
  startUrl: string
  completedCancellationSteps: number
  completedRules: readonly MiroRule[]
}
export type MiroAssessment = {
  diagnostic: string
  decision: DesktopDecision
  policy: DesktopPolicy
  rule: MiroRule
  finalBoundaryEstablished: boolean
}

export function isMiroProvider(
  providerName: string,
  startUrl: string,
): boolean {
  try {
    const url = new URL(startUrl)
    return (
      providerName.trim().toLowerCase() === "miro" &&
      url.origin === "https://miro.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/app\/settings\/.+\/billing(?:\/subscription)?\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

const consequence =
  /\b(?:confirm\w*|complete\w*|finish\w*|final\w*|yes\b.*\bcancel|cancel now|end now|end (?:my |your |the )?(?:trial|subscription|membership)|effective|scheduled|immediate\w*|cancels? (?:your |the )?(?:subscription|trial) now|click\w*\b.*\bcancels?\b|turn off (?:auto[- ]?)?renewal|stop (?:auto[- ]?)?renewal|will be cancel(?:l)?ed|will end|lose access|no further charges|cancellation fee|charged\b.*\bfee|irreversible|permanent\w*)\b/i
const entryLabel = /^(cancel subscription|cancel trial)$/i
const nextReview =
  /\b(?:opens?|shows?) (?:the |a |another |next )?(?:cancellation )?(?:review|reason) (?:step|screen)\b|\b(?:next|another) (?:review|reason) step (?:follows|is required)\b/i

// Provider-specific assessment only; generic desktopPolicy is never relaxed.
// Docs: Miro Help Center cancellation article 360011986179; trial article 15392587152786.
export function assessMiroDecision(
  d: DesktopDecision,
  scope: MiroScope,
  origin: string,
  width: number,
  height: number,
  minConfidence: number,
): MiroAssessment | null {
  if (!isMiroProvider(scope.providerName, scope.startUrl)) return null
  if (
    !["click", "cancel_flow_navigation", "final_cancel_candidate"].includes(
      d.type,
    )
  )
    return null
  const label = (d.targetText ?? "").trim().toLowerCase()
  const context = (d.visibleText ?? "").replace(/\s+/g, " ").trim()
  const observation = d.miroObservation
  const cancellationTarget =
    /cancel|end.*(?:trial|subscription)|(?:turn off|stop).*renew/.test(label)
  const relevant =
    cancellationTarget || /^(continue|prefer not to say)$/.test(label)
  const intercept = (
    established = false,
    diagnostic = "MIRO_AMBIGUOUS_STEP",
  ): MiroAssessment => ({
    diagnostic,
    decision: {
      ...d,
      type: "final_cancel_candidate",
      flowStage: established ? "FINAL_CONFIRMATION" : d.flowStage,
    },
    policy: { result: "INTERCEPT", code: "FINAL_ACTION_BOUNDARY" },
    rule: established ? "FINAL" : "AMBIGUOUS",
    finalBoundaryEstablished: established,
  })
  if (!relevant) return d.type === "final_cancel_candidate" ? intercept() : null
  // Never infer the current billing account from origin or the configured URL.
  let pageMatches = false
  try {
    const expected = new URL(scope.startUrl)
    const actual = new URL(observation?.pageUrl ?? "")
    pageMatches =
      actual.origin === expected.origin &&
      actual.pathname.replace(/\/$/, "") ===
        expected.pathname.replace(/\/$/, "") &&
      !actual.username &&
      !actual.password &&
      !actual.search &&
      !actual.hash
  } catch {
    /* Unknown/truncated address bar fails closed. */
  }
  if (!pageMatches) return intercept(false, "MIRO_BILLING_URL_MISMATCH")
  if (
    origin !== "https://miro.com" ||
    d.observedOrigin !== origin ||
    (d.destinationOrigin !== null && d.destinationOrigin !== origin) ||
    d.pageStatus !== "authenticated_provider" ||
    d.confidence < minConfidence ||
    d.x === null ||
    d.y === null ||
    d.x < 0 ||
    d.y < 0 ||
    d.x >= width ||
    d.y >= height
  )
    return intercept(false, "MIRO_UNSAFE_OBSERVATION")
  const entered = scope.completedCancellationSteps > 0
  const targetContext = observation?.targetContext?.trim()
  if (!targetContext) return intercept(false, "MIRO_TARGET_CONTEXT_MISSING")
  const finalCue = consequence.test(`${label} ${context} ${targetContext}`)
  if (finalCue || observation?.surface === "FINAL_CONFIRMATION")
    return intercept(
      entered &&
        finalCue &&
        cancellationTarget &&
        observation?.targetRole === "BUTTON",
      "MIRO_FINAL_OR_CONSEQUENCE_CONTEXT",
    )
  // A Continue button must not authorize a retention/payment/security flow.
  if (
    /\b(?:downgrade|upgrade|pause|purchase|payment|password|security|accept.*offer|agree.*terms|unpaid invoice|invoicing)\b/i.test(
      targetContext,
    )
  )
    return intercept(false, "MIRO_TARGET_FINANCIAL_OR_ACCOUNT_CHANGE")
  const allow = (
    rule: MiroRule,
    flowStage: DesktopDecision["flowStage"],
  ): MiroAssessment => ({
    diagnostic: `MIRO_${rule}`,
    decision: { ...d, type: "cancel_flow_navigation", flowStage },
    policy: { result: "ALLOW", code: "HUMAN_NAVIGATION_REVIEW_REQUIRED" },
    rule,
    finalBoundaryEstablished: false,
  })
  // Standalone billing controls only, never a dialog over the billing background.
  if (
    !entered &&
    entryLabel.test(label) &&
    observation?.surface === "BILLING_PAGE" &&
    observation.targetRole === "BUTTON" &&
    /\bbilling(?: actions)?\b|\blicensing configuration\b/i.test(context) &&
    !/\bdialog|\bmodal|\bcancellation reason\b|\bare you sure\b/i.test(
      context,
    ) &&
    (label !== "cancel trial" || /\btrial\b/i.test(context))
  )
    return allow("ENTRY", "CANCELLATION_ENTRY")
  if (!entered) return intercept(false, "MIRO_ENTRY_CONTEXT_NOT_ESTABLISHED")
  // Once entered, billing-background wording never re-enables the first exception.
  if (observation?.surface === "BILLING_PAGE")
    return intercept(false, "MIRO_ENTRY_ALREADY_TRAVERSED")
  const safeNext =
    nextReview.test(context) && !/\b(no|not|without|last|only)\b/i.test(context)
  if (
    entryLabel.test(label) &&
    observation?.surface === "CANCELLATION_CHOICE" &&
    ["OPTION", "RADIO"].includes(observation.targetRole) &&
    /\b(select|choose)\b/i.test(context) &&
    /\b(?:then|before)\b.*\bbutton\b/i.test(context) &&
    /\b(cancel subscription|continue to cancel|continue)\b/i.test(context) &&
    !scope.completedRules.includes("CANCEL_CHOICE")
  )
    return allow("CANCEL_CHOICE", "RETENTION")
  if (
    entryLabel.test(label) &&
    observation?.targetRole === "BUTTON" &&
    observation.surface === "CANCELLATION_CHOICE" &&
    safeNext &&
    !scope.completedRules.includes("NEXT_REVIEW")
  )
    return allow("NEXT_REVIEW", "REVIEW")
  if (
    /^(continue|continue to cancel)$/.test(label) &&
    observation?.targetRole === "BUTTON" &&
    /\bcancel(?:lation|ling|ing| subscription| trial)?\b/i.test(context)
  ) {
    const rule =
      observation.surface === "CANCELLATION_DIALOG"
        ? "CONTINUE_DIALOG"
        : observation.surface === "REASON"
          ? "CONTINUE_REASON"
          : null
    if (rule && !scope.completedRules.includes(rule))
      return allow(rule, rule === "CONTINUE_REASON" ? "REVIEW" : "RETENTION")
  }
  if (
    label === "prefer not to say" &&
    observation?.surface === "TOOL_SWITCH" &&
    ["OPTION", "RADIO"].includes(observation.targetRole) &&
    /\b(?:switching|switch)\b.*\btool\b/i.test(context) &&
    !scope.completedRules.includes("NEUTRAL_TOOL_CHOICE")
  )
    return allow("NEUTRAL_TOOL_CHOICE", "REVIEW")
  return intercept()
}
