import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDatabase } from "@/lib/db"
import { cancellationRepository } from "@/lib/cancellations/repository"
import { POST } from "@/app/api/cancellations/route"
import { GET } from "@/app/api/cancellations/[id]/route"
import { GET as receiptGET } from "@/app/api/cancellations/[id]/receipt/route"
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
  body = { provider: "streammax" },
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
