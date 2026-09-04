import { z } from "zod"
import { classifyTarget } from "@/lib/agent/policy"

// One strict object (no root anyOf); nullable unused fields are still required.
export const desktopDecisionSchema = z
  .object({
    type: z.enum([
      "click",
      "type",
      "key",
      "scroll",
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
    destinationOrigin: z.string().max(200).nullable(),
    pageStatus: z.enum([
      "authenticated_provider",
      "login",
      "challenge",
      "unknown",
    ]),
    reasoning: z.string().max(600),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(300).nullable(),
  })
  .strict()
export type DesktopDecision = z.infer<typeof desktopDecisionSchema>
export const NEUTRAL_REASON = "I no longer need this subscription."

export type DesktopPolicy = {
  result: "ALLOW" | "BLOCK" | "INTERCEPT"
  code: string
}
export function desktopPolicy(
  d: DesktopDecision,
  origin: string,
  width: number,
  height: number,
  minConfidence: number,
): DesktopPolicy {
  const block = (code: string): DesktopPolicy => ({ result: "BLOCK", code })
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
    ["click", "scroll", "final_cancel_candidate"].includes(d.type) &&
    (d.x === null ||
      d.y === null ||
      d.x < 0 ||
      d.y < 0 ||
      d.x >= width ||
      d.y >= height)
  )
    return block("INVALID_COORDINATES")
  const label = (d.targetText ?? "").trim().toLowerCase()
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
  // Conservative boundary: even a mislabelled click on "Cancel" is intercepted.
  if (
    d.type === "final_cancel_candidate" ||
    (d.type === "click" &&
      /cancel|end.*(?:membership|subscription)|turn off.*renew/i.test(label))
  ) {
    if (!/cancel|end.*(?:membership|subscription)|turn off.*renew/i.test(label))
      return block("UNCONFIRMED_FINAL_TARGET")
    return { result: "INTERCEPT", code: "FINAL_ACTION_BOUNDARY" }
  }
  if (d.type === "scroll") return block("SCROLL_DELTA_UNSUPPORTED")
  if (
    d.type === "click" &&
    !/^(account|settings|billing(?: & plans)?|subscription|subscriptions|membership|manage (?:plan|subscription)|plans|no thanks|continue|next)$/i.test(
      label,
    )
  )
    return block("TARGET_NOT_ALLOWLISTED")
  if (
    d.type === "type" &&
    (d.text !== NEUTRAL_REASON || label !== "cancellation reason")
  )
    return block("TYPING_NOT_ALLOWED")
  if (
    d.type === "key" &&
    (d.keys?.length !== 1 ||
      !["Escape", "Page_Down", "Page_Up"].includes(d.keys[0]))
  )
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
    deltaY: d.deltaY,
    keys:
      d.keys?.filter((k) => ["Escape", "Page_Down", "Page_Up"].includes(k)) ??
      null,
    text: d.text === NEUTRAL_REASON ? NEUTRAL_REASON : null,
    targetText: "[withheld; inspect private screenshot]",
    visibleText: "[withheld]",
    reasoning: "[withheld]",
    reason: "[withheld]",
  }
}
