// Describe the persisted Browser receipt and its evidence fields.
export type ReceiptRecordingStatus =
  "PENDING" | "AVAILABLE" | "UNAVAILABLE" | "FAILED"

export type ReceiptBefore = {
  planName: string
  status: string
  autoRenew: boolean | null
  recurringAmountCents: number
  currency: string
  interval: "MONTHLY" | "YEARLY"
  nextChargeDate: string | null
  url: string
  capturedAt: string
  screenshotUrl: string | null
}

export type ReceiptPayload = {
  canonicalVersion: "1"
  receiptId: string
  jobId: string
  subscriptionId: string
  createdAt: string
  serviceName: string
  serviceDomain: string
  planName: string
  recurringAmountCents: number
  currency: string
  recurringInterval: "MONTHLY" | "YEARLY"
  annualizedSavingsCents: number
  before: ReceiptBefore
  approval: {
    approvedAt: string
    actionName: string
    targetRole: string
    actionFingerprint: string
    visibleTerms: string[]
    feeCents: number | null
    accessUntil: string | null
    screenshotUrl: string | null
  }
  execution: {
    sessionId: string
    attemptId: string
    destructiveClicksExecuted: number
    automaticRetries: number
    outcome: "CLICK_RETURNED" | "OUTCOME_UNKNOWN" | "NOT_EXECUTED"
    armedAt: string
    clickStartedAt: string | null
    clickReturnedAt: string | null
    preScreenshotUrl: string | null
    postScreenshotUrl: string | null
    recordingStatus: ReceiptRecordingStatus
    replayUrl: string | null
  }
  verification: {
    result: "VERIFIED"
    sessionId: string
    freshSession: true
    sameProfileReused: true
    verifiedAt: string
    status: string
    autoRenew: boolean | null
    nextChargeDate: string | null
    nextChargeAmountCents: number | null
    accessUntil: string | null
    satisfiedCriteria: string[]
    explanation: string
    url: string
    screenshotUrl: string | null
    recordingStatus: ReceiptRecordingStatus
    replayUrl: string | null
  }
}

export type CleanBreakReceipt = ReceiptPayload & { sha256: string }

export type BeforeEvidence = Omit<ReceiptBefore, "screenshotUrl">

export type ReceiptGenerationFailure = {
  jobId: string
  attempts: number
  errorCode: string
  errorMessage: string
  failedAt: string
}
