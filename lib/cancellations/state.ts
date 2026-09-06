// Durable one-click workflow. All clocks and observation versions are explicit.
export const states = [
  "AUTHORIZED",
  "CONNECTING",
  "NAVIGATING",
  "CANCELLATION_FLOW",
  "COMMIT_ARMED",
  "COMMITTING",
  "VERIFYING",
  "VERIFIED",
  "NOT_VERIFIED",
  "INCONCLUSIVE",
  "FAILED",
] as const
export type State = (typeof states)[number]
export type Provider = "miro" | "streammax"
export type Scope = {
  provider: Provider
  providerOrigin: string
  subscriptionKey: string // Hash of provider + account URL + plan; no account text.
  sessionBinding: string // Hash of dedicated Desktop ID (or first-party fixture).
  planName: string
  expectedAmountCents: number
  currency: string
  interval: "MONTHLY" | "YEARLY"
  accessPolicy: "PRESERVE_PREPAID_ACCESS"
}
export type Authorization = Scope & {
  id: string
  intent: "CANCEL_SUBSCRIPTION"
  authorizedAt: string
  expiresAt: string
  maxDestructiveActions: 1
}
export type Billing = {
  subscriptionStatus: "ACTIVE" | "CANCELED" | "SCHEDULED" | "UNKNOWN"
  renewalStatus: "ON" | "OFF" | "UNKNOWN"
  nextChargePresent: boolean | null
  nextChargeAmountCents: number | null
  nextChargeDate: string | null
  accessUntil: string | null
}
export type Observation = {
  termsBasis?: "MIRO_FREE_TRIAL_CANCELLATION_DOCUMENTATION"
  evidenceKind?: "DOM" | "DOM_AND_PROVIDER_BILLING"
  evidenceHash?: string
  version: 1
  observedAt: string
  contextId: string
  scope: Scope
  matched: boolean
  identityChecks?: {
    provider: boolean
    page: boolean
    plan: boolean
    currency: boolean
    interval: boolean
  }
  authenticated: boolean
  confidence: number
  surface: "BILLING_PAGE" | "FINAL_CANCELLATION" | "UNKNOWN"
  target:
    | "Cancel subscription"
    | "Cancel trial"
    | "Confirm cancellation"
    | "Cancel now"
    | "End trial"
    | "Yes, cancel"
    | "Complete cancellation"
    | "UNKNOWN"
  x: number
  y: number
  width: number
  height: number
  targetCount: number
  intent: "STOP_FUTURE_RENEWAL" | "OTHER" | "UNKNOWN"
  fee: "NONE" | "PRESENT" | "UNKNOWN"
  newCharge: "NONE" | "PRESENT" | "UNKNOWN"
  access: "THROUGH_TERM" | "IMMEDIATE_LOSS" | "UNKNOWN"
  unrelatedChanges: boolean
  ambiguous: boolean
  billing: Billing
  screenshot: string // Private relative artifact name, never an SDK URL.
  screenshotHash: string
}
export type Verification = {
  result: "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE"
  observation: Observation | null
  contextId: string
  fresh: boolean
  at: string
}
export type Job = {
  recording?: {
    status: "RECORDING" | "AVAILABLE" | "FAILED"
    filename: "cancellation.mp4" | null
    sizeBytes: number
  }
  id: string
  authorization: Authorization
  authorizationStatus: "ARMED" | "CONSUMED" | "EXPIRED"
  state: State
  version: number
  createdAt: string
  updatedAt: string
  reason: string | null // Fixed codes only.
  boundary: Observation | null
  fingerprint: string | null
  navigation: { step: number; stage: string; screenshotHash: string }[]
  verification: Verification | null
  receipt: { payload: Record<string, unknown>; digest: string } | null
  destructiveClicksAttempted: 0 | 1 // Durable reservation, possibly dispatched.
  destructiveClicksExecuted: 0 | 1 // Only an acknowledged click return.
  automaticDestructiveRetries: 0
  unsafeActionsExecuted: 0
  authorizationUses: 0 | 1
}
export const terminal = (s: State) =>
  ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE", "FAILED"].includes(s)
// START -> AUTHORIZED. Recovery edges never return from COMMITTING to a write node.
export const edges: Record<State, readonly State[]> = {
  AUTHORIZED: ["CONNECTING", "FAILED"],
  CONNECTING: ["NAVIGATING", "FAILED"],
  NAVIGATING: ["CANCELLATION_FLOW", "COMMIT_ARMED", "FAILED"],
  CANCELLATION_FLOW: ["COMMIT_ARMED", "FAILED"],
  COMMIT_ARMED: ["COMMITTING", "FAILED"],
  COMMITTING: ["VERIFYING", "INCONCLUSIVE"],
  VERIFYING: ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"],
  VERIFIED: [],
  NOT_VERIFIED: [],
  INCONCLUSIVE: [],
  FAILED: [],
}
