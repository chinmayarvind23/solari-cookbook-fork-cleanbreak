import { z } from "zod"
import { classifyTarget } from "@/lib/agent/policy"
import {
  assessMiroDecision,
  miroObservationSchema,
  type MiroScope,
} from "./miro"

// One strict object (no root anyOf); nullable unused fields are still required.
export const desktopDecisionSchema = z
  .object({
    type: z.enum([
      "click",
      "cancel_flow_navigation",
      "type",
      "key",
      "scroll",
      "wait",
      "final_cancel_candidate",
      "needs_human",
      "failure",
    ]),
    x: z.number().int().nullable(),
    y: z.number().int().nullable(),
    text: z.string().max(300).nullable(),
    keys: z.array(z.string().max(24)).max(3).nullable(),
    deltaY: z.number().int().nullable(),
    targetText: z.string().max(160).nullable(),
    visibleText: z.string().max(600).nullable(),
    observedOrigin: z.string().max(200).nullable(),
    miroObservation: miroObservationSchema.nullable(),
    destinationOrigin: z.string().max(200).nullable(),
    pageStatus: z.enum([
      "authenticated_provider",
      "login",
      "challenge",
      "unknown",
      "loading",
    ]),
    flowStage: z.enum([
      "BILLING",
      "CANCELLATION_ENTRY",
      "RETENTION",
      "REASON",
      "REVIEW",
      "FINAL_CONFIRMATION",
    ]),
    reasoning: z.string().max(600),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(300).nullable(),
  })
  .strict()
export type DesktopDecision = z.infer<typeof desktopDecisionSchema>
// Wait observations never receive an input grant, even if misrouted to policy.
export function isLoadingObservation(d: DesktopDecision, origin: string) {
  return (
    d.type === "wait" &&
    d.pageStatus === "loading" &&
    d.observedOrigin === origin &&
    d.destinationOrigin === null &&
    d.x === null &&
    d.y === null &&
    d.text === null &&
    d.keys === null &&
    d.deltaY === null &&
    d.targetText === null
  )
}
export const NEUTRAL_REASON = "I no longer need this subscription."
export const SAFE_DESKTOP_NAVIGATION_KEYS = [
  "Escape",
  "Page_Down",
  "Page_Up",
  "Tab",
  "Shift+Tab",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
] as const

// Exact allowlist, not a general shortcut parser. The SDK represents chords as
// arrays; Shift+Tab is the sole permitted modifier combination.
export function desktopNavigationKeys(
  keys: readonly string[] | null,
): string[] | null {
  if (keys?.length === 2 && keys[0] === "Shift" && keys[1] === "Tab")
    return ["Shift", "Tab"]
  if (
    keys?.length !== 1 ||
    !SAFE_DESKTOP_NAVIGATION_KEYS.some((key) => key === keys[0])
  )
    return null
  return keys[0] === "Shift+Tab" ? ["Shift", "Tab"] : [keys[0]]
}

const cancellationLabel =
  /cancel|end.*(?:membership|subscription|trial)|(?:turn off|stop).*renew/i
const flowNavigationLabel =
  /^(?:start cancellation|continue cancellation|proceed (?:with|to) cancellation|review cancellation|manage cancellation|keep cancelling|keep canceling|no thanks|continue|next|proceed)$/i
const finalConsequence =
  /\b(?:confirm\w*|complete\w*|finish\w*|final\w*|yes\b.*\bcancel|cancel now|end now|end (?:my |your |the )?(?:trial|subscription|membership)|effective immediately|turn off (?:auto[- ]?)?renewal|stop (?:auto[- ]?)?renewal|will be cancel[le]+d|will end|lose access|no further charges|cancellation fee|charged\b.*\bfee|irreversible|permanent\w*)\b/i

function clearlyHasAnotherStep(context: string): boolean {
  if (/\b(?:no|not|without|last|only|immediate|immediately)\b/i.test(context))
    return false
  const numbered = /\bstep (\d{1,2}) of (\d{1,2})\b/i.exec(context)
  return (
    (numbered !== null &&
      Number(numbered[1]) >= 1 &&
      Number(numbered[1]) < Number(numbered[2]) &&
      Number(numbered[2]) <= 20) ||
    /\b(?:another|next|additional) (?:review step|step|screen) (?:follows|will follow|is required)\b/i.test(
      context,
    )
  )
}

export function establishedFinalBoundary(d: DesktopDecision): boolean {
  return (
    d.flowStage === "FINAL_CONFIRMATION" &&
    cancellationLabel.test(d.targetText ?? "") &&
    finalConsequence.test(`${d.targetText ?? ""} ${d.visibleText ?? ""}`)
  )
}

// Opaque, one-use local dispatch grants. Raw model decisions cannot be dispatched.
// Freezing the clone prevents mutation between policy evaluation and execution.
const dispatchGrants = new WeakSet<DesktopDecision>()
export function authorizeDesktopNavigation(
  d: DesktopDecision,
  origin: string,
  width: number,
  height: number,
  minConfidence: number,
  miroScope?: MiroScope,
): DesktopDecision | null {
  const assessment = evaluateDesktopDecision(
    d,
    origin,
    width,
    height,
    minConfidence,
    miroScope,
  )
  if (assessment.policy.result !== "ALLOW") return null
  d = assessment.decision
  if (!["click", "cancel_flow_navigation", "type", "key"].includes(d.type))
    return null
  const grant = { ...d, keys: d.keys ? [...d.keys] : null }
  if (grant.keys) Object.freeze(grant.keys)
  Object.freeze(grant)
  dispatchGrants.add(grant)
  return grant
}
export function consumeDesktopNavigationGrant(d: DesktopDecision): boolean {
  return dispatchGrants.delete(d)
}

export type DesktopPolicy = {
  result: "ALLOW" | "BLOCK" | "INTERCEPT"
  code: string
}
export function evaluateDesktopDecision(
  d: DesktopDecision,
  origin: string,
  width: number,
  height: number,
  minConfidence: number,
  miroScope?: MiroScope,
) {
  const adapter = miroScope
    ? assessMiroDecision(d, miroScope, origin, width, height, minConfidence)
    : null
  return (
    adapter ?? {
      diagnostic: null,
      decision: d,
      policy: desktopPolicy(d, origin, width, height, minConfidence),
      rule: null,
      finalBoundaryEstablished: establishedFinalBoundary(d),
    }
  )
}
export function desktopPolicy(
  d: DesktopDecision,
  origin: string,
  width: number,
  height: number,
  minConfidence: number,
): DesktopPolicy {
  const block = (code: string): DesktopPolicy => ({ result: "BLOCK", code })
  const intercept = (): DesktopPolicy => ({
    result: "INTERCEPT",
    code: "FINAL_ACTION_BOUNDARY",
  })
  // Terminal decision: never reaches any input dispatcher, even with missing context.
  if (d.type === "wait") return block("OBSERVATION_ONLY_NO_INPUT")
  if (d.type === "final_cancel_candidate") return intercept()
  if (d.confidence < minConfidence) return block("LOW_CONFIDENCE")
  if (d.pageStatus === "challenge") return block("ANTI_BOT_CHALLENGE")
  if (d.pageStatus === "login") return block("LOGIN_REQUIRED")
  if (d.pageStatus !== "authenticated_provider")
    return block("PROVIDER_NOT_ESTABLISHED")
  if (
    d.observedOrigin !== origin ||
    (d.destinationOrigin !== null && d.destinationOrigin !== origin)
  )
    return block("UNRELATED_ORIGIN")
  if (d.type === "needs_human" || d.type === "failure")
    return block("MODEL_STOPPED")
  if (
    ["click", "scroll", "cancel_flow_navigation"].includes(d.type) &&
    (d.x === null ||
      d.y === null ||
      d.x < 0 ||
      d.y < 0 ||
      d.x >= width ||
      d.y >= height)
  )
    return block("INVALID_COORDINATES")
  const label = (d.targetText ?? "").trim().toLowerCase()
  const context = (d.visibleText ?? "").replace(/\s+/g, " ").trim()
  if (
    ["click", "cancel_flow_navigation"].includes(d.type) &&
    (finalConsequence.test(`${label} ${context}`) ||
      d.flowStage === "FINAL_CONFIRMATION")
  )
    return intercept()
  const risk = classifyTarget({
    id: "desktop",
    name: label,
    role: "button",
    kind: "button",
    href: null,
    checked: null,
    value: null,
  })
  if (
    ["ACCOUNT_DELETION", "RETENTION_OFFER", "FINANCIAL_COMMITMENT"].includes(
      risk,
    )
  )
    return block(risk)
  if (
    /delete|payment|password|security|purchase|accept.*offer|claim.*off|pause|upgrade|downgrade/i.test(
      label,
    )
  )
    return block("UNSAFE_TARGET")
  // Only this explicitly classified, narrowly allowlisted path can advance a
  // cancellation flow. Nonempty context alone is not evidence of reversibility.
  if (d.type === "cancel_flow_navigation") {
    const ambiguousEntry = /^(cancel plan|cancel subscription)$/.test(label)
    const opensReview =
      /\bopens? (?:the |a |another |next )?(?:cancellation )?review (?:step|screen)\b/i.test(
        context,
      )
    if (
      !(flowNavigationLabel.test(label) || (ambiguousEntry && opensReview)) ||
      !(
        clearlyHasAnotherStep(context) ||
        (ambiguousEntry &&
          opensReview &&
          !/\b(no|not|without|immediate|immediately|last)\b/i.test(context))
      ) ||
      (/^(no thanks|continue|next|proceed)$/.test(label) &&
        d.flowStage === "BILLING")
    )
      return intercept()
    return { result: "ALLOW", code: "HUMAN_NAVIGATION_REVIEW_REQUIRED" }
  }
  if (d.type === "click" && cancellationLabel.test(label)) return intercept()
  if (
    d.type === "click" &&
    /^(continue|next|proceed)$/.test(label) &&
    !clearlyHasAnotherStep(context)
  )
    return intercept()
  if (d.type === "scroll") return block("SCROLL_DELTA_UNSUPPORTED")
  if (
    d.type === "click" &&
    d.flowStage === "REASON" &&
    /^(i no longer need this subscription\.?|no longer needed|not using it|i no longer use it)$/i.test(
      label,
    ) &&
    /\b(cancellation reason|reason for cancel(?:ling|ing)|why.*cancel)\b/i.test(
      context,
    )
  )
    return { result: "ALLOW", code: "HUMAN_NAVIGATION_REVIEW_REQUIRED" }
  if (
    d.type === "click" &&
    !/^(account|settings|billing(?: & plans)?|subscription|subscriptions|membership|manage (?:plan|subscription)|plans|no thanks|not now|back|continue|next|proceed)$/i.test(
      label,
    )
  )
    return block("TARGET_NOT_ALLOWLISTED")
  if (
    d.type === "type" &&
    (d.text !== NEUTRAL_REASON || label !== "cancellation reason")
  )
    return block("TYPING_NOT_ALLOWED")
  if (d.type === "key" && desktopNavigationKeys(d.keys) === null)
    return block("KEY_NOT_ALLOWED")
  return { result: "ALLOW", code: "HUMAN_NAVIGATION_REVIEW_REQUIRED" }
}

// Never persist free-form model text: it can repeat a password, account ID, URL,
// or prompt injection from a screenshot. Preserve the structured action instead.
export function safeDesktopDecision(d: DesktopDecision) {
  return {
    type: d.type,
    x: d.x,
    y: d.y,
    confidence: d.confidence,
    pageStatus: d.pageStatus,
    miroObservation: d.miroObservation
      ? {
          surface: d.miroObservation.surface,
          targetRole: d.miroObservation.targetRole,
        }
      : null,
    flowStage: d.flowStage,
    deltaY: d.deltaY,
    keys: desktopNavigationKeys(d.keys),
    text: d.text === NEUTRAL_REASON ? NEUTRAL_REASON : null,
    targetText: "[withheld; inspect private screenshot]",
    visibleText: "[withheld]",
    reasoning: "[withheld]",
    reason: "[withheld]",
  }
}
