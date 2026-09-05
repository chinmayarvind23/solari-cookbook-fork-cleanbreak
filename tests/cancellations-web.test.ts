import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { CancellationCard } from "@/components/cancellation-card"
import { createDatabase } from "@/lib/db"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { POST } from "@/app/api/cancellations/route"
import { GET } from "@/app/api/cancellations/[id]/route"
import { GET as receiptGET } from "@/app/api/cancellations/[id]/receipt/route"
import type { Job } from "@/lib/cancellations/state"
import { canStartNewAttempt } from "@/lib/cancellations/new-attempt"
const shared = vi.hoisted(() => ({
  repository: undefined as
    ReturnType<typeof cancellationRepository> | undefined,
  scheduled: [] as Array<() => Promise<void>>,
}))
vi.mock("@/lib/cancellations/repository", async (original) => ({
  ...(await original<typeof import("@/lib/cancellations/repository")>()),
  cancellationRepository: () => shared.repository,
}))
vi.mock("@/lib/cancellations/worker", () => ({
  executeCancellation: vi.fn(async () => undefined),
}))
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => shared.scheduled.push(fn),
}))
const original = await vi.importActual<
  typeof import("@/lib/cancellations/repository")
>("@/lib/cancellations/repository")
let db: ReturnType<typeof createDatabase>
beforeEach(() => {
  db = createDatabase(":memory:")
  shared.repository = original.cancellationRepository(db)
  shared.scheduled = []
  vi.stubEnv("CLEANBREAK_OPERATOR_PASSWORD", "")
  vi.stubEnv("CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL", "false")
  vi.stubEnv("CLEANBREAK_APP_ORIGIN", "http://localhost:3000")
})
afterEach(() => {
  db.close()
  vi.unstubAllEnvs()
})
const request = (
  key = "test-request-key-1234",
  body: { provider: string; retryOf?: string } = { provider: "streammax" },
  origin = "http://localhost:3000",
) =>
  new Request("http://localhost:3000/api/cancellations", {
    method: "POST",
    headers: {
      Origin: origin,
      Host: "localhost:3000",
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  })
describe("one-click server routes", () => {
  async function failedJob(patch: Partial<Job> = {}) {
    const initial = await (await POST(request())).json()
    const repo = shared.repository!,
      owner = "test-owner"
    expect(repo.acquire(initial.id, owner)).toBe(true)
    const failed = repo.save(
      {
        ...repo.load(initial.id)!,
        state: "FAILED",
        authorizationStatus: "EXPIRED",
        reason: "FINAL_BOUNDARY_NOT_ESTABLISHED",
        ...patch,
      },
      owner,
    )
    repo.unlockUnclaimed(failed)
    repo.release(initial.id, owner)
    shared.scheduled = []
    return failed
  }
  it("an explicit new request creates a fresh scoped authorization without changing the failed job", async () => {
    const previous = await failedJob()
    expect(canStartNewAttempt(previous)).toBe(true)
    const response = await POST(
      request("new-attempt-key-1234", {
        provider: "streammax",
        retryOf: previous.id,
      }),
    )
    expect(response.status).toBe(202)
    const current = await response.json()
    expect(current.id).not.toBe(previous.id)
    expect(current.state).toBe("AUTHORIZED")
    expect(current.authorizationUses).toBe(0)
    expect(shared.repository!.load(current.id)!.authorization.id).not.toBe(
      previous.authorization.id,
    )
    expect(shared.repository!.load(previous.id)).toEqual(previous)
    expect(shared.scheduled).toHaveLength(1)
    const replay = await (
      await POST(
        request("new-attempt-key-1234", {
          provider: "streammax",
          retryOf: previous.id,
        }),
      )
    ).json()
    expect(replay.id).toBe(current.id)
    const doubleClick = await (
      await POST(
        request("new-attempt-key-5678", {
          provider: "streammax",
          retryOf: previous.id,
        }),
      )
    ).json()
    expect(doubleClick.id).toBe(current.id)
    expect(
      db.prepare("SELECT count(*) n FROM one_click_authorizations").get()?.n,
    ).toBe(2)
  })
  it.each([
    { authorizationUses: 1 },
    { destructiveClicksAttempted: 1 },
    { destructiveClicksExecuted: 1 },
    { authorizationStatus: "CONSUMED" },
    { reason: "WORKFLOW_FAILED_CLOSED" },
    { reason: "ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY" },
  ] satisfies Partial<Job>[])(
    "server rejects an ineligible prior failure %j",
    async (patch) => {
      const previous = await failedJob(patch)
      expect(canStartNewAttempt(previous)).toBe(false)
      const response = await POST(
        request("new-attempt-key-1234", {
          provider: "streammax",
          retryOf: previous.id,
        }),
      )
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: "NEW_ATTEMPT_NOT_ALLOWED",
      })
      expect(shared.scheduled).toHaveLength(0)
      expect(
        db.prepare("SELECT count(*) n FROM one_click_authorizations").get()?.n,
      ).toBe(1)
    },
  )
  it("rejects missing/active predecessors and changed scope without changing locks", async () => {
    const active = await (await POST(request())).json()
    shared.scheduled = []
    for (const retryOf of [active.id, "missing-job-identifier"]) {
      expect(
        (
          await POST(
            request("new-attempt-key-1234", { provider: "streammax", retryOf }),
          )
        ).status,
      ).toBe(409)
    }
    expect(shared.scheduled).toHaveLength(0)
    const previous = await failedJob()
    const {
      id: _id,
      intent: _intent,
      authorizedAt: _at,
      expiresAt: _expires,
      maxDestructiveActions: _max,
      ...scope
    } = previous.authorization
    expect(() =>
      shared.repository!.create(
        { ...scope, expectedAmountCents: 1 },
        "new-attempt-key-1234",
        previous.id,
      ),
    ).toThrow("NEW_ATTEMPT_NOT_ALLOWED")
    expect(shared.repository!.load(previous.id)).toEqual(previous)
  })
  it("clearly labels live irreversible authorization without a second approval button", () => {
    const markup = renderToStaticMarkup(
      createElement(CancellationCard, {
        provider: "miro",
        planName: "Business Trial",
        amountCents: 24000,
        currency: "USD",
        interval: "YEARLY",
        enabled: true,
      }),
    )
    expect(markup).toContain("Live cancellation")
    expect(markup).toContain("one irreversible cancellation")
    expect(markup).toContain("will not ask for a second approval")
    expect(markup.match(/<button/g)).toHaveLength(1)
    expect(markup).not.toContain("disabled=")
  })
  it("disabled live mode explains why dry-run cannot cancel", () => {
    const markup = renderToStaticMarkup(
      createElement(CancellationCard, {
        provider: "miro",
        planName: "Business Trial",
        amountCents: 24000,
        currency: "USD",
        interval: "YEARLY",
        enabled: false,
      }),
    )
    expect(markup).toContain("dry-run never submits")
    expect(markup).toContain("disabled=")
    expect(markup).toContain("Live setup required")
    expect(markup).toContain("npm run dev:live")
  })
  it("initial POST persists authorization and returns immediately before worker runs", async () => {
    const response = await POST(request())
    expect(response.status).toBe(202)
    const job = await response.json()
    expect(job.state).toBe("AUTHORIZED")
    expect(job.authorizationUses).toBe(0)
    expect(shared.scheduled).toHaveLength(1)
    expect(
      shared.repository!.load(job.id)?.authorization.maxDestructiveActions,
    ).toBe(1)
  })
  it("double POST with a new key returns the same active subscription job", async () => {
    const a = await (await POST(request())).json(),
      b = await (await POST(request("test-request-key-5678"))).json()
    expect(a.id).toBe(b.id)
    expect(
      db.prepare("SELECT count(*) n FROM one_click_authorizations").get()?.n,
    ).toBe(1)
  })
  it("polling returns safe progress; no receipt or second approval", async () => {
    const job = await (await POST(request())).json()
    const response = await GET(new Request("http://localhost:3000"), {
      params: Promise.resolve({ id: job.id }),
    })
    const status = await response.json()
    expect(status.message).toBe("Cancellation authorized.")
    expect(status.receiptUrl).toBeNull()
    expect(JSON.stringify(status)).not.toMatch(
      /Approve|screenshot|sessionBinding|reasoning/,
    )
    expect(
      (
        await receiptGET(new Request("http://localhost:3000"), {
          params: Promise.resolve({ id: job.id }),
        })
      ).status,
    ).toBe(404)
  })
  it("rejects CSRF, unsupported providers, and caller-supplied authorization scope", async () => {
    const mismatched = await POST(
      request(undefined, undefined, "http://127.0.0.1:3000"),
    )
    expect(mismatched.status).toBe(403)
    expect(await mismatched.json()).toEqual({ error: "APP_ORIGIN_MISMATCH" })
    expect(
      (await POST(request(undefined, undefined, "https://attacker.example")))
        .status,
    ).toBe(403)
    expect(
      (await POST(request(undefined, { provider: "unknown" }))).status,
    ).toBe(409)
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/cancellations", {
            method: "POST",
            headers: {
              Origin: "http://localhost:3000",
              Host: "localhost:3000",
              "Content-Type": "application/json",
              "Idempotency-Key": "test-request-key-1234",
            },
            body: JSON.stringify({
              provider: "streammax",
              maxDestructiveActions: 2,
            }),
          }),
        )
      ).status,
    ).toBe(409)
    expect(shared.scheduled).toHaveLength(0)
  })
})
