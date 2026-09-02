import type { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createAgentRepository } from "@/lib/agent/repository"
import type { ProposedAction, VerificationResult } from "@/lib/agent/types"
import { createDatabase, getStreamMaxSubscription } from "@/lib/db"
import { createReceiptForVerifiedJob } from "@/lib/receipts/builder"
import { canonicalJson, receiptSha256 } from "@/lib/receipts/canonical"
import { createReceiptRepository } from "@/lib/receipts/repository"
import type { CleanBreakReceipt, ReceiptPayload } from "@/lib/receipts/types"

const jobId = "11111111-1111-4111-8111-111111111116"
const createdAt = "2026-09-02T12:00:00.000Z"
const verifiedAt = "2026-09-02T12:10:00.000Z"

function payloadOf(receipt: CleanBreakReceipt): ReceiptPayload {
  const { sha256: _sha256, ...payload } = receipt
  return payload
}

function proposed(): ProposedAction {
  const snapshot = {
    jobId,
    subscriptionId: "sub_streammax",
    serviceName: "StreamMax",
    serviceDomain: "streammax.example",
    planName: "Premium",
    recurringPriceCents: 2999,
    currency: "USD",
    interval: "MONTHLY" as const,
    annualSavingsCents: 35988,
    currentStatus: "ACTIVE" as const,
    actionText: "Confirm cancellation",
    targetRole: "button",
    observedUrl: "https://cleanbreak.example/demo/streammax/terms",
    feeCents: 0,
    accessUntil: "September 28, 2026",
    visibleTerms: [
      "No cancellation fee.",
      "Access remains through September 28, 2026.",
    ],
    finalScreenshotPath: `artifacts/agent/${jobId}/step-04.png`,
    observedAt: "2026-09-02T12:05:00.000Z",
    proposedActionCreatedAt: "2026-09-02T12:05:00.000Z",
  }
  return {
    detectedAt: snapshot.observedAt,
    targetRole: snapshot.targetRole,
    targetName: snapshot.actionText,
    currentUrl: snapshot.observedUrl,
    feeCents: snapshot.feeCents,
    accessUntil: snapshot.accessUntil,
    visibleTerms: snapshot.visibleTerms,
    screenshotPath: snapshot.finalScreenshotPath,
    fingerprint: "a".repeat(64),
    snapshot,
  }
}

function seedVerified(
  database: DatabaseSync,
  options: {
    screenshots?: boolean
    replayUrl?: string | null
    interval?: "MONTHLY" | "YEARLY"
  } = {},
) {
  const agent = createAgentRepository(database)
  const receipts = createReceiptRepository(database)
  database
    .prepare(
      `INSERT INTO cancellation_jobs (
    id, subscription_id, state, scenario, model, target_url, created_at,
    profile_id, destructive_clicks_executed
  ) VALUES (?, 'sub_streammax', 'VERIFYING', 'dark-pattern', 'gpt-5.6', ?, ?, 'profile_1', 1)`,
    )
    .run(jobId, "https://cleanbreak.example/demo/streammax/account", createdAt)
  const action = proposed()
  agent.saveProposedAction(jobId, action)
  database
    .prepare(
      `INSERT INTO approvals (
    id, job_id, action_fingerprint, approved_at, status
  ) VALUES ('approval_1', ?, ?, '2026-09-02T12:06:00.000Z', 'APPROVED')`,
    )
    .run(jobId, action.fingerprint)
  database
    .prepare(
      `INSERT INTO commit_attempts (
    id, job_id, approval_id, action_fingerprint, armed_at,
    final_action_attempted_at, click_started_at, click_returned_at,
    outcome, session_id, pre_screenshot_path, post_screenshot_path,
    recording_status, replay_url
  ) VALUES ('attempt_1', ?, 'approval_1', ?, '2026-09-02T12:07:00.000Z',
    '2026-09-02T12:07:01.000Z', '2026-09-02T12:07:01.000Z',
    '2026-09-02T12:07:02.000Z', 'CLICK_RETURNED', 'execution_session',
    ?, ?, 'AVAILABLE', ?)`,
    )
    .run(
      jobId,
      action.fingerprint,
      options.screenshots === false
        ? null
        : `artifacts/agent/${jobId}/commit/pre-click.png`,
      options.screenshots === false
        ? null
        : `artifacts/agent/${jobId}/commit/post-click.png`,
      options.replayUrl === undefined
        ? "https://replay.example/execution"
        : options.replayUrl,
    )
  if (options.screenshots !== false) {
    agent.addStep({
      id: "step_1",
      jobId,
      stepNumber: 1,
      observationId: "obs_1",
      observedAt: createdAt,
      url: "https://cleanbreak.example/demo/streammax/account",
      title: "StreamMax | Account",
      actionType: "click",
      targetId: "el_1",
      targetRole: "link",
      targetName: "Billing",
      reasoning: "Inspect billing.",
      confidence: 0.99,
      risk: "SAFE_NAVIGATION",
      policyResult: "ALLOW",
      policyReason: "Read-only navigation.",
      screenshotPath: `artifacts/agent/${jobId}/step-01.png`,
      durationMs: 10,
    })
  }
  receipts.saveBeforeEvidence(jobId, {
    planName: "Premium",
    status: "ACTIVE",
    autoRenew: true,
    recurringAmountCents: options.interval === "YEARLY" ? 12000 : 2999,
    currency: "USD",
    interval: options.interval ?? "MONTHLY",
    nextChargeDate: "2026-09-28",
    url: "https://cleanbreak.example/demo/streammax/account",
    capturedAt: createdAt,
  })
  const evidence =
    options.screenshots === false
      ? null
      : {
          id: "evidence_1",
          jobId,
          phase: "VERIFICATION" as const,
          capturedAt: verifiedAt,
          url: "https://cleanbreak.example/demo/streammax/billing",
          title: "StreamMax | Billing",
          visibleExcerpt: "Membership Canceled Auto-renew Off Next charge None",
          normalizedState: {
            status: "CANCELED" as const,
            autoRenew: false,
            nextChargeDate: null,
            nextChargeAmountCents: null,
            accessUntil: "2026-09-28",
          },
          sessionId: "verification_session",
          screenshotPath: `artifacts/agent/${jobId}/verification/final.png`,
        }
  const verification: VerificationResult = {
    jobId,
    status: "VERIFIED",
    subscriptionStatus: "CANCELED",
    autoRenew: false,
    nextChargeDate: null,
    nextChargeAmountCents: null,
    accessUntil: "2026-09-28",
    evidence: evidence ? [evidence] : [],
    satisfiedCriteria: [
      "Account status is canceled.",
      "Auto-renew is off.",
      "No future charge is scheduled.",
    ],
    failedCriteria: [],
    explanation:
      "Fresh account billing evidence shows cancellation, renewal off, and no future charge.",
    verificationSessionId: "verification_session",
    verifiedAt,
    targetUrl: "https://cleanbreak.example/demo/streammax/billing",
    recordingStatus: "AVAILABLE",
    replayUrl:
      options.replayUrl === undefined
        ? "https://replay.example/verification"
        : options.replayUrl,
    browserReleased: true,
    clientClosed: true,
    errorCode: null,
    errorMessage: null,
  }
  agent.finishVerification({
    result: verification,
    evidence,
    durationMs: 1000,
    freshSessionMismatch: false,
  })
  return { agent, receipts }
}

describe("Milestone 6 CleanBreak Receipt", () => {
  let database: DatabaseSync
  beforeEach(() => {
    database = createDatabase(":memory:")
  })
  afterEach(() => {
    database.close()
  })

  function create(options?: Parameters<typeof seedVerified>[1]) {
    const repositories = seedVerified(database, options)
    const receipt = createReceiptForVerifiedJob(jobId, {
      agentRepository: repositories.agent,
      receiptRepository: repositories.receipts,
      getSubscription: () => getStreamMaxSubscription(database),
    })
    return { ...repositories, receipt }
  }

  it("creates one receipt only after a stored VERIFIED result", () => {
    const { receipt } = create()
    expect(receipt.verification.result).toBe("VERIFIED")
  })

  it("rejects receipt generation for a non-verified job", () => {
    const { agent, receipts } = seedVerified(database)
    database.exec("DELETE FROM receipt_generation_failures")
    database.exec("UPDATE cancellation_jobs SET state = 'FAILED'")
    expect(() =>
      createReceiptForVerifiedJob(jobId, {
        agentRepository: agent,
        receiptRepository: receipts,
        getSubscription: () => getStreamMaxSubscription(database),
      }),
    ).toThrow(/only for VERIFIED/)
    expect(receipts.getByJobId(jobId)).toBeNull()
  })

  it("persists stable receipt, job, subscription, and creation identifiers", () => {
    const { receipt } = create()
    expect(receipt).toMatchObject({
      receiptId: expect.stringMatching(/^cbr_[a-f0-9]{24}$/),
      jobId,
      subscriptionId: "sub_streammax",
      createdAt: verifiedAt,
      canonicalVersion: "1",
    })
  })

  it("uses actual persisted before-state evidence", () => {
    expect(create().receipt.before).toMatchObject({
      status: "ACTIVE",
      autoRenew: true,
      recurringAmountCents: 2999,
      nextChargeDate: "2026-09-28",
    })
  })

  it("records exact human approval evidence", () => {
    expect(create().receipt.approval).toMatchObject({
      approvedAt: "2026-09-02T12:06:00.000Z",
      actionName: "Confirm cancellation",
      targetRole: "button",
      feeCents: 0,
      actionFingerprint: "a".repeat(64),
    })
  })

  it("describes execution as an attempt with one click and zero retries", () => {
    expect(create().receipt.execution).toMatchObject({
      outcome: "CLICK_RETURNED",
      destructiveClicksExecuted: 1,
      automaticRetries: 0,
      sessionId: "execution_session",
    })
  })

  it("proves execution and verification used different sessions", () => {
    const receipt = create().receipt
    expect(receipt.execution.sessionId).not.toBe(receipt.verification.sessionId)
    expect(receipt.verification).toMatchObject({
      freshSession: true,
      sameProfileReused: true,
    })
  })

  it("copies the deterministic stored verification explanation and criteria", () => {
    const receipt = create().receipt
    expect(receipt.verification.explanation).toContain(
      "Fresh account billing evidence",
    )
    expect(receipt.verification.satisfiedCriteria).toHaveLength(3)
  })

  it("annualizes monthly savings exactly", () => {
    expect(create().receipt.annualizedSavingsCents).toBe(35988)
  })

  it("does not annualize a yearly amount twice", () => {
    const repositories = seedVerified(database, { interval: "YEARLY" })
    const yearly = {
      ...getStreamMaxSubscription(database),
      amount: 120,
      interval: "YEARLY" as const,
    }
    const receipt = createReceiptForVerifiedJob(jobId, {
      agentRepository: repositories.agent,
      receiptRepository: repositories.receipts,
      getSubscription: () => yearly,
    })
    expect(receipt.annualizedSavingsCents).toBe(12000)
  })

  it("computes a lowercase SHA-256 digest over the canonical payload", () => {
    const receipt = create().receipt
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.sha256).toBe(receiptSha256(payloadOf(receipt)))
  })

  it.each([
    [
      "amount",
      (p: ReceiptPayload) => {
        p.recurringAmountCents += 1
      },
    ],
    [
      "currency",
      (p: ReceiptPayload) => {
        p.currency = "EUR"
      },
    ],
    [
      "interval",
      (p: ReceiptPayload) => {
        p.recurringInterval = "YEARLY"
      },
    ],
    [
      "before renewal",
      (p: ReceiptPayload) => {
        p.before.autoRenew = false
      },
    ],
    [
      "approval fingerprint",
      (p: ReceiptPayload) => {
        p.approval.actionFingerprint = "b".repeat(64)
      },
    ],
    [
      "execution session",
      (p: ReceiptPayload) => {
        p.execution.sessionId = "other"
      },
    ],
    [
      "verification session",
      (p: ReceiptPayload) => {
        p.verification.sessionId = "other"
      },
    ],
    [
      "verified status",
      (p: ReceiptPayload) => {
        p.verification.status = "ACTIVE"
      },
    ],
    [
      "next charge",
      (p: ReceiptPayload) => {
        p.verification.nextChargeDate = "2026-10-01"
      },
    ],
    [
      "evidence URL",
      (p: ReceiptPayload) => {
        p.verification.url = "https://example.test/other"
      },
    ],
    [
      "satisfied criteria",
      (p: ReceiptPayload) => {
        p.verification.satisfiedCriteria[0] = "Changed"
      },
    ],
  ])("changes the digest when %s changes", (_label, mutate) => {
    const receipt = create().receipt
    const payload = structuredClone(payloadOf(receipt))
    mutate(payload)
    expect(receiptSha256(payload)).not.toBe(receipt.sha256)
  })

  it("canonicalizes reordered object keys to identical JSON and hash input", () => {
    expect(canonicalJson({ b: 2, a: 1, nested: { z: null, c: true } })).toBe(
      canonicalJson({ nested: { c: true, z: null }, a: 1, b: 2 }),
    )
  })

  it("preserves semantically ordered arrays", () => {
    expect(canonicalJson({ criteria: ["first", "second"] })).not.toBe(
      canonicalJson({ criteria: ["second", "first"] }),
    )
  })

  it("is idempotent for repeated generation", () => {
    const { receipt, agent, receipts } = create()
    const again = createReceiptForVerifiedJob(jobId, {
      agentRepository: agent,
      receiptRepository: receipts,
      getSubscription: () => getStreamMaxSubscription(database),
    })
    expect(again).toEqual(receipt)
    expect(
      database.prepare("SELECT COUNT(*) count FROM cleanbreak_receipts").get(),
    ).toEqual({ count: 1 })
  })

  it("enforces one immutable receipt per job in SQLite", () => {
    const { receipt } = create()
    expect(() =>
      database
        .prepare("UPDATE cleanbreak_receipts SET sha256 = ? WHERE id = ?")
        .run("b".repeat(64), receipt.receiptId),
    ).toThrow(/immutable/)
  })

  it("records a retryable generation error without changing VERIFIED truth", () => {
    const { agent, receipts } = seedVerified(database)
    database.exec("DELETE FROM receipt_before_evidence")
    expect(() =>
      createReceiptForVerifiedJob(jobId, {
        agentRepository: agent,
        receiptRepository: receipts,
        getSubscription: () => getStreamMaxSubscription(database),
      }),
    ).toThrow(/pre-action evidence/)
    expect(agent.getJob(jobId)?.state).toBe("VERIFIED")
    expect(receipts.getFailure(jobId)).toMatchObject({
      attempts: 1,
      errorCode: "RECEIPT_GENERATION_FAILED",
    })
  })

  it("keeps absent optional evidence explicitly null", () => {
    const receipt = create({ screenshots: false, replayUrl: null }).receipt
    expect(receipt.before.screenshotUrl).toBeNull()
    expect(receipt.execution.preScreenshotUrl).toBeNull()
    expect(receipt.verification.screenshotUrl).toBeNull()
    expect(receipt.verification.replayUrl).toBeNull()
  })

  it("does not copy credential-bearing replay query strings", () => {
    const receipt = create({
      replayUrl: "https://storage.example/replay?token=secret",
    }).receipt
    expect(receipt.execution.replayUrl).toBeNull()
    expect(JSON.stringify(receipt)).not.toContain("token=secret")
  })

  it("contains no local filesystem paths or credentials", () => {
    const serialized = JSON.stringify(create().receipt)
    expect(serialized).not.toContain("artifacts/")
    expect(serialized).not.toMatch(/[A-Z]:\\/)
    expect(serialized).not.toContain("api-key")
  })
})
