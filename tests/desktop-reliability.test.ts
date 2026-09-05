import sharp from "sharp"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDesktopPlanner } from "@/lib/desktop/planner"
import { stabilizeDesktopPage } from "@/lib/desktop/stabilize"
import { renderImage } from "./helpers/render-image"

const decision = {
  type: "key",
  x: null,
  y: null,
  text: null,
  keys: ["Tab"],
  deltaY: null,
  targetText: null,
  visibleText: null,
  observedOrigin: "https://provider.example",
  destinationOrigin: null,
  pageStatus: "authenticated_provider",
  flowStage: "BILLING",
  reasoning: "Navigation",
  confidence: 0.99,
  reason: null,
}
const observation = {
  screenshot: renderImage,
  width: 400,
  height: 240,
  allowedOrigin: "https://provider.example",
  history: [],
  remainingTokens: 20_000,
}
function planning() {
  const response = {
    output_parsed: decision,
    usage: { input_tokens: 100, output_tokens: 20 },
  }
  const parse = vi.fn(async () => response)
  const sleep = vi.fn(async () => undefined)
  const planner = createDesktopPlanner(
    {
      apiKey: "offline",
      model: "offline",
      maxSteps: 20,
      minConfidence: 0.9,
      requestTimeoutMs: 1000,
    },
    { responses: { parse } },
    { sleep },
  )
  return { parse, sleep, planner, response }
}
afterEach(() => vi.useRealTimers())

describe("read-only screenshot planner retries", () => {
  it.each([408, 409, 429, 500, 503])(
    "retries transient status %s at most twice",
    async (status) => {
      const h = planning()
      h.parse
        .mockRejectedValueOnce(
          Object.assign(new Error("private-body"), { status }),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error("private-body"), { status }),
        )
      expect(await h.planner(observation)).toMatchObject({
        decision,
        tokens: 120,
      })
      expect(h.parse).toHaveBeenCalledTimes(3)
      expect(h.sleep.mock.calls).toEqual([[250], [500]])
    },
  )
  it.each([
    new TypeError("fetch failed"),
    new SyntaxError("private-parse"),
    Object.assign(new Error("private-network"), { name: "APIConnectionError" }),
  ])(
    "retries transient network/parse error %# without leaking it",
    async (error) => {
      const h = planning()
      h.parse.mockRejectedValue(error)
      await expect(h.planner(observation)).rejects.toThrow("PLANNER_FAILED")
      expect(h.parse).toHaveBeenCalledTimes(3)
    },
  )
  it("retries invalid structured output and counts all reported usage", async () => {
    const h = planning()
    h.parse.mockResolvedValueOnce({
      output_parsed: { ...decision, type: "invalid" },
      usage: { input_tokens: 100, output_tokens: 20 },
    })
    expect(await h.planner(observation)).toMatchObject({ tokens: 240 })
    expect(h.parse).toHaveBeenCalledTimes(2)
  })
  it("does not hide earlier parse-failure tokens from the budget", async () => {
    const h = planning()
    h.parse.mockResolvedValueOnce({
      output_parsed: { ...decision, type: "invalid" },
      usage: { input_tokens: 100, output_tokens: 20 },
    })
    await expect(
      h.planner({ ...observation, remainingTokens: 200 }),
    ).rejects.toThrow("TOKEN_BUDGET")
    expect(h.parse).toHaveBeenCalledTimes(2)
  })
  it.each([400, 401, 403])(
    "does not retry permanent status %s",
    async (status) => {
      const h = planning()
      h.parse.mockRejectedValue(
        Object.assign(new Error("private-error"), { status }),
      )
      await expect(h.planner(observation)).rejects.toThrow("PLANNER_FAILED")
      expect(h.parse).toHaveBeenCalledOnce()
    },
  )
  it("never retries refusals", async () => {
    const h = planning()
    h.parse.mockResolvedValue({
      ...h.response,
      output: [{ content: [{ type: "refusal" }] }],
    } as typeof h.response)
    await expect(h.planner(observation)).rejects.toThrow("PLANNER_REFUSED")
    expect(h.parse).toHaveBeenCalledOnce()
  })
  it("stops before a retry if interrupted", async () => {
    const h = planning()
    const abort = new AbortController()
    h.parse.mockRejectedValue(new TypeError("fetch failed"))
    h.sleep.mockImplementation(async () => {
      abort.abort()
    })
    await expect(
      h.planner({ ...observation, signal: abort.signal }),
    ).rejects.toThrow()
    expect(h.parse).toHaveBeenCalledOnce()
  })
  it("does not request when token budget is exhausted", async () => {
    const h = planning()
    await expect(
      h.planner({ ...observation, remainingTokens: 0 }),
    ).rejects.toThrow("TOKEN_BUDGET")
    expect(h.parse).not.toHaveBeenCalled()
  })
})

describe("bounded page-transition stabilization", () => {
  it("waits at least 750ms, then requires two consecutive visually stable frames", async () => {
    const screenshot = vi.fn(async () => renderImage)
    const sleep = vi.fn(async () => undefined)
    const result = await stabilizeDesktopPage(
      { screenshot },
      sleep,
      new AbortController().signal,
    )
    expect(sleep.mock.calls).toEqual([[750], [250]])
    expect(sleep.mock.invocationCallOrder[0]).toBeLessThan(
      screenshot.mock.invocationCallOrder[0],
    )
    expect(screenshot).toHaveBeenCalledTimes(2)
    expect(result.metrics).toMatchObject({
      stable: true,
      captures: 2,
      deadlineReached: false,
    })
  })
  it("waits through material changes until consecutive frames settle", async () => {
    const changed = await sharp(renderImage).negate().png().toBuffer()
    const screenshot = vi
      .fn(async () => changed)
      .mockResolvedValueOnce(renderImage)
    const result = await stabilizeDesktopPage(
      { screenshot },
      async () => {},
      new AbortController().signal,
    )
    expect(result.metrics.captures).toBe(3)
    expect(result.metrics.stable).toBe(true)
  })
  it("has a poll-count bound even with immediate sleeps and endless animation", async () => {
    const changed = await sharp(renderImage).negate().png().toBuffer()
    let index = 0
    const screenshot = vi.fn(async () => (index++ % 2 ? changed : renderImage))
    const result = await stabilizeDesktopPage(
      { screenshot },
      async () => {},
      new AbortController().signal,
    )
    expect(screenshot).toHaveBeenCalledTimes(18)
    expect(result.metrics).toMatchObject({
      stable: false,
      deadlineReached: true,
    })
  })
  it("limits even an unresponsive screenshot RPC to five seconds", async () => {
    vi.useFakeTimers()
    const screenshot = vi.fn(() => new Promise<Uint8Array>(() => {}))
    const result = stabilizeDesktopPage(
      { screenshot },
      async (ms) => new Promise((done) => setTimeout(done, ms)),
      new AbortController().signal,
    )
    const checked = expect(result).rejects.toThrow("PAGE_STABILIZATION_FAILED")
    await vi.advanceTimersByTimeAsync(5000)
    await checked
    expect(screenshot).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it("fails closed on decode errors without returning private decoder messages", async () => {
    const screenshot = vi.fn(async () => new Uint8Array())
    await expect(
      stabilizeDesktopPage(
        { screenshot },
        async () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("PAGE_STABILIZATION_FAILED")
    expect(screenshot).toHaveBeenCalledTimes(2)
  })
  it("stops immediately on cancellation without dispatching anything", async () => {
    const abort = new AbortController()
    abort.abort()
    const screenshot = vi.fn(async () => renderImage)
    await expect(
      stabilizeDesktopPage({ screenshot }, async () => {}, abort.signal),
    ).rejects.toThrow()
    expect(screenshot).not.toHaveBeenCalled()
  })
})
