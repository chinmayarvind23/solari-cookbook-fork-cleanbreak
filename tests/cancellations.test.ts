import { afterEach, describe, expect, it, vi } from "vitest"
import { createDatabase } from "@/lib/db"
import { CancellationFailure } from "@/lib/cancellations/failure"
import { cancellationRepository } from "@/lib/cancellations/repository"
import {
  runCancellation,
  WorkflowCrash,
  type CancellationDriver,
} from "@/lib/cancellations/service"
import {
  billingVerdict,
  actionFingerprint,
  validFinal,
} from "@/lib/cancellations/policy"
import { digest, liveEnabled } from "@/lib/cancellations/config"
import { publicJob } from "@/lib/cancellations/public"
import {
  claimAndDispatch,
  consumeFinalDispatch,
} from "@/lib/cancellations/dispatch"
import { operatorAllowed, sameOriginPost } from "@/lib/cancellations/security"
import type { Observation, Scope } from "@/lib/cancellations/state"

const scope: Scope = {
  provider: "miro",
  providerOrigin: "https://miro.com",
  subscriptionKey: "test-subscription-hash",
  sessionBinding: "test-session-hash",
  planName: "Business Plan Trial",
  expectedAmountCents: 24000,
  currency: "USD",
  interval: "YEARLY",
  accessPolicy: "PRESERVE_PREPAID_ACCESS",
}
const at = Date.parse("2026-09-05T00:00:00Z")
const observation = (): Observation => ({
  version: 1,
  observedAt: new Date(at).toISOString(),
  contextId: "execution-context",
  scope,
  matched: true,
  authenticated: true,
  confidence: 1,
  surface: "FINAL_CANCELLATION",
  target: "Cancel subscription",
  x: 200,
  y: 300,
  width: 1280,
  height: 720,
  targetCount: 1,
  intent: "STOP_FUTURE_RENEWAL",
  fee: "NONE",
  newCharge: "NONE",
  access: "THROUGH_TERM",
  unrelatedChanges: false,
  ambiguous: false,
  billing: {
    subscriptionStatus: "ACTIVE",
    renewalStatus: "ON",
    nextChargePresent: true,
    nextChargeAmountCents: 24000,
    nextChargeDate: "2026-09-20",
    accessUntil: "2026-09-20",
  },
  screenshot: "final.png",
  screenshotHash: "test-screenshot-hash",
})
const databases: ReturnType<typeof createDatabase>[] = []
afterEach(() => {
  databases.splice(0).forEach((db) => db.close())
  vi.restoreAllMocks()
})
function setup() {
  let now = at
  const db = createDatabase(":memory:")
  databases.push(db)
  const repo = cancellationRepository(db, () => now)
  const job = repo.create(scope, "request-key-initial")
  const driver = {
    scope,
    assertEnabled: vi.fn(),
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    navigate: vi.fn(
      async (progress: Parameters<CancellationDriver["navigate"]>[0]) => {
        progress("CANCELLATION_FLOW", [
          { step: 1, stage: "CANCELLATION_ENTRY", screenshotHash: "test-hash" },
        ])
        return observation()
      },
    ),
    revalidate: vi.fn(async () => observation()),
    clickFinal: vi.fn(async () => undefined),
    verify: vi.fn(async () => ({
      contextId: "verification-context",
      fresh: true,
      observation: {
        ...observation(),
        observedAt: new Date(now).toISOString(),
        contextId: "verification-context",
        surface: "BILLING_PAGE" as const,
        screenshotHash: "fresh-verification-hash",
        billing: {
          ...observation().billing,
          subscriptionStatus: "CANCELED" as const,
          renewalStatus: "OFF" as const,
          nextChargePresent: false,
          nextChargeAmountCents: null,
          nextChargeDate: null,
        },
      },
    })),
  }
  return {
    db,
    repo,
    job,
    driver,
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
    run: () => runCancellation(job.id, repo, driver, { now: () => now }),
  }
}
describe("durable one-click authorization", () => {
  it("recording cleanup failure is terminal metadata, not a repeated cancellation", async () => {
    const h = setup()
    const finishRecording = vi.fn(async () => {
      throw new Error("private-sdk-error")
    })
    Object.assign(h.driver, { finishRecording })
    const result = await h.run()
    expect(result).toMatchObject({
      state: "VERIFIED",
      recording: { status: "FAILED", filename: null, sizeBytes: 0 },
      destructiveClicksExecuted: 1,
      automaticDestructiveRetries: 0,
    })
    expect(JSON.stringify(result)).not.toContain("private-sdk-error")
    await h.run()
    expect(finishRecording).toHaveBeenCalledOnce()
    expect(h.driver.clickFinal).toHaveBeenCalledOnce()
    expect(h.driver.close).toHaveBeenCalled()
  })
  it("finalizes one recording after independent verification without adding another click", async () => {
    const h = setup()
    const finishRecording = vi.fn(async () => {
      expect(h.repo.load(h.job.id)?.state).toBe("VERIFIED")
      expect(h.driver.verify).toHaveBeenCalledOnce()
      return {
        status: "AVAILABLE" as const,
        filename: "cancellation.mp4" as const,
        sizeBytes: 16,
      }
    })
    Object.assign(h.driver, { finishRecording })
    const result = await h.run()
    expect(result).toMatchObject({
      state: "VERIFIED",
      destructiveClicksExecuted: 1,
      automaticDestructiveRetries: 0,
      recording: { status: "AVAILABLE", filename: "cancellation.mp4" },
    })
    expect(finishRecording).toHaveBeenCalledOnce()
    expect(h.driver.clickFinal).toHaveBeenCalledOnce()
  })
  it.each([
    ["DESKTOP_NAVIGATION_TOKEN_BUDGET", "planner token limit"],
    ["DESKTOP_NAVIGATION_NO_PROGRESS", "no visible progress"],
    ["DESKTOP_NAVIGATION_MAX_STEPS", "step limit"],
  ] as const)(
    "persists %s and exposes an actionable safe message without consuming authorization",
    async (code, message) => {
      const h = setup()
      h.driver.navigate.mockRejectedValueOnce(new CancellationFailure(code))
      const result = await h.run()
      expect(result).toMatchObject({
        state: "FAILED",
        reason: code,
        authorizationUses: 0,
        destructiveClicksAttempted: 0,
        destructiveClicksExecuted: 0,
      })
      expect(publicJob(result!).message).toContain(message)
      expect(h.driver.clickFinal).not.toHaveBeenCalled()
    },
  )
  it("reports typed navigation failure without consuming authority or dispatching", async () => {
    const h = setup()
    h.driver.navigate.mockRejectedValueOnce(
      new CancellationFailure("PROVIDER_LOADING_TIMEOUT"),
    )
    const result = await h.run()
    expect(result).toMatchObject({
      state: "FAILED",
      reason: "PROVIDER_LOADING_TIMEOUT",
      authorizationUses: 0,
      destructiveClicksAttempted: 0,
      destructiveClicksExecuted: 0,
    })
    expect(h.driver.clickFinal).not.toHaveBeenCalled()
  })
  it("does not expose raw provider failures", async () => {
    const h = setup()
    h.driver.navigate.mockRejectedValueOnce(
      new Error("private-provider-sentinel"),
    )
    const result = await h.run()
    expect(result?.reason).toBe("WORKFLOW_FAILED_CLOSED")
    expect(JSON.stringify(result)).not.toContain("private-provider-sentinel")
  })
  it("persists immutable scoped one-shot authorization before any provider interaction", () => {
    const h = setup()
    expect(h.job.authorization).toMatchObject({
      ...scope,
      intent: "CANCEL_SUBSCRIPTION",
      maxDestructiveActions: 1,
    })
    expect(h.job.authorizationStatus).toBe("ARMED")
    expect(h.driver.connect).not.toHaveBeenCalled()
    expect(() =>
      h.db.prepare("UPDATE one_click_authorizations SET payload='{}'").run(),
    ).toThrow("IMMUTABLE_AUTHORIZATION")
  })
  it("deduplicates retries and double-clicks even with different keys", () => {
    const h = setup()
    expect(h.repo.create(scope, "request-key-initial").id).toBe(h.job.id)
    expect(h.repo.create(scope, "different-request-key").id).toBe(h.job.id)
    expect(() =>
      h.repo.create(
        { ...scope, subscriptionKey: "different-account" },
        "another-key",
      ),
    ).toThrow("SUBSCRIPTION_BUSY")
  })
  it("expires before connecting", async () => {
    const h = setup()
    h.advance(16 * 60_000)
    expect((await h.run())?.reason).toBe("AUTHORIZATION_EXPIRED")
    expect(h.driver.connect).not.toHaveBeenCalled()
    expect(h.driver.clickFinal).not.toHaveBeenCalled()
  })
  it.each([
    "provider",
    "providerOrigin",
    "subscriptionKey",
    "sessionBinding",
    "planName",
    "expectedAmountCents",
    "currency",
    "interval",
  ] as const)("rejects changed %s", async (field) => {
    const h = setup()
    h.driver.scope = {
      ...scope,
      [field]: field === "expectedAmountCents" ? 1 : "different",
    } as Scope
    expect((await h.run())?.reason).toBe("AUTHORIZATION_MISMATCH")
    expect(h.driver.clickFinal).not.toHaveBeenCalled()
  })
  it("defaults live off and requires all three exact opt-ins", () => {
    expect(liveEnabled({})).toBe(false)
    const env = {
      CLEANBREAK_DRY_RUN: "false",
      CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
      CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL: "true",
    }
    expect(liveEnabled(env)).toBe(true)
    for (const key of Object.keys(env))
      expect(liveEnabled({ ...env, [key]: undefined })).toBe(false)
  })
})
describe("one-shot commit, checkpoints and independent verification", () => {
  it("the durable gate mints only one bound, non-copyable dispatch grant", async () => {
    const h = setup()
    await expect(
      runCancellation(h.job.id, h.repo, h.driver, {
        now: h.now,
        fault: () => {
          throw new WorkflowCrash()
        },
      }),
    ).rejects.toBeInstanceOf(WorkflowCrash)
    expect(h.repo.acquire(h.job.id, "permit-test")).toBe(true)
    const boundary = h.repo.load(h.job.id)!.boundary!
    await claimAndDispatch(h.repo, h.job.id, "permit-test", async (grant) => {
      expect(() =>
        consumeFinalDispatch({ ...grant }, h.job.id, boundary),
      ).toThrow("COMMIT_GATE_REQUIRED")
      consumeFinalDispatch(grant, h.job.id, boundary)
      expect(() => consumeFinalDispatch(grant, h.job.id, boundary)).toThrow(
        "COMMIT_GATE_REQUIRED",
      )
    })
    expect(h.repo.claim(h.job.id, "permit-test")).toBeNull()
  })
  it("navigates, revalidates, claims one click, independently verifies and receipts with no second approval", async () => {
    const h = setup(),
      result = (await h.run())!
    expect(result).toMatchObject({
      state: "VERIFIED",
      authorizationStatus: "CONSUMED",
      authorizationUses: 1,
      destructiveClicksAttempted: 1,
      destructiveClicksExecuted: 1,
      automaticDestructiveRetries: 0,
      unsafeActionsExecuted: 0,
    })
    expect(h.driver.clickFinal).toHaveBeenCalledTimes(1)
    expect(h.driver.revalidate.mock.invocationCallOrder[0]).toBeLessThan(
      h.driver.clickFinal.mock.invocationCallOrder[0],
    )
    expect(h.driver.close.mock.invocationCallOrder[0]).toBeLessThan(
      h.driver.verify.mock.invocationCallOrder[0],
    )
    expect(result.receipt!.digest).toBe(digest(result.receipt!.payload))
    const checkpointStates = h.db
      .prepare("SELECT state FROM one_click_checkpoints ORDER BY version")
      .all()
      .map((r) => r.state)
    expect(checkpointStates).toContain("COMMIT_ARMED")
    expect(checkpointStates).toContain("COMMITTING")
    expect(checkpointStates).toContain("VERIFYING")
    expect(h.repo.create(scope, "new-after-success").id).toBe(h.job.id)
    await h.run()
    expect(h.driver.clickFinal).toHaveBeenCalledTimes(1)
  })
  it.each([
    { fee: "PRESENT" },
    { newCharge: "PRESENT" },
    { access: "IMMEDIATE_LOSS" },
    { unrelatedChanges: true },
    { ambiguous: true },
    { authenticated: false },
    { matched: false },
    { intent: "OTHER" },
    { target: "UNKNOWN" },
    { targetCount: 2 },
    { x: -1 },
    { fee: "UNKNOWN" },
    { confidence: 0.94 },
    { surface: "UNKNOWN" },
  ] satisfies Partial<Observation>[])(
    "blocks changed/material terms %j",
    async (patch) => {
      const h = setup()
      h.driver.revalidate.mockResolvedValue({ ...observation(), ...patch })
      expect((await h.run())?.reason).toBe("AUTHORIZATION_MISMATCH")
      expect(h.driver.clickFinal).not.toHaveBeenCalled()
    },
  )
  it("unknown click response never retries and never asserts executed=1 or issues a receipt", async () => {
    const h = setup()
    h.driver.clickFinal.mockRejectedValue(
      new Error("SDK private-error-sentinel"),
    )
    const result = (await h.run())!
    expect(result.state).toBe("INCONCLUSIVE")
    expect(result.receipt).toBeNull()
    expect(result.authorizationUses).toBe(1)
    expect(result.destructiveClicksExecuted).toBe(0)
    expect(JSON.stringify(result)).not.toContain("private-error-sentinel")
    await h.run()
    expect(h.driver.clickFinal).toHaveBeenCalledTimes(1)
  })
  it("recovers COMMIT_ARMED with fresh revalidation before its only dispatch", async () => {
    const h = setup()
    await expect(
      runCancellation(h.job.id, h.repo, h.driver, {
        now: h.now,
        fault: () => {
          throw new WorkflowCrash()
        },
      }),
    ).rejects.toBeInstanceOf(WorkflowCrash)
    expect(h.repo.load(h.job.id)?.state).toBe("COMMIT_ARMED")
    expect(h.driver.clickFinal).not.toHaveBeenCalled()
    expect((await h.run())?.state).toBe("VERIFIED")
    expect(h.driver.revalidate).toHaveBeenCalledTimes(2)
    expect(h.driver.clickFinal).toHaveBeenCalledTimes(1)
  })
  it("recovers a durable claim directly into verification without any click", async () => {
    const h = setup()
    await expect(
      runCancellation(h.job.id, h.repo, h.driver, {
        now: h.now,
        fault: () => {
          throw new WorkflowCrash()
        },
      }),
    ).rejects.toBeInstanceOf(WorkflowCrash)
    expect(h.repo.acquire(h.job.id, "crashed-worker")).toBe(true)
    h.repo.claim(h.job.id, "crashed-worker")
    h.advance(120_001)
    const result = await h.run()
    expect(result?.state).toBe("INCONCLUSIVE")
    expect(h.driver.clickFinal).not.toHaveBeenCalled()
    expect(h.driver.verify).toHaveBeenCalledTimes(1)
  })
  it("duplicate workers cannot double-dispatch", async () => {
    const h = setup()
    await Promise.all([h.run(), h.run(), h.run()])
    expect(h.driver.clickFinal).toHaveBeenCalledTimes(1)
  })
  it.each(["same-context", "not-fresh", "login", "conflict", "active"])(
    "verification %s is never false success",
    async (variant) => {
      const h = setup(),
        v = await h.driver.verify()
      h.driver.verify.mockClear()
      if (variant === "same-context") v.contextId = "execution-context"
      if (variant === "not-fresh") v.fresh = false
      if (variant === "login") v.observation.authenticated = false
      if (variant === "conflict") v.observation.billing.nextChargePresent = true
      if (variant === "active")
        Object.assign(v.observation.billing, observation().billing)
      h.driver.verify.mockResolvedValue(v)
      const result = await h.run()
      expect(result?.state).toBe(
        variant === "active" ? "NOT_VERIFIED" : "INCONCLUSIVE",
      )
      expect(result?.receipt).toBeNull()
    },
  )
  it("canonical fingerprint binds material fields and explicit version/time", () => {
    const h = setup(),
      o = observation()
    expect(actionFingerprint(h.job.authorization, o)).toBe(
      actionFingerprint(h.job.authorization, { ...o }),
    )
    expect(actionFingerprint(h.job.authorization, o)).not.toBe(
      actionFingerprint(h.job.authorization, { ...o, x: 201 }),
    )
    expect(
      validFinal(
        h.job.authorization,
        { ...o, observedAt: new Date(at - 31_000).toISOString() },
        at,
      ),
    ).toBe(false)
  })
  it("safe public status excludes screenshots, session bindings and internal observations", async () => {
    const h = setup(),
      result = publicJob((await h.run())!)
    expect(result.receiptUrl).toContain("/receipt")
    expect(JSON.stringify(result)).not.toContain("test-session-hash")
    expect(JSON.stringify(result)).not.toContain("test-screenshot-hash")
  })
})
describe("web request protections", () => {
  it("blocks cross-origin POSTs and missing authorization", () => {
    const headers = new Headers({
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "content-type": "application/json",
    })
    expect(sameOriginPost(headers, {})).toBe(true)
    headers.set("origin", "https://unrelated.example")
    expect(sameOriginPost(headers, {})).toBe(false)
    expect(
      operatorAllowed(headers, {
        CLEANBREAK_OPERATOR_PASSWORD: "not-a-real-operator-credential",
      }),
    ).toBe(false)
  })
  it("conflicting billing or missing charge evidence is inconclusive", () => {
    expect(
      billingVerdict({
        ...observation().billing,
        subscriptionStatus: "CANCELED",
      }),
    ).toBe("INCONCLUSIVE")
    expect(
      billingVerdict({ ...observation().billing, nextChargePresent: null }),
    ).toBe("INCONCLUSIVE")
  })
})
