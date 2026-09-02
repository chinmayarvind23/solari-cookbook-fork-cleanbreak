import { createHash } from "node:crypto"

import {
  createAgentRepository,
  type AgentRepository,
} from "@/lib/agent/repository"
import { getStreamMaxSubscription } from "@/lib/db"
import { receiptSha256 } from "@/lib/receipts/canonical"
import {
  createReceiptRepository,
  type ReceiptRepository,
} from "@/lib/receipts/repository"
import type { CleanBreakReceipt, ReceiptPayload } from "@/lib/receipts/types"
import type { Subscription } from "@/lib/subscriptions"

type Dependencies = {
  agentRepository: AgentRepository
  receiptRepository: ReceiptRepository
  getSubscription(): Subscription
}

function safeReplayUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol)) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.toString()
  } catch {
    return null
  }
}

function evidenceUrl(
  jobId: string,
  kind: "approval" | "pre" | "post" | "verification",
  step?: number,
): string {
  const root = `/api/agent/jobs/${encodeURIComponent(jobId)}`
  if (kind === "approval")
    return step ? `${root}/steps/${step}/screenshot` : `${root}/screenshot`
  if (kind === "verification") return `${root}/verification/screenshot`
  return `${root}/commit/${kind}`
}

function receiptId(jobId: string): string {
  return `cbr_${createHash("sha256").update(`cleanbreak-receipt:${jobId}`).digest("hex").slice(0, 24)}`
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined || value === "")
    throw new Error(message)
  return value
}

export function createReceiptForVerifiedJob(
  jobId: string,
  dependencies: Partial<Dependencies> = {},
): CleanBreakReceipt {
  const agentRepository =
    dependencies.agentRepository ?? createAgentRepository()
  const receiptRepository =
    dependencies.receiptRepository ?? createReceiptRepository()
  const existing = receiptRepository.getByJobId(jobId)
  if (existing) return existing

  try {
    const job = required(
      agentRepository.getJob(jobId),
      "Receipt job was not found.",
    )
    if (job.state !== "VERIFIED")
      throw new Error("Receipts are available only for VERIFIED jobs.")
    const verification = required(
      agentRepository.getVerification(jobId),
      "Stored verification evidence is missing.",
    )
    if (verification.status !== "VERIFIED")
      throw new Error("Stored verification is not VERIFIED.")
    const proposed = required(
      agentRepository.getProposedAction(jobId),
      "Stored proposed action is missing.",
    )
    const approval = required(
      agentRepository.getLatestApproval(jobId),
      "Stored approval is missing.",
    )
    if (approval.status !== "APPROVED")
      throw new Error("Stored approval is not authoritative.")
    const execution = required(
      agentRepository.getCommitAttempt(jobId),
      "Stored execution attempt is missing.",
    )
    const executionSessionId = required(
      execution.sessionId,
      "Stored execution session is missing.",
    )
    if (executionSessionId === verification.verificationSessionId) {
      throw new Error("Receipt rejected a reused verification session.")
    }
    const before = required(
      receiptRepository.getBeforeEvidence(jobId),
      "Stored pre-action evidence is missing.",
    )
    const subscription = (
      dependencies.getSubscription ?? getStreamMaxSubscription
    )()
    if (subscription.id !== job.subscriptionId)
      throw new Error("Subscription identity does not match the verified job.")
    const firstStep = agentRepository.getSteps(jobId)[0] ?? null
    const verificationScreenshot = verification.evidence.some(
      (item) => item.screenshotPath,
    )
    const id = receiptId(jobId)
    const payload: ReceiptPayload = {
      canonicalVersion: "1",
      receiptId: id,
      jobId,
      subscriptionId: job.subscriptionId,
      createdAt: verification.verifiedAt,
      serviceName: proposed.snapshot.serviceName,
      serviceDomain: proposed.snapshot.serviceDomain,
      planName: before.planName,
      recurringAmountCents: before.recurringAmountCents,
      currency: before.currency,
      recurringInterval: before.interval,
      annualizedSavingsCents:
        before.interval === "MONTHLY"
          ? before.recurringAmountCents * 12
          : before.recurringAmountCents,
      before: {
        ...before,
        screenshotUrl: firstStep?.screenshotPath
          ? evidenceUrl(jobId, "approval", firstStep.stepNumber)
          : null,
      },
      approval: {
        approvedAt: approval.approvedAt,
        actionName: proposed.snapshot.actionText,
        targetRole: proposed.snapshot.targetRole,
        actionFingerprint: approval.actionFingerprint,
        visibleTerms: [...proposed.snapshot.visibleTerms],
        feeCents: proposed.snapshot.feeCents,
        accessUntil: proposed.snapshot.accessUntil,
        screenshotUrl: proposed.screenshotPath
          ? evidenceUrl(jobId, "approval")
          : null,
      },
      execution: {
        sessionId: executionSessionId,
        attemptId: execution.id,
        destructiveClicksExecuted: job.destructiveClicksExecuted,
        automaticRetries: job.automaticDestructiveRetries,
        outcome: execution.outcome,
        armedAt: execution.armedAt,
        clickStartedAt: execution.clickStartedAt,
        clickReturnedAt: execution.clickReturnedAt,
        preScreenshotUrl: execution.preScreenshotPath
          ? evidenceUrl(jobId, "pre")
          : null,
        postScreenshotUrl: execution.postScreenshotPath
          ? evidenceUrl(jobId, "post")
          : null,
        recordingStatus: execution.recordingStatus,
        replayUrl: safeReplayUrl(execution.replayUrl),
      },
      verification: {
        result: "VERIFIED",
        sessionId: verification.verificationSessionId,
        freshSession: true,
        sameProfileReused: true,
        verifiedAt: verification.verifiedAt,
        status: verification.subscriptionStatus,
        autoRenew: verification.autoRenew,
        nextChargeDate: verification.nextChargeDate,
        nextChargeAmountCents: verification.nextChargeAmountCents,
        accessUntil: verification.accessUntil,
        satisfiedCriteria: [...verification.satisfiedCriteria],
        explanation: verification.explanation,
        url: verification.targetUrl,
        screenshotUrl: verificationScreenshot
          ? evidenceUrl(jobId, "verification")
          : null,
        recordingStatus: verification.recordingStatus,
        replayUrl: safeReplayUrl(verification.replayUrl),
      },
    }
    const sha256 = receiptSha256(payload)
    receiptRepository.insert(payload, sha256)
    return required(
      receiptRepository.getByJobId(jobId),
      "Receipt persistence failed.",
    )
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Receipt generation failed safely."
    receiptRepository.recordFailure(
      jobId,
      "RECEIPT_GENERATION_FAILED",
      message,
      new Date().toISOString(),
    )
    throw error
  }
}
