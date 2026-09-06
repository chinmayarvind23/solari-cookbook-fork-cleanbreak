// Decide which Browser actions are safe within the current cancellation scope.
import type {
  BrowserDecision,
  ObservationAction,
  PageObservation,
  PolicyDecision,
  ProposedAction,
} from "@/lib/agent/types"
import {
  approvalFingerprint,
  canonicalApprovalSnapshot,
  type ApprovalContext,
} from "@/lib/agent/approval"

const finalCancellation = [
  /confirm cancellation/,
  /confirm and cancel/,
  /complete cancellation/,
  /end (?:my )?(?:subscription|membership)/,
  /turn off (?:auto[- ]?)?renewal/,
  /cancel (?:my )?subscription/,
  /cancel (?:my )?membership/,
]
const accountDeletion = [/delete (?:my )?account/, /close (?:my )?account/]
const retentionAcceptance = [
  /claim .*off/,
  /accept .*off/,
  /accept (?:the )?offer/,
  /keep (?:my )?(?:membership|subscription|plan)/,
  /pause (?:my )?(?:membership|subscription)/,
  /switch plan/,
  /downgrade/,
  /never mind/,
]
const financialCommitment = [
  /buy now/,
  /place order/,
  /confirm purchase/,
  /pay now/,
  /upgrade/,
]

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function matches(name: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(normalized(name)))
}

export function classifyTarget(
  target: ObservationAction,
): PolicyDecision["risk"] {
  if (!target.name.trim()) return "UNKNOWN"
  if (matches(target.name, accountDeletion)) return "ACCOUNT_DELETION"
  if (matches(target.name, retentionAcceptance)) return "RETENTION_OFFER"
  if (matches(target.name, financialCommitment)) return "FINANCIAL_COMMITMENT"
  if (matches(target.name, finalCancellation)) return "FINAL_CANCELLATION"
  if (target.role === "link" || target.role === "radio") {
    return "SAFE_NAVIGATION"
  }
  if (
    matches(target.name, [
      /continue cancellation/,
      /no thanks.*continue/,
      /reject offer.*continue/,
      /start cancellation/,
    ])
  ) {
    return "SAFE_NAVIGATION"
  }
  return "UNKNOWN"
}

export function evaluateActionPolicy(options: {
  decision: BrowserDecision
  observation: PageObservation
  allowedOrigin: string
  minConfidence: number
}): PolicyDecision {
  const { decision, observation } = options
  if (decision.observationId !== observation.id) {
    return {
      result: "BLOCK",
      risk: "UNKNOWN",
      reason: "STALE_TARGET",
      target: null,
    }
  }

  if (["needs_human", "failure"].includes(decision.type)) {
    return {
      result: "BLOCK",
      risk: "UNKNOWN",
      reason: decision.reason || "MODEL_STOPPED",
      target: null,
    }
  }

  if (decision.type === "navigate") {
    try {
      const destination = new URL(decision.url!, observation.url)
      if (destination.origin !== options.allowedOrigin) {
        return {
          result: "BLOCK",
          risk: "UNKNOWN",
          reason: "EXTERNAL_NAVIGATION_BLOCKED",
          target: null,
        }
      }
    } catch {
      return {
        result: "BLOCK",
        risk: "UNKNOWN",
        reason: "INVALID_NAVIGATION_URL",
        target: null,
      }
    }
    if ((decision.confidence ?? 0) < options.minConfidence) {
      return {
        result: "BLOCK",
        risk: "UNKNOWN",
        reason: "AGENT_LOW_CONFIDENCE",
        target: null,
      }
    }
    return {
      result: "ALLOW",
      risk: "SAFE_NAVIGATION",
      reason: "SAME_ORIGIN_NAVIGATION",
      target: null,
    }
  }

  const target = observation.actions.find(
    (action) => action.id === decision.targetId,
  )
  if (!target) {
    return {
      result: "BLOCK",
      risk: "UNKNOWN",
      reason: "TARGET_NOT_FOUND",
      target: null,
    }
  }

  if (target.href) {
    try {
      if (
        new URL(target.href, observation.url).origin !== options.allowedOrigin
      ) {
        return {
          result: "BLOCK",
          risk: "UNKNOWN",
          reason: "EXTERNAL_NAVIGATION_BLOCKED",
          target,
        }
      }
    } catch {
      return {
        result: "BLOCK",
        risk: "UNKNOWN",
        reason: "INVALID_TARGET_URL",
        target,
      }
    }
  }

  const risk = classifyTarget(target)
  if (risk === "FINAL_CANCELLATION") {
    return {
      result: "INTERCEPT",
      risk,
      reason: "FINAL_ACTION_BOUNDARY",
      target,
    }
  }
  if (decision.type === "final_cancel_candidate") {
    return {
      result: "BLOCK",
      risk: "UNKNOWN",
      reason: "UNVERIFIED_FINAL_CANCELLATION_TARGET",
      target,
    }
  }
  if (risk !== "SAFE_NAVIGATION") {
    return { result: "BLOCK", risk, reason: `${risk}_BLOCKED`, target }
  }
  if ((decision.confidence ?? 0) < options.minConfidence) {
    return {
      result: "BLOCK",
      risk: "UNKNOWN",
      reason: "AGENT_LOW_CONFIDENCE",
      target,
    }
  }
  return { result: "ALLOW", risk, reason: "SAFE_ACTION", target }
}

export function proposedActionFrom(
  observation: PageObservation,
  target: ObservationAction,
  screenshotPath: string | null,
  context?: ApprovalContext,
): ProposedAction {
  const fee = observation.visibleText.match(
    /(?:fee|charge)[^$]{0,40}\$([0-9]+(?:\.[0-9]{2})?)/i,
  )
  const access = observation.visibleText.match(
    /(?:access(?:\s+remains)?(?:\s+available)?\s+(?:until|through)|available\s+(?:until|through))\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]+ \d{1,2}, \d{4})/i,
  )
  const visibleTerms = observation.visibleText
    .split(/\n|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => /access|refund|fee|charge|renew|cancel/i.test(line))
    .slice(0, 8)

  const detectedAt = observation.observedAt || new Date().toISOString()
  const subscription = context?.subscription ?? {
    id: "sub_streammax",
    name: "StreamMax",
    domain: new URL(observation.url).hostname,
    amount: 29.99,
    currency: "USD",
    interval: "MONTHLY" as const,
    status: "ACTIVE" as const,
  }
  const feeCents =
    /\bno (?:cancellation )?fee\b|(?:cancellation )?fee\s*:?[\s—-]*(?:none|\$0(?:\.00)?)/i.test(
      observation.visibleText,
    )
      ? 0
      : fee
        ? Math.round(Number(fee[1]) * 100)
        : null
  const snapshot = canonicalApprovalSnapshot({
    jobId: context?.jobId ?? "unknown-job",
    subscriptionId: subscription.id,
    serviceName: subscription.name,
    serviceDomain: subscription.domain,
    planName: context?.planName ?? "Premium",
    recurringPriceCents: Math.round(subscription.amount * 100),
    currency: subscription.currency,
    interval: subscription.interval,
    annualSavingsCents: Math.round(
      subscription.amount *
        (subscription.interval === "MONTHLY" ? 12 : 1) *
        100,
    ),
    currentStatus: subscription.status,
    actionText: target.name,
    targetRole: target.role,
    observedUrl: observation.url,
    feeCents,
    accessUntil: access?.[1] ?? null,
    visibleTerms,
    finalScreenshotPath: screenshotPath,
    observedAt: observation.observedAt,
    proposedActionCreatedAt: detectedAt,
  })

  return {
    detectedAt,
    targetRole: target.role,
    targetName: target.name,
    currentUrl: observation.url,
    feeCents: snapshot.feeCents,
    accessUntil: snapshot.accessUntil,
    visibleTerms,
    screenshotPath,
    snapshot,
    fingerprint: approvalFingerprint(snapshot),
  }
}
