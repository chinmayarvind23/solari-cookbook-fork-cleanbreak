// Store Browser jobs, approvals, action history, and verification records.
import type { DatabaseSync, SQLInputValue } from "node:sqlite"

import { getDatabase } from "@/lib/db"
import type {
  AgentStep,
  Approval,
  CancellationJob,
  CommitAttempt,
  ProposedAction,
  PublicAgentJob,
  VerificationEvidence,
  VerificationResult,
} from "@/lib/agent/types"

type Row = Record<string, unknown>

const jobColumns: Record<keyof CancellationJob, string> = {
  id: "id",
  subscriptionId: "subscription_id",
  state: "state",
  scenario: "scenario",
  model: "model",
  targetUrl: "target_url",
  createdAt: "created_at",
  completedAt: "completed_at",
  sessionId: "session_id",
  profileId: "profile_id",
  recordingStatus: "recording_status",
  replayUrl: "replay_url",
  latestScreenshotPath: "latest_screenshot_path",
  steps: "steps",
  retentionsEncountered: "retentions_encountered",
  retentionsRejected: "retentions_rejected",
  modelCalls: "model_calls",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  policyBlocks: "policy_blocks",
  unsafeActionsExecuted: "unsafe_actions_executed",
  durationMs: "duration_ms",
  browserReleased: "browser_released",
  clientClosed: "client_closed",
  profileStateSaved: "profile_state_saved",
  profileStateSaveSkippedReason: "profile_state_save_skipped_reason",
  errorCode: "error_code",
  errorMessage: "error_message",
  approvalsRequested: "approvals_requested",
  approvalsGranted: "approvals_granted",
  approvalsAborted: "approvals_aborted",
  approvalToCommitMs: "approval_to_commit_ms",
  commitAttempts: "commit_attempts",
  duplicateCommitRequestsBlocked: "duplicate_commit_requests_blocked",
  staleApprovalsBlocked: "stale_approvals_blocked",
  changedTermsReapprovalRequired: "changed_terms_reapproval_required",
  destructiveClicksExecuted: "destructive_clicks_executed",
  automaticDestructiveRetries: "automatic_destructive_retries",
  commitsWithUnknownOutcome: "commits_with_unknown_outcome",
  verificationStartedAt: "verification_started_at",
  verificationsStarted: "verifications_started",
  verifiedCount: "verified_count",
  notVerifiedCount: "not_verified_count",
  inconclusiveCount: "inconclusive_count",
  verificationDurationMs: "verification_duration_ms",
  verificationSessionCreated: "verification_session_created",
  verificationScreenshots: "verification_screenshots",
  verificationReplayAvailable: "verification_replay_available",
  falseVerified: "false_verified",
  freshSessionMismatchFailures: "fresh_session_mismatch_failures",
}

function databaseValue(value: unknown): SQLInputValue {
  if (typeof value === "boolean") return Number(value)
  if (value === undefined) return null
  return value as SQLInputValue
}

function jobFrom(row: Row): CancellationJob {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    state: row.state as CancellationJob["state"],
    scenario: String(row.scenario),
    model: String(row.model),
    targetUrl: String(row.target_url),
    createdAt: String(row.created_at),
    completedAt: (row.completed_at as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    profileId: (row.profile_id as string | null) ?? null,
    recordingStatus: row.recording_status as CancellationJob["recordingStatus"],
    replayUrl: (row.replay_url as string | null) ?? null,
    latestScreenshotPath: (row.latest_screenshot_path as string | null) ?? null,
    steps: Number(row.steps),
    retentionsEncountered: Number(row.retentions_encountered),
    retentionsRejected: Number(row.retentions_rejected),
    modelCalls: Number(row.model_calls),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    policyBlocks: Number(row.policy_blocks),
    unsafeActionsExecuted: 0,
    durationMs: Number(row.duration_ms ?? 0),
    browserReleased: Boolean(row.browser_released),
    clientClosed: Boolean(row.client_closed),
    profileStateSaved: Boolean(row.profile_state_saved),
    profileStateSaveSkippedReason:
      (row.profile_state_save_skipped_reason as CancellationJob["profileStateSaveSkippedReason"]) ??
      null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    approvalsRequested: Number(row.approvals_requested ?? 0),
    approvalsGranted: Number(row.approvals_granted ?? 0),
    approvalsAborted: Number(row.approvals_aborted ?? 0),
    approvalToCommitMs: (row.approval_to_commit_ms as number | null) ?? null,
    commitAttempts: Number(row.commit_attempts ?? 0),
    duplicateCommitRequestsBlocked: Number(
      row.duplicate_commit_requests_blocked ?? 0,
    ),
    staleApprovalsBlocked: Number(row.stale_approvals_blocked ?? 0),
    changedTermsReapprovalRequired: Number(
      row.changed_terms_reapproval_required ?? 0,
    ),
    destructiveClicksExecuted: Number(row.destructive_clicks_executed ?? 0),
    automaticDestructiveRetries: 0,
    commitsWithUnknownOutcome: Number(row.commits_with_unknown_outcome ?? 0),
    verificationStartedAt:
      (row.verification_started_at as string | null) ?? null,
    verificationsStarted: Number(row.verifications_started ?? 0),
    verifiedCount: Number(row.verified_count ?? 0),
    notVerifiedCount: Number(row.not_verified_count ?? 0),
    inconclusiveCount: Number(row.inconclusive_count ?? 0),
    verificationDurationMs:
      (row.verification_duration_ms as number | null) ?? null,
    verificationSessionCreated: Number(row.verification_session_created ?? 0),
    verificationScreenshots: Number(row.verification_screenshots ?? 0),
    verificationReplayAvailable: Number(row.verification_replay_available ?? 0),
    falseVerified: 0,
    freshSessionMismatchFailures: Number(
      row.fresh_session_mismatch_failures ?? 0,
    ),
  }
}

function evidenceFrom(row: Row): VerificationEvidence {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    phase: "VERIFICATION",
    capturedAt: String(row.captured_at),
    url: String(row.url),
    title: String(row.title),
    visibleExcerpt: String(row.visible_excerpt),
    normalizedState: JSON.parse(String(row.normalized_state_json)),
    sessionId: String(row.session_id),
    screenshotPath: (row.screenshot_path as string | null) ?? null,
  }
}

function verificationFrom(
  row: Row,
  evidence: VerificationEvidence[],
): VerificationResult {
  return {
    jobId: String(row.job_id),
    status: row.status as VerificationResult["status"],
    subscriptionStatus:
      row.subscription_status as VerificationResult["subscriptionStatus"],
    autoRenew: row.auto_renew === null ? null : Boolean(row.auto_renew),
    nextChargeDate: (row.next_charge_date as string | null) ?? null,
    nextChargeAmountCents:
      (row.next_charge_amount_cents as number | null) ?? null,
    accessUntil: (row.access_until as string | null) ?? null,
    evidence,
    satisfiedCriteria: JSON.parse(String(row.satisfied_criteria_json)),
    failedCriteria: JSON.parse(String(row.failed_criteria_json)),
    explanation: String(row.explanation),
    verificationSessionId: String(row.verification_session_id),
    verifiedAt: String(row.verified_at),
    targetUrl: String(row.target_url),
    recordingStatus:
      row.recording_status as VerificationResult["recordingStatus"],
    replayUrl: (row.replay_url as string | null) ?? null,
    browserReleased: Boolean(row.browser_released),
    clientClosed: Boolean(row.client_closed),
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  }
}

function approvalFrom(row: Row): Approval {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    actionFingerprint: String(row.action_fingerprint),
    approvedAt: String(row.approved_at),
    status: row.status as Approval["status"],
  }
}

function attemptFrom(row: Row): CommitAttempt {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    approvalId: (row.approval_id as string | null) ?? null,
    actionFingerprint: String(row.action_fingerprint),
    armedAt: String(row.armed_at),
    finalActionAttemptedAt:
      (row.final_action_attempted_at as string | null) ?? null,
    clickStartedAt: (row.click_started_at as string | null) ?? null,
    clickReturnedAt: (row.click_returned_at as string | null) ?? null,
    outcome: row.outcome as CommitAttempt["outcome"],
    sessionId: (row.session_id as string | null) ?? null,
    preScreenshotPath: (row.pre_screenshot_path as string | null) ?? null,
    postScreenshotPath: (row.post_screenshot_path as string | null) ?? null,
    recordingStatus: row.recording_status as CommitAttempt["recordingStatus"],
    replayUrl: (row.replay_url as string | null) ?? null,
    browserReleased: Boolean(row.browser_released),
    clientClosed: Boolean(row.client_closed),
    profileStateSaved: Boolean(row.profile_state_saved),
    safeErrorCode: (row.safe_error_code as string | null) ?? null,
    safeErrorMessage: (row.safe_error_message as string | null) ?? null,
  }
}

function stepFrom(row: Row): AgentStep {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    stepNumber: Number(row.step_number),
    observationId: String(row.observation_id),
    observedAt: String(row.observed_at),
    url: String(row.url),
    title: String(row.title),
    actionType: (row.action_type as AgentStep["actionType"]) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    targetRole: (row.target_role as string | null) ?? null,
    targetName: (row.target_name as string | null) ?? null,
    reasoning: (row.reasoning as string | null) ?? null,
    confidence: (row.confidence as number | null) ?? null,
    risk: (row.risk as AgentStep["risk"]) ?? null,
    policyResult: row.policy_result as AgentStep["policyResult"],
    policyReason: String(row.policy_reason),
    screenshotPath: (row.screenshot_path as string | null) ?? null,
    durationMs: Number(row.duration_ms),
  }
}

export function createAgentRepository(database: DatabaseSync = getDatabase()) {
  return {
    createJob(job: CancellationJob) {
      const keys = Object.keys(jobColumns) as Array<keyof CancellationJob>
      database
        .prepare(
          `INSERT INTO cancellation_jobs (${keys.map((key) => jobColumns[key]).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        )
        .run(...keys.map((key) => databaseValue(job[key])))
    },
    updateJob(id: string, patch: Partial<Omit<CancellationJob, "id">>) {
      const keys = Object.keys(patch) as Array<keyof typeof patch>
      if (!keys.length) return
      database
        .prepare(
          `UPDATE cancellation_jobs SET ${keys.map((key) => `${jobColumns[key as keyof CancellationJob]} = ?`).join(", ")} WHERE id = ?`,
        )
        .run(...keys.map((key) => databaseValue(patch[key])), id)
    },
    getJob(id: string): CancellationJob | null {
      const row = database
        .prepare("SELECT * FROM cancellation_jobs WHERE id = ?")
        .get(id) as Row | undefined
      return row ? jobFrom(row) : null
    },
    getLatestJob(): CancellationJob | null {
      const row = database
        .prepare(
          "SELECT * FROM cancellation_jobs ORDER BY created_at DESC LIMIT 1",
        )
        .get() as Row | undefined
      return row ? jobFrom(row) : null
    },
    beginVerification(jobId: string, startedAt: string): boolean {
      const result = database
        .prepare(
          `UPDATE cancellation_jobs
           SET verification_started_at = ?, verifications_started = verifications_started + 1
           WHERE id = ? AND state = 'VERIFYING' AND verification_started_at IS NULL`,
        )
        .run(startedAt, jobId)
      return result.changes === 1
    },
    markVerificationSessionCreated(jobId: string): void {
      database
        .prepare(
          `UPDATE cancellation_jobs SET verification_session_created = 1 WHERE id = ?`,
        )
        .run(jobId)
    },
    getVerificationEvidence(jobId: string): VerificationEvidence[] {
      return (
        database
          .prepare(
            `SELECT * FROM verification_evidence WHERE job_id = ? ORDER BY captured_at`,
          )
          .all(jobId) as Row[]
      ).map(evidenceFrom)
    },
    getVerification(jobId: string): VerificationResult | null {
      const row = database
        .prepare("SELECT * FROM verification_results WHERE job_id = ?")
        .get(jobId) as Row | undefined
      return row
        ? verificationFrom(row, this.getVerificationEvidence(jobId))
        : null
    },
    finishVerification(options: {
      result: VerificationResult
      evidence: VerificationEvidence | null
      durationMs: number
      freshSessionMismatch: boolean
    }): void {
      const { result, evidence, durationMs, freshSessionMismatch } = options
      database.exec("BEGIN IMMEDIATE")
      try {
        if (evidence) {
          database
            .prepare(
              `INSERT INTO verification_evidence (
                id, job_id, phase, captured_at, url, title, visible_excerpt,
                normalized_state_json, session_id, screenshot_path
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              evidence.id,
              evidence.jobId,
              evidence.phase,
              evidence.capturedAt,
              evidence.url,
              evidence.title,
              evidence.visibleExcerpt,
              JSON.stringify(evidence.normalizedState),
              evidence.sessionId,
              evidence.screenshotPath,
            )
        }
        database
          .prepare(
            `INSERT INTO verification_results (
              job_id, status, subscription_status, auto_renew, next_charge_date,
              next_charge_amount_cents, access_until, satisfied_criteria_json,
              failed_criteria_json, explanation, verification_session_id,
              verified_at, target_url, recording_status, replay_url,
              browser_released, client_closed, error_code, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            result.jobId,
            result.status,
            result.subscriptionStatus,
            result.autoRenew === null ? null : Number(result.autoRenew),
            result.nextChargeDate,
            result.nextChargeAmountCents,
            result.accessUntil,
            JSON.stringify(result.satisfiedCriteria),
            JSON.stringify(result.failedCriteria),
            result.explanation,
            result.verificationSessionId,
            result.verifiedAt,
            result.targetUrl,
            result.recordingStatus,
            result.replayUrl,
            Number(result.browserReleased),
            Number(result.clientClosed),
            result.errorCode,
            result.errorMessage,
          )
        const state =
          result.status === "VERIFIED"
            ? "VERIFIED"
            : result.status === "INCONCLUSIVE"
              ? "INCONCLUSIVE"
              : "FAILED"
        database
          .prepare(
            `UPDATE cancellation_jobs SET
              state = ?, completed_at = ?, error_code = ?, error_message = ?,
              verification_duration_ms = ?, verified_count = verified_count + ?,
              not_verified_count = not_verified_count + ?,
              inconclusive_count = inconclusive_count + ?,
              verification_screenshots = verification_screenshots + ?,
              verification_replay_available = verification_replay_available + ?,
              fresh_session_mismatch_failures = fresh_session_mismatch_failures + ?
             WHERE id = ? AND state = 'VERIFYING'`,
          )
          .run(
            state,
            result.verifiedAt,
            result.errorCode,
            result.errorMessage,
            durationMs,
            Number(result.status === "VERIFIED"),
            Number(result.status === "NOT_VERIFIED"),
            Number(result.status === "INCONCLUSIVE"),
            Number(Boolean(evidence?.screenshotPath)),
            Number(Boolean(result.replayUrl)),
            Number(freshSessionMismatch),
            result.jobId,
          )
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    getVerifiedAnnualSavingsCents(): number {
      const row = database
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN s.interval = 'MONTHLY'
                    THEN s.amount_cents * 12 ELSE s.amount_cents END), 0) total
           FROM subscriptions s
           WHERE EXISTS (SELECT 1 FROM cancellation_jobs j
             WHERE j.subscription_id = s.id AND j.state = 'VERIFIED')`,
        )
        .get() as { total: number }
      return Number(row.total)
    },
    addStep(step: AgentStep) {
      database
        .prepare(
          `INSERT INTO agent_steps (
            id, job_id, step_number, observation_id, observed_at, url, title,
            action_type, target_id, target_role, target_name, reasoning,
            confidence, risk, policy_result, policy_reason, screenshot_path, duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          step.id,
          step.jobId,
          step.stepNumber,
          step.observationId,
          step.observedAt,
          step.url,
          step.title,
          step.actionType,
          step.targetId,
          step.targetRole,
          step.targetName,
          step.reasoning,
          step.confidence,
          step.risk,
          step.policyResult,
          step.policyReason,
          step.screenshotPath,
          step.durationMs,
        )
    },
    getSteps(jobId: string): AgentStep[] {
      return (
        database
          .prepare(
            "SELECT * FROM agent_steps WHERE job_id = ? ORDER BY step_number",
          )
          .all(jobId) as Row[]
      ).map(stepFrom)
    },
    saveProposedAction(jobId: string, action: ProposedAction) {
      database
        .prepare(
          `INSERT OR REPLACE INTO proposed_actions (
            job_id, detected_at, target_role, target_name, current_url,
            fee_cents, access_until, visible_terms_json, screenshot_path,
            fingerprint, service_name, service_domain, plan_name,
            recurring_price_cents, currency, interval, annual_savings_cents,
            current_status, action_text, observed_at, snapshot_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          jobId,
          action.detectedAt,
          action.targetRole,
          action.targetName,
          action.currentUrl,
          action.feeCents,
          action.accessUntil,
          JSON.stringify(action.visibleTerms),
          action.screenshotPath,
          action.fingerprint,
          action.snapshot.serviceName,
          action.snapshot.serviceDomain,
          action.snapshot.planName,
          action.snapshot.recurringPriceCents,
          action.snapshot.currency,
          action.snapshot.interval,
          action.snapshot.annualSavingsCents,
          action.snapshot.currentStatus,
          action.snapshot.actionText,
          action.snapshot.observedAt,
          JSON.stringify(action.snapshot),
        )
    },
    getProposedAction(jobId: string): ProposedAction | null {
      const row = database
        .prepare("SELECT * FROM proposed_actions WHERE job_id = ?")
        .get(jobId) as Row | undefined
      return row && row.fingerprint && row.snapshot_json
        ? {
            detectedAt: String(row.detected_at),
            targetRole: String(row.target_role),
            targetName: String(row.target_name),
            currentUrl: String(row.current_url),
            feeCents: (row.fee_cents as number | null) ?? null,
            accessUntil: (row.access_until as string | null) ?? null,
            visibleTerms: JSON.parse(
              String(row.visible_terms_json),
            ) as string[],
            screenshotPath: (row.screenshot_path as string | null) ?? null,
            fingerprint: String(row.fingerprint),
            snapshot: JSON.parse(String(row.snapshot_json)),
          }
        : null
    },
    getLatestApproval(jobId: string): Approval | null {
      const row = database
        .prepare(
          "SELECT * FROM approvals WHERE job_id = ? ORDER BY approved_at DESC LIMIT 1",
        )
        .get(jobId) as Row | undefined
      return row ? approvalFrom(row) : null
    },
    getCommitAttempt(jobId: string): CommitAttempt | null {
      const row = database
        .prepare("SELECT * FROM commit_attempts WHERE job_id = ?")
        .get(jobId) as Row | undefined
      return row ? attemptFrom(row) : null
    },
    authorizeApproval(options: {
      jobId: string
      fingerprint: string
      approvalId: string
      approvedAt: string
    }):
      | { result: "APPROVED" | "EXISTING"; approval: Approval }
      | {
          result: "REJECTED" | "STALE" | "FEE" | "DUPLICATE"
          code: string
        } {
      database.exec("BEGIN IMMEDIATE")
      try {
        const job = database
          .prepare("SELECT * FROM cancellation_jobs WHERE id = ?")
          .get(options.jobId) as Row | undefined
        if (!job) {
          database.exec("ROLLBACK")
          return { result: "REJECTED", code: "JOB_NOT_FOUND" }
        }
        database
          .prepare(
            "UPDATE cancellation_jobs SET approvals_requested = approvals_requested + 1 WHERE id = ?",
          )
          .run(options.jobId)
        if (["COMMITTING", "VERIFYING"].includes(String(job.state))) {
          database
            .prepare(
              "UPDATE cancellation_jobs SET duplicate_commit_requests_blocked = duplicate_commit_requests_blocked + 1 WHERE id = ?",
            )
            .run(options.jobId)
          database.exec("COMMIT")
          return { result: "DUPLICATE", code: "COMMIT_ALREADY_ARMED" }
        }
        if (job.state !== "AWAITING_APPROVAL") {
          database.exec("COMMIT")
          return { result: "REJECTED", code: `JOB_${String(job.state)}` }
        }
        const proposal = database
          .prepare("SELECT * FROM proposed_actions WHERE job_id = ?")
          .get(options.jobId) as Row | undefined
        if (!proposal || proposal.fingerprint !== options.fingerprint) {
          database
            .prepare(
              "UPDATE cancellation_jobs SET stale_approvals_blocked = stale_approvals_blocked + 1 WHERE id = ?",
            )
            .run(options.jobId)
          database.exec("COMMIT")
          return { result: "STALE", code: "STALE_APPROVAL_FINGERPRINT" }
        }
        if (proposal.fee_cents === null || Number(proposal.fee_cents) !== 0) {
          database.exec("COMMIT")
          return { result: "FEE", code: "CANCELLATION_FEE_REQUIRES_HUMAN" }
        }
        const existingRow = database
          .prepare(
            "SELECT * FROM approvals WHERE job_id = ? AND action_fingerprint = ?",
          )
          .get(options.jobId, options.fingerprint) as Row | undefined
        if (existingRow) {
          database.exec("COMMIT")
          return { result: "EXISTING", approval: approvalFrom(existingRow) }
        }
        database
          .prepare(
            `INSERT INTO approvals (
              id, job_id, action_fingerprint, approved_at, status
            ) VALUES (?, ?, ?, ?, 'APPROVED')`,
          )
          .run(
            options.approvalId,
            options.jobId,
            options.fingerprint,
            options.approvedAt,
          )
        database
          .prepare(
            "UPDATE cancellation_jobs SET approvals_granted = approvals_granted + 1 WHERE id = ?",
          )
          .run(options.jobId)
        database.exec("COMMIT")
        return {
          result: "APPROVED",
          approval: {
            id: options.approvalId,
            jobId: options.jobId,
            actionFingerprint: options.fingerprint,
            approvedAt: options.approvedAt,
            status: "APPROVED",
          },
        }
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    abortJob(jobId: string, fingerprint: string, completedAt: string): boolean {
      database.exec("BEGIN IMMEDIATE")
      try {
        const job = database
          .prepare("SELECT state FROM cancellation_jobs WHERE id = ?")
          .get(jobId) as Row | undefined
        if (!job) {
          database.exec("ROLLBACK")
          return false
        }
        const proposal = database
          .prepare("SELECT fingerprint FROM proposed_actions WHERE job_id = ?")
          .get(jobId) as Row | undefined
        if (proposal?.fingerprint !== fingerprint) {
          database.exec("COMMIT")
          return false
        }
        if (job.state === "ABORTED") {
          database.exec("COMMIT")
          return true
        }
        if (job.state !== "AWAITING_APPROVAL") {
          database.exec("COMMIT")
          return false
        }
        database
          .prepare(
            `UPDATE cancellation_jobs
             SET state = 'ABORTED', completed_at = ?,
                 approvals_aborted = approvals_aborted + 1,
                 error_code = 'APPROVAL_ABORTED',
                 error_message = 'The user aborted before the final action.'
             WHERE id = ? AND state = 'AWAITING_APPROVAL'`,
          )
          .run(completedAt, jobId)
        database.exec("COMMIT")
        return true
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    markTermsChanged(jobId: string): void {
      database.exec("BEGIN IMMEDIATE")
      try {
        database
          .prepare(
            "UPDATE approvals SET status = 'SUPERSEDED' WHERE job_id = ? AND status = 'APPROVED'",
          )
          .run(jobId)
        database
          .prepare(
            `UPDATE cancellation_jobs
             SET changed_terms_reapproval_required = changed_terms_reapproval_required + 1,
                 error_code = 'TERMS_CHANGED_REAPPROVAL_REQUIRED',
                 error_message = 'Cancellation terms changed. Review and approve the new proposal.'
             WHERE id = ? AND state = 'AWAITING_APPROVAL'`,
          )
          .run(jobId)
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    armCommit(options: {
      jobId: string
      approval: Approval
      attemptId: string
      armedAt: string
      sessionId: string
    }): CommitAttempt | null {
      database.exec("BEGIN IMMEDIATE")
      try {
        const proposal = database
          .prepare("SELECT fingerprint FROM proposed_actions WHERE job_id = ?")
          .get(options.jobId) as Row | undefined
        const approvalRow = database
          .prepare(
            "SELECT status, action_fingerprint FROM approvals WHERE id = ? AND job_id = ?",
          )
          .get(options.approval.id, options.jobId) as Row | undefined
        const elapsed = Math.max(
          0,
          Date.parse(options.armedAt) - Date.parse(options.approval.approvedAt),
        )
        const updated = database
          .prepare(
            `UPDATE cancellation_jobs
             SET state = 'COMMITTING', commit_attempts = commit_attempts + 1,
                 approval_to_commit_ms = ?, error_code = NULL, error_message = NULL
             WHERE id = ? AND state = 'AWAITING_APPROVAL'`,
          )
          .run(elapsed, options.jobId)
        if (
          updated.changes !== 1 ||
          proposal?.fingerprint !== options.approval.actionFingerprint ||
          approvalRow?.status !== "APPROVED" ||
          approvalRow.action_fingerprint !== options.approval.actionFingerprint
        ) {
          if (updated.changes === 1) {
            throw new Error("The approved action changed during commit arming.")
          }
          database
            .prepare(
              "UPDATE cancellation_jobs SET duplicate_commit_requests_blocked = duplicate_commit_requests_blocked + 1 WHERE id = ?",
            )
            .run(options.jobId)
          database.exec("COMMIT")
          return null
        }
        database
          .prepare(
            `INSERT INTO commit_attempts (
              id, job_id, approval_id, action_fingerprint, armed_at,
              final_action_attempted_at, outcome, session_id
            ) VALUES (?, ?, ?, ?, ?, ?, 'OUTCOME_UNKNOWN', ?)`,
          )
          .run(
            options.attemptId,
            options.jobId,
            options.approval.id,
            options.approval.actionFingerprint,
            options.armedAt,
            options.armedAt,
            options.sessionId,
          )
        database.exec("COMMIT")
        const row = database
          .prepare("SELECT * FROM commit_attempts WHERE job_id = ?")
          .get(options.jobId) as Row
        return attemptFrom(row)
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    recordNoExecution(options: {
      jobId: string
      approval: Approval
      attemptId: string
      at: string
      sessionId: string
      reason: string
    }): boolean {
      database.exec("BEGIN IMMEDIATE")
      try {
        const proposal = database
          .prepare("SELECT fingerprint FROM proposed_actions WHERE job_id = ?")
          .get(options.jobId) as Row | undefined
        const approvalRow = database
          .prepare(
            "SELECT status, action_fingerprint FROM approvals WHERE id = ? AND job_id = ?",
          )
          .get(options.approval.id, options.jobId) as Row | undefined
        if (
          proposal?.fingerprint !== options.approval.actionFingerprint ||
          approvalRow?.status !== "APPROVED" ||
          approvalRow.action_fingerprint !== options.approval.actionFingerprint
        ) {
          database.exec("COMMIT")
          return false
        }
        const updated = database
          .prepare(
            `UPDATE cancellation_jobs
             SET state = 'VERIFYING', completed_at = ?,
                 commit_attempts = commit_attempts + 1,
                 error_code = 'FINAL_ACTION_NOT_NEEDED', error_message = ?
             WHERE id = ? AND state = 'AWAITING_APPROVAL'`,
          )
          .run(options.at, options.reason, options.jobId)
        if (updated.changes !== 1) {
          database.exec("COMMIT")
          return false
        }
        database
          .prepare(
            `INSERT INTO commit_attempts (
              id, job_id, approval_id, action_fingerprint, armed_at,
              outcome, session_id, safe_error_code, safe_error_message
            ) VALUES (?, ?, ?, ?, ?, 'NOT_EXECUTED', ?, 'FINAL_ACTION_NOT_NEEDED', ?)`,
          )
          .run(
            options.attemptId,
            options.jobId,
            options.approval.id,
            options.approval.actionFingerprint,
            options.at,
            options.sessionId,
            options.reason,
          )
        database.exec("COMMIT")
        return true
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    updateCommitAttempt(
      jobId: string,
      patch: Partial<Omit<CommitAttempt, "id" | "jobId">>,
    ): void {
      const columns: Partial<Record<keyof CommitAttempt, string>> = {
        clickStartedAt: "click_started_at",
        clickReturnedAt: "click_returned_at",
        outcome: "outcome",
        preScreenshotPath: "pre_screenshot_path",
        postScreenshotPath: "post_screenshot_path",
        recordingStatus: "recording_status",
        replayUrl: "replay_url",
        browserReleased: "browser_released",
        clientClosed: "client_closed",
        profileStateSaved: "profile_state_saved",
        safeErrorCode: "safe_error_code",
        safeErrorMessage: "safe_error_message",
      }
      const keys = Object.keys(patch).filter(
        (key) => columns[key as keyof CommitAttempt],
      ) as Array<keyof Omit<CommitAttempt, "id" | "jobId">>
      if (!keys.length) return
      database
        .prepare(
          `UPDATE commit_attempts SET ${keys
            .map((key) => `${columns[key]} = ?`)
            .join(", ")} WHERE job_id = ?`,
        )
        .run(...keys.map((key) => databaseValue(patch[key])), jobId)
    },
    markClickStarted(jobId: string, at: string): void {
      database.exec("BEGIN IMMEDIATE")
      try {
        const updated = database
          .prepare(
            `UPDATE commit_attempts SET click_started_at = ?
             WHERE job_id = ? AND click_started_at IS NULL`,
          )
          .run(at, jobId)
        if (updated.changes !== 1) {
          throw new Error("The destructive click was already started.")
        }
        const jobUpdated = database
          .prepare(
            `UPDATE cancellation_jobs
             SET destructive_clicks_executed = destructive_clicks_executed + 1
             WHERE id = ? AND state = 'COMMITTING' AND destructive_clicks_executed = 0`,
          )
          .run(jobId)
        if (jobUpdated.changes !== 1) {
          throw new Error("The cancellation job was not armed for one click.")
        }
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    finishCommit(options: {
      jobId: string
      at: string
      outcome: "CLICK_RETURNED" | "OUTCOME_UNKNOWN"
      errorCode?: string | null
      errorMessage?: string | null
    }): void {
      database.exec("BEGIN IMMEDIATE")
      try {
        database
          .prepare(
            `UPDATE commit_attempts
             SET outcome = ?, safe_error_code = ?, safe_error_message = ?
             WHERE job_id = ?`,
          )
          .run(
            options.outcome,
            options.errorCode ?? null,
            options.errorMessage ?? null,
            options.jobId,
          )
        database
          .prepare(
            `UPDATE cancellation_jobs
             SET state = 'VERIFYING', completed_at = ?, error_code = ?, error_message = ?,
                 commits_with_unknown_outcome = commits_with_unknown_outcome + ?
             WHERE id = ? AND state = 'COMMITTING'`,
          )
          .run(
            options.at,
            options.errorCode ?? null,
            options.errorMessage ?? null,
            Number(options.outcome === "OUTCOME_UNKNOWN"),
            options.jobId,
          )
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
    recoverArmedCommit(jobId: string, at: string): boolean {
      database.exec("BEGIN IMMEDIATE")
      try {
        const marker = database
          .prepare(
            `SELECT final_action_attempted_at, click_returned_at FROM commit_attempts
             WHERE job_id = ?`,
          )
          .get(jobId) as Row | undefined
        if (!marker?.final_action_attempted_at) {
          database.exec("COMMIT")
          return false
        }
        const unknown = Number(!marker.click_returned_at)
        const updated = database
          .prepare(
            `UPDATE cancellation_jobs
             SET state = 'VERIFYING', completed_at = ?,
                 error_code = 'RECOVERED_ARMED_COMMIT',
                 error_message = 'A prior final-action attempt may have run. Automatic retry is prohibited.',
                 commits_with_unknown_outcome = commits_with_unknown_outcome + ?
             WHERE id = ? AND state = 'COMMITTING'`,
          )
          .run(at, unknown, jobId)
        database
          .prepare(
            `UPDATE commit_attempts
             SET outcome = CASE WHEN click_returned_at IS NULL THEN 'OUTCOME_UNKNOWN' ELSE outcome END,
                 safe_error_code = 'RECOVERED_ARMED_COMMIT',
                 safe_error_message = 'A prior final-action attempt may have run. Automatic retry is prohibited.'
             WHERE job_id = ?`,
          )
          .run(jobId)
        database.exec("COMMIT")
        return updated.changes === 1
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
  }
}

export type AgentRepository = ReturnType<typeof createAgentRepository>

export function toPublicAgentJob(
  job: CancellationJob,
  repository: AgentRepository,
): PublicAgentJob {
  const { latestScreenshotPath, ...safeJob } = job
  const proposedAction = repository.getProposedAction(job.id)
  const approval = repository.getLatestApproval(job.id)
  const commitAttempt = repository.getCommitAttempt(job.id)
  const verification = repository.getVerification(job.id)
  const safeCommitAttempt = commitAttempt
    ? (({ preScreenshotPath, postScreenshotPath, ...safe }) => ({
        ...safe,
        preScreenshotUrl: preScreenshotPath
          ? `/api/agent/jobs/${encodeURIComponent(job.id)}/commit/pre`
          : null,
        postScreenshotUrl: postScreenshotPath
          ? `/api/agent/jobs/${encodeURIComponent(job.id)}/commit/post`
          : null,
      }))(commitAttempt)
    : null
  return {
    ...safeJob,
    latestScreenshotUrl: latestScreenshotPath
      ? `/api/agent/jobs/${encodeURIComponent(job.id)}/screenshot`
      : null,
    timeline: repository
      .getSteps(job.id)
      .map(({ screenshotPath, ...step }) => ({
        ...step,
        screenshotUrl: screenshotPath
          ? `/api/agent/jobs/${encodeURIComponent(job.id)}/steps/${step.stepNumber}/screenshot`
          : null,
      })),
    proposedAction: proposedAction
      ? {
          detectedAt: proposedAction.detectedAt,
          targetRole: proposedAction.targetRole,
          targetName: proposedAction.targetName,
          currentUrl: proposedAction.currentUrl,
          feeCents: proposedAction.feeCents,
          accessUntil: proposedAction.accessUntil,
          visibleTerms: proposedAction.visibleTerms,
          fingerprint: proposedAction.fingerprint,
          snapshot: proposedAction.snapshot,
          screenshotUrl: proposedAction.screenshotPath
            ? `/api/agent/jobs/${encodeURIComponent(job.id)}/screenshot`
            : null,
        }
      : null,
    approval,
    commitAttempt: safeCommitAttempt,
    verification: verification
      ? {
          ...verification,
          screenshotUrl: verification.evidence[0]?.screenshotPath
            ? `/api/agent/jobs/${encodeURIComponent(job.id)}/verification/screenshot`
            : null,
          evidence: verification.evidence.map(
            ({ screenshotPath, ...item }) => ({
              ...item,
              screenshotUrl: screenshotPath
                ? `/api/agent/jobs/${encodeURIComponent(job.id)}/verification/screenshot`
                : null,
            }),
          ),
        }
      : null,
  }
}
