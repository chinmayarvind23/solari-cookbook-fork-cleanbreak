import type { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  approvalFingerprint,
  canonicalApprovalSnapshot,
} from "@/lib/agent/approval"
import {
  approveCancellation,
  InjectedCommitCrash,
  recoverArmedCommit,
  type CommitDependencies,
} from "@/lib/agent/commit"
import { proposedActionFrom } from "@/lib/agent/policy"
import { createAgentRepository } from "@/lib/agent/repository"
import type { CancellationJob, PageObservation } from "@/lib/agent/types"
import { createDatabase } from "@/lib/db"
import type { Subscription } from "@/lib/subscriptions"

const targetUrl = "https://cleanbreak.example/demo/streammax/terms"
const subscription: Subscription = {
  id: "sub_streammax",
  name: "StreamMax",
  slug: "streammax",
  url: "/demo/streammax/account",
  domain: "streammax.example",
  amount: 29.99,
  currency: "USD",
  interval: "MONTHLY",
  nextRenewalDate: "2026-09-28",
  status: "ACTIVE",
  createdAt: "2026-09-02T12:00:00.000Z",
  updatedAt: "2026-09-02T12:00:00.000Z",
}
const terms =
  "Your Premium membership renews at $29.99 each month. Your access remains available until September 28, 2026. No cancellation fee. Confirm cancellation."

function observation(
  visibleText = terms,
  actionName = "Confirm cancellation",
): PageObservation {
  return {
    id: crypto.randomUUID(),
    observedAt: "2026-09-02T12:00:00.000Z",
    url: targetUrl,
    title: "StreamMax | Cancellation terms",
    headings: ["Confirm cancellation"],
    visibleText,
    actions: actionName
      ? [
          {
            id: "el_1",
            role: "button",
            name: actionName,
            kind: "submit",
            href: null,
            checked: null,
            value: "",
          },
        ]
      : [],
  }
}

function job(id = "job_commit"): CancellationJob {
  return {
    id,
    subscriptionId: subscription.id,
    state: "AWAITING_APPROVAL",
    scenario: "happy-path",
    model: "gpt-5.6",
    targetUrl: "https://cleanbreak.example/demo/streammax/account",
    createdAt: "2026-09-02T12:00:00.000Z",
    completedAt: null,
    sessionId: "navigation_session",
    profileId: "profile_1",
    recordingStatus: "AVAILABLE",
    replayUrl: "https://replay.example/navigation",
    latestScreenshotPath: `artifacts/agent/${id}/step-04.png`,
    steps: 4,
    retentionsEncountered: 0,
    retentionsRejected: 0,
    modelCalls: 4,
    inputTokens: 10,
    outputTokens: 5,
    policyBlocks: 0,
    unsafeActionsExecuted: 0,
    durationMs: 100,
    browserReleased: true,
    clientClosed: true,
    profileStateSaved: true,
    errorCode: null,
    errorMessage: null,
    approvalsRequested: 0,
    approvalsGranted: 0,
    approvalsAborted: 0,
    approvalToCommitMs: null,
    commitAttempts: 0,
    duplicateCommitRequestsBlocked: 0,
    staleApprovalsBlocked: 0,
    changedTermsReapprovalRequired: 0,
    destructiveClicksExecuted: 0,
    automaticDestructiveRetries: 0,
    commitsWithUnknownOutcome: 0,
    verificationStartedAt: null,
    verificationsStarted: 0,
    verifiedCount: 0,
    notVerifiedCount: 0,
    inconclusiveCount: 0,
    verificationDurationMs: null,
    verificationSessionCreated: 0,
    verificationScreenshots: 0,
    verificationReplayAvailable: 0,
    falseVerified: 0,
    freshSessionMismatchFailures: 0,
  }
}

function prepare(database: DatabaseSync, visibleText = terms) {
  const repository = createAgentRepository(database)
  const record = job()
  repository.createJob(record)
  const proposed = proposedActionFrom(
    observation(visibleText),
    observation(visibleText).actions[0],
    "artifacts/agent/job_commit/step-04.png",
    { jobId: record.id, subscription, planName: "Premium" },
  )
  repository.saveProposedAction(record.id, proposed)
  return { repository, record, proposed }
}

function harness(
  repository: ReturnType<typeof createAgentRepository>,
  options: {
    visibleText?: string
    actionName?: string
    click?: () => Promise<unknown>
    hooks?: CommitDependencies["hooks"]
  } = {},
) {
  const click = vi.fn(options.click ?? (async () => undefined))
  const closeBrowser = vi.fn(async () => undefined)
  const closeClient = vi.fn(async () => undefined)
  const saveProfile = vi.fn(async () => ({}))
  const launchedProfiles: string[] = []
  let sequence = 0
  const dependencies: Partial<CommitDependencies> = {
    repository,
    dryRun: false,
    artifactDirectory: "artifacts/test-commit",
    now: () => new Date(1_788_364_800_000 + sequence++ * 10),
    id: () => `id_${++sequence}`,
    replayAttempts: 1,
    replayDelayMs: 0,
    hooks: options.hooks,
    getSubscription: () => subscription,
    createClient: () => ({
      profiles: {
        list: async () => [{ id: "profile_1", name: "cleanbreak-demo" }],
        create: async ({ name }) => ({ id: "profile_new", name }),
        save: saveProfile,
      },
      sessions: {
        getReplayUrl: async () => ({ url: "https://replay.example/commit" }),
      },
      launch: async ({ profileId }) => {
        launchedProfiles.push(profileId)
        return {
          id: `commit_session_${launchedProfiles.length}`,
          close: closeBrowser,
          newPage: async () => ({
            url: () => targetUrl,
            title: async () => "StreamMax | Cancellation terms",
            evaluate: async <T>() =>
              ({
                headings: ["Confirm cancellation"],
                visibleText: options.visibleText ?? terms,
                actions: (options.actionName === ""
                  ? []
                  : [
                      {
                        domIndex: 0,
                        role: "button",
                        name: options.actionName ?? "Confirm cancellation",
                        kind: "submit",
                        href: null,
                        checked: null,
                        value: "",
                      },
                    ]) as unknown[],
              }) as T,
            locator: () => ({
              nth: () => ({
                click,
                fill: async () => undefined,
                selectOption: async () => undefined,
              }),
            }),
            goto: async () => undefined,
            waitForURL: async () => undefined,
            screenshot: async () => undefined,
            context: () => ({ storageState: async () => ({ cookies: [] }) }),
          }),
        }
      },
      close: closeClient,
    }),
  }
  return {
    dependencies,
    click,
    closeBrowser,
    closeClient,
    launchedProfiles,
    saveProfile,
  }
}

describe("Milestone 4 approval snapshot", () => {
  it("produces a deterministic SHA-256 fingerprint", () => {
    const snapshot = canonicalApprovalSnapshot({
      jobId: "job",
      subscriptionId: "sub",
      serviceName: " StreamMax ",
      serviceDomain: "STREAMMAX.EXAMPLE",
      planName: "Premium",
      recurringPriceCents: 2999,
      currency: "usd",
      interval: "MONTHLY",
      annualSavingsCents: 35988,
      currentStatus: "ACTIVE",
      actionText: "Confirm cancellation",
      targetRole: "button",
      observedUrl: targetUrl,
      feeCents: 0,
      accessUntil: "September 28, 2026",
      visibleTerms: ["No cancellation fee."],
      finalScreenshotPath: "evidence.png",
      observedAt: "2026-09-02T12:00:00.000Z",
      proposedActionCreatedAt: "2026-09-02T12:00:00.000Z",
    })
    expect(approvalFingerprint(snapshot)).toBe(approvalFingerprint(snapshot))
    expect(approvalFingerprint(snapshot)).toMatch(/^[a-f0-9]{64}$/)
  })

  it("changes the fingerprint when a financial term changes", () => {
    const database = createDatabase(":memory:")
    try {
      const { proposed } = prepare(database)
      const changed = { ...proposed.snapshot, feeCents: 4500 }
      expect(approvalFingerprint(changed)).not.toBe(proposed.fingerprint)
    } finally {
      database.close()
    }
  })

  it("captures every required financial confirmation field", () => {
    const database = createDatabase(":memory:")
    const { proposed } = prepare(database)
    expect(proposed.snapshot).toMatchObject({
      serviceName: "StreamMax",
      planName: "Premium",
      recurringPriceCents: 2999,
      annualSavingsCents: 35988,
      currentStatus: "ACTIVE",
      actionText: "Confirm cancellation",
      feeCents: 0,
      accessUntil: "September 28, 2026",
    })
    database.close()
  })
})

describe("Milestone 4 durable approval and commit", () => {
  let database: DatabaseSync
  let previousEnvironment: NodeJS.ProcessEnv

  beforeEach(() => {
    database = createDatabase(":memory:")
    previousEnvironment = { ...process.env }
    Object.assign(process.env, {
      SOLARI_API_KEY: "test-solari",
      CLEANBREAK_PUBLIC_BASE_URL: "https://cleanbreak.example",
    })
  })

  afterEach(() => {
    process.env = previousEnvironment
    database.close()
  })

  it("persists authoritative approval data", () => {
    const { repository, record, proposed } = prepare(database)
    const result = repository.authorizeApproval({
      jobId: record.id,
      fingerprint: proposed.fingerprint,
      approvalId: "approval_1",
      approvedAt: "2026-09-02T12:01:00.000Z",
    })
    expect(result.result).toBe("APPROVED")
    expect(repository.getLatestApproval(record.id)).toMatchObject({
      id: "approval_1",
      actionFingerprint: proposed.fingerprint,
      status: "APPROVED",
    })
  })

  it("does not grant external profile write authority through cancellation approval", async () => {
    const { repository, record, proposed } = prepare(database)
    repository.updateJob(record.id, {
      scenario: "real-provider-dry-run",
      profileStateSaved: false,
    })
    process.env.SOLARI_PERSIST_PROFILE_STATE = "true"
    const run = harness(repository)
    const result = await approveCancellation(
      record.id,
      proposed.fingerprint,
      run.dependencies,
    )
    expect(result.commitAttempt?.profileStateSaved).toBe(false)
    expect(run.saveProfile).not.toHaveBeenCalled()
    expect(run.closeBrowser).toHaveBeenCalledOnce()
    expect(run.closeClient).toHaveBeenCalledOnce()
  })

  it("server-enforced dry-run mode keeps valid approval at the boundary", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository)
    const result = await approveCancellation(record.id, proposed.fingerprint, {
      ...run.dependencies,
      dryRun: true,
    })

    expect(result).toMatchObject({
      state: "AWAITING_APPROVAL",
      errorCode: "DRY_RUN_ACTIVE",
      approvalsGranted: 0,
      commitAttempts: 0,
      destructiveClicksExecuted: 0,
    })
    expect(run.click).not.toHaveBeenCalled()
    expect(run.launchedProfiles).toHaveLength(0)
    expect(repository.getLatestApproval(record.id)).toBeNull()
  })

  it("rejects a stale client fingerprint and records the block", () => {
    const { repository, record, proposed } = prepare(database)
    const result = repository.authorizeApproval({
      jobId: record.id,
      fingerprint: "0".repeat(64),
      approvalId: "approval_stale",
      approvedAt: "2026-09-02T12:01:00.000Z",
    })
    expect(result).toMatchObject({ result: "STALE" })
    expect(repository.getJob(record.id)?.staleApprovalsBlocked).toBe(1)
  })

  it("does not offer an approval path for a nonzero fee", () => {
    const { repository, record, proposed } = prepare(
      database,
      "A cancellation fee of $45.00 applies. Confirm cancellation.",
    )
    const result = repository.authorizeApproval({
      jobId: record.id,
      fingerprint: proposed.fingerprint,
      approvalId: "approval_fee",
      approvedAt: "2026-09-02T12:01:00.000Z",
    })
    expect(result).toMatchObject({ result: "FEE" })
    expect(repository.getLatestApproval(record.id)).toBeNull()
  })

  it("aborts idempotently without a destructive attempt", () => {
    const { repository, record, proposed } = prepare(database)
    expect(
      repository.abortJob(
        record.id,
        proposed.fingerprint,
        "2026-09-02T12:01:00.000Z",
      ),
    ).toBe(true)
    expect(
      repository.abortJob(
        record.id,
        proposed.fingerprint,
        "2026-09-02T12:02:00.000Z",
      ),
    ).toBe(true)
    expect(repository.getJob(record.id)).toMatchObject({
      state: "ABORTED",
      approvalsAborted: 1,
      destructiveClicksExecuted: 0,
    })
  })

  it("cannot approve after abort", () => {
    const { repository, record, proposed } = prepare(database)
    repository.abortJob(
      record.id,
      proposed.fingerprint,
      "2026-09-02T12:01:00.000Z",
    )
    expect(
      repository.authorizeApproval({
        jobId: record.id,
        fingerprint: proposed.fingerprint,
        approvalId: "too_late",
        approvedAt: "2026-09-02T12:02:00.000Z",
      }),
    ).toMatchObject({ result: "REJECTED", code: "JOB_ABORTED" })
  })

  it("happy path dispatches exactly one fresh target and ends VERIFYING", async () => {
    const { repository, record, proposed } = prepare(database)
    const authoritative = { status: "ACTIVE", autoRenew: true }
    const run = harness(repository, {
      click: async () => {
        authoritative.status = "CANCELED"
        authoritative.autoRenew = false
      },
    })
    const result = await approveCancellation(
      record.id,
      proposed.fingerprint,
      run.dependencies,
    )
    expect(result.state).toBe("VERIFYING")
    expect(run.click).toHaveBeenCalledOnce()
    expect(authoritative).toEqual({ status: "CANCELED", autoRenew: false })
    expect(result).toMatchObject({
      destructiveClicksExecuted: 1,
      automaticDestructiveRetries: 0,
      commitAttempts: 1,
    })
  })

  it("uses the same persisted profile in a new execution session", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository)
    await approveCancellation(record.id, proposed.fingerprint, run.dependencies)
    expect(run.launchedProfiles).toEqual(["profile_1"])
    expect(repository.getCommitAttempt(record.id)?.sessionId).toBe(
      "commit_session_1",
    )
  })

  it("does not reuse the stale observation target", async () => {
    const { repository, record, proposed } = prepare(database)
    const freshClick = vi.fn(async () => undefined)
    const run = harness(repository, { click: freshClick })
    await approveCancellation(record.id, proposed.fingerprint, run.dependencies)
    expect(freshClick).toHaveBeenCalledOnce()
  })

  it("requires reapproval when terms change and never clicks", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      visibleText: `${terms} Refunds are unavailable after cancellation.`,
    })
    const result = await approveCancellation(
      record.id,
      proposed.fingerprint,
      run.dependencies,
    )
    expect(result.state).toBe("AWAITING_APPROVAL")
    expect(result.proposedAction?.fingerprint).not.toBe(proposed.fingerprint)
    expect(result.changedTermsReapprovalRequired).toBe(1)
    expect(run.click).not.toHaveBeenCalled()
  })

  it("detects an already-canceled service and performs no click", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      visibleText: "Membership already canceled. Auto-renew is off.",
      actionName: "",
    })
    const result = await approveCancellation(
      record.id,
      proposed.fingerprint,
      run.dependencies,
    )
    expect(result.state).toBe("VERIFYING")
    expect(run.click).not.toHaveBeenCalled()
    expect(repository.getCommitAttempt(record.id)?.outcome).toBe("NOT_EXECUTED")
  })

  it("maps an ambiguous click response to VERIFYING without success", async () => {
    const { repository, record, proposed } = prepare(database)
    const authoritative = { status: "ACTIVE", autoRenew: true }
    const run = harness(repository, { click: async () => undefined })
    const result = await approveCancellation(
      record.id,
      proposed.fingerprint,
      run.dependencies,
    )
    expect(result.state).toBe("VERIFYING")
    expect(result.state).not.toBe("VERIFIED")
    expect(run.click).toHaveBeenCalledOnce()
    expect(authoritative).toEqual({ status: "ACTIVE", autoRenew: true })
  })

  it("records an unknown click outcome and does not retry", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      click: async () => {
        throw new Error("connection disappeared")
      },
    })
    const result = await approveCancellation(
      record.id,
      proposed.fingerprint,
      run.dependencies,
    )
    expect(result).toMatchObject({
      state: "VERIFYING",
      destructiveClicksExecuted: 1,
      automaticDestructiveRetries: 0,
      commitsWithUnknownOutcome: 1,
    })
    expect(run.click).toHaveBeenCalledOnce()
  })

  it("blocks a duplicate approval after commit without another click", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository)
    await approveCancellation(record.id, proposed.fingerprint, run.dependencies)
    await approveCancellation(record.id, proposed.fingerprint, run.dependencies)
    expect(run.click).toHaveBeenCalledOnce()
    expect(repository.getJob(record.id)?.duplicateCommitRequestsBlocked).toBe(1)
  })

  it("allows only one concurrent caller to arm and click", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository)
    const results = await Promise.all([
      approveCancellation(record.id, proposed.fingerprint, run.dependencies),
      approveCancellation(record.id, proposed.fingerprint, run.dependencies),
    ])
    expect(
      results.every((result) =>
        ["COMMITTING", "VERIFYING"].includes(result.state),
      ),
    ).toBe(true)
    expect(run.click).toHaveBeenCalledOnce()
    expect(repository.getJob(record.id)?.commitAttempts).toBe(1)
  })

  it("a crash before arming leaves approval resumable and no attempt marker", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      hooks: {
        beforeArm: () => {
          throw new InjectedCommitCrash("before-arm")
        },
      },
    })
    await expect(
      approveCancellation(record.id, proposed.fingerprint, run.dependencies),
    ).rejects.toMatchObject({ point: "before-arm" })
    expect(repository.getJob(record.id)?.state).toBe("AWAITING_APPROVAL")
    expect(repository.getCommitAttempt(record.id)).toBeNull()
    expect(run.click).not.toHaveBeenCalled()
  })

  it("a crash after arming recovers to VERIFYING without a click", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      hooks: {
        afterArm: () => {
          throw new InjectedCommitCrash("after-arm")
        },
      },
    })
    await expect(
      approveCancellation(record.id, proposed.fingerprint, run.dependencies),
    ).rejects.toMatchObject({ point: "after-arm" })
    expect(repository.getJob(record.id)?.state).toBe("COMMITTING")
    const recovered = recoverArmedCommit(record.id, repository)
    expect(recovered.state).toBe("VERIFYING")
    expect(run.click).not.toHaveBeenCalled()
  })

  it("a crash after dispatch recovers without a second click", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      hooks: {
        afterClickDispatch: () => {
          throw new InjectedCommitCrash("after-dispatch")
        },
      },
    })
    await expect(
      approveCancellation(record.id, proposed.fingerprint, run.dependencies),
    ).rejects.toMatchObject({ point: "after-dispatch" })
    expect(run.click).toHaveBeenCalledOnce()
    recoverArmedCommit(record.id, repository)
    expect(run.click).toHaveBeenCalledOnce()
    expect(repository.getJob(record.id)).toMatchObject({
      state: "VERIFYING",
      automaticDestructiveRetries: 0,
    })
  })

  it("a crash after click return recovers without a second click", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      hooks: {
        afterClickReturned: () => {
          throw new InjectedCommitCrash("after-return")
        },
      },
    })
    await expect(
      approveCancellation(record.id, proposed.fingerprint, run.dependencies),
    ).rejects.toMatchObject({ point: "after-return" })
    expect(repository.getCommitAttempt(record.id)?.outcome).toBe(
      "CLICK_RETURNED",
    )
    recoverArmedCommit(record.id, repository)
    expect(run.click).toHaveBeenCalledOnce()
    expect(repository.getJob(record.id)?.state).toBe("VERIFYING")
  })

  it("recovery is idempotent and never changes the retry metric", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository, {
      hooks: {
        afterArm: () => {
          throw new InjectedCommitCrash("after-arm")
        },
      },
    })
    await expect(
      approveCancellation(record.id, proposed.fingerprint, run.dependencies),
    ).rejects.toBeInstanceOf(InjectedCommitCrash)
    recoverArmedCommit(record.id, repository)
    recoverArmedCommit(record.id, repository)
    expect(repository.getJob(record.id)?.automaticDestructiveRetries).toBe(0)
  })

  it("records cleanup and replay evidence for an armed attempt", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository)
    await approveCancellation(record.id, proposed.fingerprint, run.dependencies)
    expect(repository.getCommitAttempt(record.id)).toMatchObject({
      browserReleased: true,
      clientClosed: true,
      recordingStatus: "AVAILABLE",
      replayUrl: "https://replay.example/commit",
    })
  })

  it("keeps unsafe action and automatic retry invariants at zero", async () => {
    const { repository, record, proposed } = prepare(database)
    const run = harness(repository)
    const result = await approveCancellation(
      record.id,
      proposed.fingerprint,
      run.dependencies,
    )
    expect(result.unsafeActionsExecuted).toBe(0)
    expect(result.automaticDestructiveRetries).toBe(0)
  })
})
