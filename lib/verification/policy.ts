import type {
  NormalizedSubscriptionStatus,
  VerificationStatus,
} from "@/lib/agent/types"

export type NormalizedVerificationState = {
  status: NormalizedSubscriptionStatus
  autoRenew: boolean | null
  nextChargeDate: string | null
  nextChargeAmountCents: number | null
  accessUntil: string | null
}

export type ReadOnlyObservation = {
  url: string
  title: string
  visibleText: string
  fields: Array<{ label: string; value: string; detail?: string }>
}

export type PolicyOutcome = NormalizedVerificationState & {
  statusResult: VerificationStatus
  satisfiedCriteria: string[]
  failedCriteria: string[]
  explanation: string
  errorCode: string | null
}

export function assertReadOnlyVerificationAction(action: string): void {
  const normalized = action.trim().toLowerCase()
  if (
    normalized !== "navigate" &&
    normalized !== "observe" &&
    normalized !== "screenshot"
  ) {
    throw new Error(`VERIFICATION_READ_ONLY_GUARD: ${action} is prohibited.`)
  }
}

function field(observation: ReadOnlyObservation, label: string): string | null {
  return (
    observation.fields.find(
      (item) => item.label.trim().toLowerCase() === label.toLowerCase(),
    )?.value ?? null
  )
}

function isoDate(value: string | null): string | null {
  if (!value || /^(none|not scheduled|—)$/i.test(value.trim())) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf())
    ? value.trim()
    : parsed.toISOString().slice(0, 10)
}

export function normalizeVerificationObservation(
  observation: ReadOnlyObservation,
): NormalizedVerificationState {
  const membership = field(observation, "Membership")?.toLowerCase() ?? ""
  const renew = field(observation, "Auto-renew")?.toLowerCase() ?? ""
  const nextCharge = field(observation, "Next charge")
  const body = observation.visibleText
  const accessMatch = body.match(
    /access remains available until\s+([^\.]+)\.?/i,
  )
  const periodEnd =
    /cancel(?:s|ed|lation) at (?:the )?(?:period|billing) end/i.test(
      `${membership} ${body}`,
    )

  return {
    status: periodEnd
      ? "CANCELS_AT_PERIOD_END"
      : /cancel/.test(membership)
        ? "CANCELED"
        : /active/.test(membership)
          ? "ACTIVE"
          : "UNKNOWN",
    autoRenew: /^(off|no|disabled)$/.test(renew)
      ? false
      : /^(on|yes|enabled)$/.test(renew)
        ? true
        : null,
    nextChargeDate: isoDate(nextCharge),
    nextChargeAmountCents: null,
    accessUntil: isoDate(accessMatch?.[1]?.trim() ?? null),
  }
}

export function evaluateVerificationState(
  state: NormalizedVerificationState,
  visibleText = "",
): PolicyOutcome {
  const lower = visibleText.toLowerCase()
  const loginRequired =
    /sign in|log in|session expired|authentication required/.test(lower)
  const conflict =
    (state.status === "CANCELED" &&
      (state.autoRenew === true ||
        state.nextChargeDate !== null ||
        state.nextChargeAmountCents !== null)) ||
    (state.status === "ACTIVE" &&
      state.autoRenew === false &&
      state.nextChargeDate === null &&
      state.nextChargeAmountCents === null)

  if (loginRequired) {
    return {
      ...state,
      statusResult: "INCONCLUSIVE",
      satisfiedCriteria: [],
      failedCriteria: ["Authenticated billing state was unavailable."],
      explanation:
        "The fresh session could not inspect authenticated billing truth.",
      errorCode: "VERIFICATION_LOGIN_REQUIRED",
    }
  }
  if (conflict) {
    return {
      ...state,
      statusResult: "INCONCLUSIVE",
      satisfiedCriteria: [],
      failedCriteria: ["Visible billing indicators conflict."],
      explanation: "The account page contains conflicting renewal evidence.",
      errorCode: "VERIFICATION_CONFLICTING_EVIDENCE",
    }
  }
  if (
    state.status === "CANCELED" &&
    state.autoRenew === false &&
    state.nextChargeDate === null &&
    state.nextChargeAmountCents === null
  ) {
    return {
      ...state,
      statusResult: "VERIFIED",
      satisfiedCriteria: [
        "Membership is canceled.",
        "Auto-renew is off.",
        "No future charge was found.",
      ],
      failedCriteria: [],
      explanation: "Auto-renew is off and no future charge was found.",
      errorCode: null,
    }
  }
  if (
    state.status === "CANCELS_AT_PERIOD_END" &&
    state.autoRenew === false &&
    state.accessUntil !== null &&
    state.nextChargeDate === null &&
    state.nextChargeAmountCents === null
  ) {
    return {
      ...state,
      statusResult: "VERIFIED",
      satisfiedCriteria: [
        "Cancellation is scheduled for period end.",
        "Auto-renew is off.",
        "Access end is visible.",
        "No future charge was found.",
      ],
      failedCriteria: [],
      explanation:
        "Cancellation is scheduled, auto-renew is off, and no future charge was found.",
      errorCode: null,
    }
  }
  if (
    state.status === "ACTIVE" &&
    (state.autoRenew === true ||
      state.nextChargeDate !== null ||
      state.nextChargeAmountCents !== null)
  ) {
    return {
      ...state,
      statusResult: "NOT_VERIFIED",
      satisfiedCriteria: ["The active billing state was read directly."],
      failedCriteria: ["The account still shows future billing."],
      explanation: "The account still shows future billing.",
      errorCode: "VERIFICATION_NOT_VERIFIED",
    }
  }
  return {
    ...state,
    statusResult: "INCONCLUSIVE",
    satisfiedCriteria: [],
    failedCriteria: [
      "Cancellation and stopped future billing were not both proven.",
    ],
    explanation: "CleanBreak could not prove that future billing stopped.",
    errorCode: "VERIFICATION_INCONCLUSIVE",
  }
}

export function verifyObservation(
  observation: ReadOnlyObservation,
): PolicyOutcome {
  return evaluateVerificationState(
    normalizeVerificationObservation(observation),
    observation.visibleText,
  )
}
