export type BenchmarkVerificationResult =
  "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE" | null

export type BenchmarkRun = {
  runId: string
  scenario: string
  startedAt: string
  completedAt: string
  expectedOutcome: string
  actualOutcome: string
  passed: boolean
  agentSteps: number
  plannerCalls: number
  retentionScreensEncountered: number
  retentionOffersRejected: number
  approvalRequired: boolean
  approvalGranted: boolean
  destructiveClicks: number
  automaticDestructiveRetries: number
  verificationResult: BenchmarkVerificationResult
  authoritativeStatus: string | null
  authoritativeAutoRenew: boolean | null
  authoritativeNextCharge: string | null
  falseVerified: boolean
  receiptCreated: boolean
  receiptIntegrityValid: boolean | null
  annualizedVerifiedSavingsCents: number
  policyBlocks: number
  unsafeActionsExecuted: number
  finalActionsAttemptedWithoutApproval: number
  retentionOffersAccepted: number
  accountDeletionsExecuted: number
  externalNavigationExecuted: number
  duplicateDestructiveClicks: number
  freshSessionViolations: number
  loopsDetected: number
  lowConfidenceStops: number
  timeToBoundaryMs: number | null
  approvalToCommitMs: number | null
  commitToVerificationMs: number | null
  durationMs: number
  errorCode: string | null
}

export type Distribution = {
  mean: number
  median: number
  p95: number
}

export type ScenarioResult = {
  runs: number
  passed: number
  passRate: number
  meanAgentSteps: number
  retentionOffersEncountered: number
  retentionOffersRejected: number
  destructiveClicks: number
  automaticRetries: number
  verified: number
  notVerified: number
  inconclusive: number
  falseVerified: number
  receiptsCreated: number
}

export type LiveValidation = {
  performed: boolean
  scenario: string | null
  model: string | null
  agentSteps: number | null
  retentionOffersRejected: number | null
  destructiveClicks: number | null
  automaticDestructiveRetries: number | null
  executionAndVerificationSessionsDiffered: boolean | null
  verificationResult: BenchmarkVerificationResult
  falseVerified: number | null
  receiptGenerated: boolean | null
}

export type BenchmarkResults = {
  generatedAt: string
  benchmarkVersion: "1"
  seed: number
  timingEnvironment: "local deterministic adapters; wall-clock process timing"
  totalRuns: number
  passedRuns: number
  failedRuns: number
  passRate: number
  verifiedRuns: number
  notVerifiedRuns: number
  inconclusiveRuns: number
  falseVerified: number
  unsafeActionsExecuted: number
  automaticDestructiveRetries: number
  totalDestructiveClicks: number
  retentionScreensEncountered: number
  retentionOffersRejected: number
  meanAgentSteps: number
  medianAgentSteps: number
  p95AgentSteps: number
  meanDurationMs: number
  medianDurationMs: number
  p95DurationMs: number
  humanApprovalsRequired: number
  receiptsCreated: number
  totalVerifiedAnnualSavingsCents: number
  challengeMetrics: {
    benchmarkPassRate: number
    humanActionsRequired: number
    retentionResistance: number
    verificationCoverage: number
    receiptCoverage: number
  }
  timing: {
    timeToBoundaryMs: Distribution
    approvalToCommitMs: Distribution
    commitToVerificationMs: Distribution
    totalJobDurationMs: Distribution
  }
  agent: {
    totalSteps: number
    totalPlannerCalls: number
    loopsDetected: number
    lowConfidenceStops: number
    policyBlocks: number
    darkPatternAgentSteps: Distribution
  }
  safety: {
    finalActionsAttemptedWithoutApproval: number
    retentionOffersAccepted: number
    accountDeletionsExecuted: number
    externalNavigationExecuted: number
    duplicateDestructiveClicks: number
  }
  verification: {
    runs: number
    verified: number
    notVerified: number
    inconclusive: number
    falseVerified: number
    freshSessionViolations: number
    reportedSuccesses: number
    verifiedSuccesses: number
  }
  receipts: {
    verifiedJobs: number
    receiptsCreated: number
    receiptGenerationFailures: number
    receiptIntegrityFailures: number
  }
  scenarioResults: Record<string, ScenarioResult>
  liveValidation: LiveValidation
  runs: BenchmarkRun[]
}
