import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ReactElement } from "react"
const state = vi.hoisted(() => ({ update: vi.fn(), job: null as unknown }))
// Exercise the actual component event handler with mocked browser I/O; no server,
// worker, provider, or real cancellation is contacted by these tests.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [
    initial === null ? state.job : initial,
    state.update,
  ],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: () => undefined,
}))
import { CancellationCard } from "@/components/cancellation-card"

function button(enabled = true) {
  const root = CancellationCard({
    provider: "miro",
    planName: "Business Trial",
    amountCents: 0,
    currency: "USD",
    interval: "MONTHLY",
    enabled,
  })
  function find(node: unknown): { onClick(): Promise<void> } | undefined {
    if (!node || typeof node !== "object") return
    const element = node as ReactElement<{
      children?: unknown
      onClick(): Promise<void>
    }>
    if (element.type === "button") return element.props
    const children = element.props?.children
    for (const child of Array.isArray(children) ? children : [children]) {
      const match = find(child)
      if (match) return match
    }
  }
  return find(root)!
}
let storage: Map<string, string>
beforeEach(() => {
  state.update.mockClear()
  state.job = null
  storage = new Map()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal("fetch", vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
it("shows an explicit new-attempt button for an eligible restored failure and sends nothing on render", () => {
  state.job = { id: "failed-job", state: "FAILED", canStartNewAttempt: true }
  expect(button()).toBeDefined()
  expect(fetch).not.toHaveBeenCalled()
})
it.each(["COMMITTING", "INCONCLUSIVE", "VERIFIED", "NOT_VERIFIED", "FAILED"])(
  "never offers a new attempt for ineligible %s",
  (status) => {
    state.job = { id: "failed-job", state: status, canStartNewAttempt: false }
    expect(button()).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  },
)
it("an explicit click creates a new request key and retains the previous job ID for the server check", async () => {
  state.job = { id: "failed-job", state: "FAILED", canStartNewAttempt: true }
  storage.set(
    "cleanbreak-cancellation-miro",
    JSON.stringify({ key: "old-request-key-1234", id: "failed-job" }),
  )
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ id: "new-job", state: "AUTHORIZED" }, { status: 202 }),
  )
  await button().onClick()
  const options = vi.mocked(fetch).mock.calls[0][1]!
  expect(options.body).toBe(
    JSON.stringify({ provider: "miro", retryOf: "failed-job" }),
  )
  expect(
    (options.headers as Record<string, string>)["Idempotency-Key"],
  ).not.toBe("old-request-key-1234")
  expect(
    JSON.parse(storage.get("cleanbreak-cancellation-miro")!),
  ).toMatchObject({ id: "new-job" })
})
it("a lost new-attempt response never rotates its pending key on another explicit click", async () => {
  state.job = { id: "failed-job", state: "FAILED", canStartNewAttempt: true }
  vi.mocked(fetch).mockRejectedValue(new Error("private-network-error"))
  const control = button()
  await control.onClick()
  const first = JSON.parse(storage.get("cleanbreak-cancellation-miro")!)
  expect(first).toMatchObject({ id: "failed-job", retryOf: "failed-job" })
  await control.onClick()
  expect(JSON.parse(storage.get("cleanbreak-cancellation-miro")!)).toEqual(
    first,
  )
  expect(state.update.mock.calls.flat().join(" ")).not.toContain(
    "private-network-error",
  )
})
it("never sends when live mode is disabled", async () => {
  await button(false).onClick()
  expect(fetch).not.toHaveBeenCalled()
})
it.each([
  [401, "", "Operator login required"],
  [403, "APP_ORIGIN_MISMATCH", "localhost and 127.0.0.1"],
  [409, "", "npm run dev:live"],
] as const)(
  "shows actionable safe feedback for HTTP %s",
  async (status, error, message) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error }, { status }))
    await button().onClick()
    expect(state.update.mock.calls.flat().join(" ")).toContain(message)
    expect(fetch).toHaveBeenCalledOnce()
  },
)
it("does not echo raw server errors, retry, or rotate an existing request key", async () => {
  storage.set(
    "cleanbreak-cancellation-miro",
    JSON.stringify({ key: "existing-request-key-1234" }),
  )
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "raw-private-response" }, { status: 500 }),
  )
  await button().onClick()
  expect(fetch).toHaveBeenCalledOnce()
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
    "Idempotency-Key": "existing-request-key-1234",
  })
  expect(state.update.mock.calls.flat().join(" ")).not.toContain(
    "raw-private-response",
  )
  expect(state.update.mock.calls.flat().join(" ")).toContain("Do not submit")
})
it("renders returned job progress and retains its idempotent ticket", async () => {
  const job = { id: "test-job", state: "AUTHORIZED" }
  vi.mocked(fetch).mockResolvedValue(Response.json(job, { status: 202 }))
  await button().onClick()
  expect(state.update).toHaveBeenCalledWith(job)
  expect(
    JSON.parse(storage.get("cleanbreak-cancellation-miro")!),
  ).toMatchObject({ id: "test-job" })
})
it("duplicate clicks while submitting make only one request", async () => {
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  const control = button(),
    pending = control.onClick()
  await control.onClick()
  expect(fetch).toHaveBeenCalledOnce()
  finish(Response.json({ id: "test-job", state: "AUTHORIZED" }))
  await pending
})
