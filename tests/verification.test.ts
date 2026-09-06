// Checks independent Browser verification and negative outcomes.
import type { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentRepository } from "@/lib/agent/repository"
import type { CancellationJob } from "@/lib/agent/types"
import { createDatabase } from "@/lib/db"
import {
  assertReadOnlyVerificationAction,
  evaluateVerificationState,
  verifyObservation,
  type NormalizedVerificationState,
  type ReadOnlyObservation,
} from "@/lib/verification/policy"
import { runIndependentVerification } from "@/lib/verification/runtime"

const baseState: NormalizedVerificationState = {
  status: "UNKNOWN",
  autoRenew: null,
  nextChargeDate: null,
  nextChargeAmountCents: null,
  accessUntil: null,
}

function observation(
  fields: ReadOnlyObservation["fields"],
  visibleText = "Billing",
) {
  return {
    url: "https://cleanbreak.example/demo/streammax/billing",
    title: "StreamMax | Billing",
    visibleText,
    fields,
  }
}

describe("Milestone 5 deterministic verification policy", () => {
  it("verifies canceled, auto-renew off, and no next charge", () => {
    expect(
      evaluateVerificationState({
        ...baseState,
        status: "CANCELED",
        autoRenew: false,
      }).statusResult,
    ).toBe("VERIFIED")
  })

  it("verifies period-end cancellation only with access and no future charge", () => {
    expect(
      evaluateVerificationState({
        ...baseState,
        status: "CANCELS_AT_PERIOD_END",
        autoRenew: false,
        accessUntil: "2026-09-28",
      }).statusResult,
    ).toBe("VERIFIED")
  })

  it("returns NOT_VERIFIED for an active renewing account", () => {
    expect(
      evaluateVerificationState({
        ...baseState,
        status: "ACTIVE",
        autoRenew: true,
        nextChargeDate: "2026-09-28",
      }).statusResult,
    ).toBe("NOT_VERIFIED")
  })

  it("keeps a generic request-received message inconclusive", () => {
    expect(
      evaluateVerificationState(baseState, "Request received.").statusResult,
    ).toBe("INCONCLUSIVE")
  })

  it("keeps canceled plus renewal-on evidence inconclusive", () => {
    expect(
      evaluateVerificationState({
        ...baseState,
        status: "CANCELED",
        autoRenew: true,
      }).statusResult,
    ).toBe("INCONCLUSIVE")
  })

  it("does not verify active status when the next-charge field is missing", () => {
    expect(
      evaluateVerificationState({
        ...baseState,
        status: "ACTIVE",
        autoRenew: true,
      }).statusResult,
    ).toBe("NOT_VERIFIED")
  })

  it("does not treat a missing cancellation button as success", () => {
    expect(
      verifyObservation(
        observation([
          { label: "Membership", value: "Active" },
          { label: "Auto-renew", value: "On" },
        ]),
      ).statusResult,
    ).toBe("NOT_VERIFIED")
  })

  it("recognizes login expiration as inconclusive", () => {
    expect(
      evaluateVerificationState(baseState, "Session expired. Sign in."),
    ).toMatchObject({
      statusResult: "INCONCLUSIVE",
      errorCode: "VERIFICATION_LOGIN_REQUIRED",
    })
  })

  it("rejects every interaction through the read-only guard", () => {
    expect(() => assertReadOnlyVerificationAction("click")).toThrow(
      "VERIFICATION_READ_ONLY_GUARD",
    )
    expect(() => assertReadOnlyVerificationAction("fill")).toThrow(
      "VERIFICATION_READ_ONLY_GUARD",
    )
    expect(() => assertReadOnlyVerificationAction("submit payment")).toThrow(
      "VERIFICATION_READ_ONLY_GUARD",
    )
  })

  it("allows only navigation, observation, and screenshots", () => {
    expect(() => assertReadOnlyVerificationAction("navigate")).not.toThrow()
    expect(() => assertReadOnlyVerificationAction("observe")).not.toThrow()
    expect(() => assertReadOnlyVerificationAction("screenshot")).not.toThrow()
  })

  it("ignores execution screenshot content because it is not an input", () => {
    const active = verifyObservation(
      observation([
        { label: "Membership", value: "Active" },
        { label: "Auto-renew", value: "On" },
        { label: "Next charge", value: "September 28, 2026" },
      ]),
    )
    expect(active.statusResult).toBe("NOT_VERIFIED")
  })

  it("ignores planner success claims because they are not an input", () => {
    expect(
      evaluateVerificationState(baseState, "The planner said success.")
        .statusResult,
    ).toBe("INCONCLUSIVE")
  })

  it.each([
    [{ ...baseState, status: "ACTIVE", autoRenew: true }, "NOT_VERIFIED"],
    [{ ...baseState, status: "ACTIVE", autoRenew: false }, "INCONCLUSIVE"],
    [{ ...baseState, status: "CANCELED", autoRenew: true }, "INCONCLUSIVE"],
    [{ ...baseState, status: "UNKNOWN", autoRenew: false }, "INCONCLUSIVE"],
  ] as const)(
    "never false-verifies contradictory fixture state %#",
    (state, expected) => {
      expect(evaluateVerificationState(state).statusResult).toBe(expected)
      expect(evaluateVerificationState(state).statusResult).not.toBe("VERIFIED")
    },
  )
})

function verifyingJob(): CancellationJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    subscriptionId: "sub_streammax",
    state: "VERIFYING",
    scenario: "dark-pattern",
    model: "gpt-5.6",
    targetUrl: "https://cleanbreak.example/demo/streammax/account",
    createdAt: "2026-09-02T12:00:00.000Z",
    completedAt: null,
    sessionId: "navigation_session",
    profileId: "profile_1",
    recordingStatus: "AVAILABLE",
    replayUrl: null,
    latestScreenshotPath: "execution.png",
    steps: 6,
    retentionsEncountered: 2,
    retentionsRejected: 2,
    modelCalls: 6,
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
    approvalsRequested: 1,
    approvalsGranted: 1,
    approvalsAborted: 0,
    approvalToCommitMs: 1,
    commitAttempts: 1,
    duplicateCommitRequestsBlocked: 0,
    staleApprovalsBlocked: 0,
    changedTermsReapprovalRequired: 0,
    destructiveClicksExecuted: 1,
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

describe("fresh-session verification runtime", () => {
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

  function setup(
    options: {
      sessionId?: string
      fields?: ReadOnlyObservation["fields"]
      text?: string
      failGoto?: boolean
      replayUnavailable?: boolean
      failBrowserClose?: boolean
      noExecution?: boolean
    } = {},
  ) {
    const repository = createAgentRepository(database)
    const job = verifyingJob()
    if (options.noExecution) job.destructiveClicksExecuted = 0
    repository.createJob(job)
    database
      .prepare(
        `INSERT INTO commit_attempts (
      id, job_id, action_fingerprint, armed_at, final_action_attempted_at,
      click_started_at, click_returned_at, outcome, session_id
    ) VALUES ('attempt_1', ?, ?, ?, ?, ?, ?, ?, 'execution_session')`,
      )
      .run(
        job.id,
        "a".repeat(64),
        job.createdAt,
        job.createdAt,
        job.createdAt,
        job.createdAt,
        options.noExecution ? "NOT_EXECUTED" : "CLICK_RETURNED",
      )
    const closeBrowser = vi.fn(async () => {
      if (options.failBrowserClose) throw new Error("close failed")
    })
    const closeClient = vi.fn(async () => undefined)
    const screenshot = vi.fn(async () => undefined)
    const goto = vi.fn(async () => {
      if (options.failGoto) throw new Error("timeout")
    })
    const fields = options.fields ?? [
      { label: "Membership", value: "Canceled" },
      { label: "Auto-renew", value: "Off" },
      { label: "Next charge", value: "None" },
    ]
    const dependencies = {
      repository,
      artifactDirectory: "artifacts/test-verification",
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-09-02T12:10:00.000Z"))
        .mockReturnValueOnce(new Date("2026-09-02T12:10:01.000Z"))
        .mockReturnValueOnce(new Date("2026-09-02T12:10:02.000Z")),
      id: () => "evidence_1",
      replayAttempts: 1,
      replayDelayMs: 0,
      navigationAttempts: 2,
      createClient: () => ({
        profiles: {
          list: async () => [],
          create: async ({ name }: { name: string }) => ({
            id: "unused",
            name,
          }),
          save: async () => ({}),
        },
        sessions: {
          getReplayUrl: async () => {
            if (options.replayUnavailable) throw { status: 404 }
            return { url: "https://replay.example/verification" }
          },
        },
        launch: async ({ profileId }: { profileId: string }) => {
          expect(profileId).toBe("profile_1")
          return {
            id: options.sessionId ?? "verification_session",
            close: closeBrowser,
            newPage: async () => ({
              goto,
              url: () => "https://cleanbreak.example/demo/streammax/billing",
              title: async () => "StreamMax | Billing",
              evaluate: async <T>() =>
                ({
                  visibleText:
                    options.text ??
                    "No future charge scheduled. Your access remains available until September 28, 2026.",
                  fields,
                }) as T,
              screenshot,
            }),
          }
        },
        close: closeClient,
      }),
    }
    return {
      repository,
      job,
      dependencies,
      closeBrowser,
      closeClient,
      screenshot,
      goto,
    }
  }

  it("uses a fresh session ID with the same profile and persists verification evidence", async () => {
    const run = setup()
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(result.state).toBe("VERIFIED")
    expect(result.verification?.verificationSessionId).toBe(
      "verification_session",
    )
    expect(result.verification?.verificationSessionId).not.toBe(
      "execution_session",
    )
    expect(result.verification?.evidence[0]).toMatchObject({
      phase: "VERIFICATION",
      sessionId: "verification_session",
    })
    expect(result.verificationScreenshots).toBe(1)
  })

  it("hard-rejects an execution session reused as verification", async () => {
    const run = setup({ sessionId: "execution_session" })
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(result).toMatchObject({
      state: "INCONCLUSIVE",
      freshSessionMismatchFailures: 1,
    })
    expect(result.verification?.errorCode).toBe(
      "VERIFICATION_SESSION_NOT_FRESH",
    )
    expect(run.screenshot).not.toHaveBeenCalled()
  })

  it("returns NOT_VERIFIED for authoritative active future billing", async () => {
    const run = setup({
      fields: [
        { label: "Membership", value: "Active" },
        { label: "Auto-renew", value: "On" },
        { label: "Next charge", value: "September 28, 2026" },
      ],
      text: "Premium active. Future billing scheduled.",
    })
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(result.state).toBe("FAILED")
    expect(result.verification?.status).toBe("NOT_VERIFIED")
    expect(result.falseVerified).toBe(0)
  })

  it("maps browser failure to INCONCLUSIVE and performs bounded read-only retries", async () => {
    const run = setup({ failGoto: true })
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(result.verification?.status).toBe("INCONCLUSIVE")
    expect(run.goto).toHaveBeenCalledTimes(2)
    expect(run.screenshot).not.toHaveBeenCalled()
    expect(run.closeBrowser).toHaveBeenCalledOnce()
    expect(run.closeClient).toHaveBeenCalledOnce()
  })

  it("verifies an already-canceled account without a destructive click", async () => {
    const run = setup({ noExecution: true })
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(result.state).toBe("VERIFIED")
    expect(result.destructiveClicksExecuted).toBe(0)
    expect(result.commitAttempt?.outcome).toBe("NOT_EXECUTED")
  })

  it("can verify when replay processing is unavailable", async () => {
    const run = setup({ replayUnavailable: true })
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(result.state).toBe("VERIFIED")
    expect(result.verification).toMatchObject({
      recordingStatus: "UNAVAILABLE",
      replayUrl: null,
    })
  })

  it("releases browser and client after successful verification", async () => {
    const run = setup()
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(run.closeBrowser).toHaveBeenCalledOnce()
    expect(run.closeClient).toHaveBeenCalledOnce()
    expect(result.verification).toMatchObject({
      browserReleased: true,
      clientClosed: true,
    })
  })

  it("still closes the client when browser cleanup throws", async () => {
    const run = setup({ failBrowserClose: true })
    const result = await runIndependentVerification(
      run.job.id,
      run.dependencies,
    )
    expect(run.closeClient).toHaveBeenCalledOnce()
    expect(result.verification?.clientClosed).toBe(true)
  })

  it("is idempotent and never starts a second verifier for a completed job", async () => {
    const run = setup()
    await runIndependentVerification(run.job.id, run.dependencies)
    const again = await runIndependentVerification(run.job.id, run.dependencies)
    expect(again.verificationsStarted).toBe(1)
  })

  it("counts verified savings only after a VERIFIED result", async () => {
    const run = setup()
    expect(run.repository.getVerifiedAnnualSavingsCents()).toBe(0)
    await runIndependentVerification(run.job.id, run.dependencies)
    expect(run.repository.getVerifiedAnnualSavingsCents()).toBe(35988)
  })
})
