// Shared types for Browser observations, proposals, jobs, and execution records.
export type CancellationJobState =
  | "READY"
  | "NAVIGATING"
  | "AWAITING_APPROVAL"
  | "COMMITTING"
  | "VERIFYING"
  | "VERIFIED"
  | "INCONCLUSIVE"
  | "ABORTED"
  | "FAILED"

export type AgentActionType =
  | "click"
  | "fill"
  | "select"
  | "navigate"
  | "final_cancel_candidate"
  | "needs_human"
  | "failure"

export type ActionRisk =
  | "SAFE_NAVIGATION"
  | "RETENTION_OFFER"
  | "FINAL_CANCELLATION"
  | "ACCOUNT_DELETION"
  | "FINANCIAL_COMMITMENT"
  | "UNKNOWN"

export type PolicyResult = "ALLOW" | "INTERCEPT" | "BLOCK"

export type BrowserDecision = {
  type: AgentActionType
  observationId: string
  targetId: string | null
  value: string | null
  url: string | null
  reasoning: string
  confidence: number | null
  reason: string | null
}

export type ObservationAction = {
  id: string
  role: string
  name: string
  kind: string
  href: string | null
  checked: boolean | null
  value: string | null
}

export type PageObservation = {
  id: string
  observedAt: string
  url: string
  title: string
  headings: string[]
  visibleText: string
  actions: ObservationAction[]
}

export type PolicyDecision = {
  result: PolicyResult
  risk: ActionRisk
  reason: string
  target: ObservationAction | null
}

export type UsageMetrics = {
  inputTokens: number
  outputTokens: number
}

export type PlannerResult = {
  decision: BrowserDecision
  usage: UsageMetrics
}

export type AgentMetrics = {
  steps: number
  retentionsEncountered: number
  retentionsRejected: number
  modelCalls: number
  inputTokens: number
  outputTokens: number
  policyBlocks: number
  unsafeActionsExecuted: 0
  durationMs: number
}

export type ApprovalSnapshot = {
  jobId: string
  subscriptionId: string
  serviceName: string
  serviceDomain: string
  planName: string
  recurringPriceCents: number
  currency: string
  interval: "MONTHLY" | "YEARLY"
  annualSavingsCents: number
  currentStatus: "ACTIVE" | "CANCELED"
  actionText: string
  targetRole: string
  observedUrl: string
  feeCents: number | null
  accessUntil: string | null
  visibleTerms: string[]
  finalScreenshotPath: string | null
  observedAt: string
  proposedActionCreatedAt: string
}

export type ProposedAction = {
  detectedAt: string
  targetRole: string
  targetName: string
  currentUrl: string
  feeCents: number | null
  accessUntil: string | null
  visibleTerms: string[]
  screenshotPath: string | null
  fingerprint: string
  snapshot: ApprovalSnapshot
}

export type Approval = {
  id: string
  jobId: string
  actionFingerprint: string
  approvedAt: string
  status: "APPROVED" | "SUPERSEDED"
}

export type CommitAttempt = {
  id: string
  jobId: string
  approvalId: string | null
  actionFingerprint: string
  armedAt: string
  finalActionAttemptedAt: string | null
  clickStartedAt: string | null
  clickReturnedAt: string | null
  outcome: "CLICK_RETURNED" | "OUTCOME_UNKNOWN" | "NOT_EXECUTED"
  sessionId: string | null
  preScreenshotPath: string | null
  postScreenshotPath: string | null
  recordingStatus: "PENDING" | "AVAILABLE" | "UNAVAILABLE" | "FAILED"
  replayUrl: string | null
  browserReleased: boolean
  clientClosed: boolean
  profileStateSaved: boolean
  safeErrorCode: string | null
  safeErrorMessage: string | null
}

export type VerificationStatus = "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE"
export type NormalizedSubscriptionStatus =
  "ACTIVE" | "CANCELED" | "CANCELS_AT_PERIOD_END" | "UNKNOWN"

export type VerificationEvidence = {
  id: string
  jobId: string
  phase: "VERIFICATION"
  capturedAt: string
  url: string
  title: string
  visibleExcerpt: string
  normalizedState: {
    status: NormalizedSubscriptionStatus
    autoRenew: boolean | null
    nextChargeDate: string | null
    nextChargeAmountCents: number | null
    accessUntil: string | null
  }
  sessionId: string
  screenshotPath: string | null
}

export type VerificationResult = {
  jobId: string
  status: VerificationStatus
  subscriptionStatus: NormalizedSubscriptionStatus
  autoRenew: boolean | null
  nextChargeDate: string | null
  nextChargeAmountCents: number | null
  accessUntil: string | null
  evidence: VerificationEvidence[]
  satisfiedCriteria: string[]
  failedCriteria: string[]
  explanation: string
  verificationSessionId: string
  verifiedAt: string
  targetUrl: string
  recordingStatus: "PENDING" | "AVAILABLE" | "UNAVAILABLE" | "FAILED"
  replayUrl: string | null
  browserReleased: boolean
  clientClosed: boolean
  errorCode: string | null
  errorMessage: string | null
}

export type AgentStep = {
  id: string
  jobId: string
  stepNumber: number
  observationId: string
  observedAt: string
  url: string
  title: string
  actionType: AgentActionType | null
  targetId: string | null
  targetRole: string | null
  targetName: string | null
  reasoning: string | null
  confidence: number | null
  risk: ActionRisk | null
  policyResult: PolicyResult | "ERROR"
  policyReason: string
  screenshotPath: string | null
  durationMs: number
}

export type CancellationJob = AgentMetrics & {
  id: string
  subscriptionId: string
  state: CancellationJobState
  scenario: string
  model: string
  targetUrl: string
  createdAt: string
  completedAt: string | null
  sessionId: string | null
  profileId: string | null
  recordingStatus: "PENDING" | "AVAILABLE" | "UNAVAILABLE" | "FAILED"
  replayUrl: string | null
  latestScreenshotPath: string | null
  browserReleased: boolean
  clientClosed: boolean
  profileStateSaved: boolean
  profileStateSaveSkippedReason?:
    | import("@/lib/solari/profile-persistence").ProfileStateSaveSkippedReason
    | null
  errorCode: string | null
  errorMessage: string | null
  approvalsRequested: number
  approvalsGranted: number
  approvalsAborted: number
  approvalToCommitMs: number | null
  commitAttempts: number
  duplicateCommitRequestsBlocked: number
  staleApprovalsBlocked: number
  changedTermsReapprovalRequired: number
  destructiveClicksExecuted: number
  automaticDestructiveRetries: 0
  commitsWithUnknownOutcome: number
  verificationStartedAt: string | null
  verificationsStarted: number
  verifiedCount: number
  notVerifiedCount: number
  inconclusiveCount: number
  verificationDurationMs: number | null
  verificationSessionCreated: number
  verificationScreenshots: number
  verificationReplayAvailable: number
  falseVerified: 0
  freshSessionMismatchFailures: number
}

export type PublicAgentJob = Omit<
  CancellationJob,
  "latestScreenshotPath" | "steps"
> & {
  steps: number
  latestScreenshotUrl: string | null
  timeline: Array<
    Omit<AgentStep, "screenshotPath"> & { screenshotUrl: string | null }
  >
  proposedAction:
    | (Omit<ProposedAction, "screenshotPath"> & {
        screenshotUrl: string | null
      })
    | null
  approval: Approval | null
  commitAttempt:
    | (Omit<CommitAttempt, "preScreenshotPath" | "postScreenshotPath"> & {
        preScreenshotUrl: string | null
        postScreenshotUrl: string | null
      })
    | null
  verification:
    | (Omit<VerificationResult, "evidence"> & {
        screenshotUrl: string | null
        evidence: Array<
          Omit<VerificationEvidence, "screenshotPath"> & {
            screenshotUrl: string | null
          }
        >
      })
    | null
}
