import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, vi } from "vitest"
import type { Desktop } from "@solarisdk/desktop"
import { readDesktopConfig, realProviderExecutor } from "@/lib/desktop/config"
import {
  desktopDecisionSchema,
  desktopPolicy,
  NEUTRAL_REASON,
  type DesktopDecision,
} from "@/lib/desktop/decision"
import { createDesktopPlanner } from "@/lib/desktop/planner"
import { runDesktopDryRun } from "@/lib/desktop/runtime"
import { desktopEvidence } from "@/lib/desktop/evidence"
import { startDesktopViewer } from "@/lib/desktop/viewer"

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SOLARI_API_KEY: "private-api-sentinel",
  OPENAI_API_KEY: "private-openai-sentinel",
  SOLARI_DESKTOP_ID: "private-vm-sentinel",
  CLEANBREAK_REAL_PROVIDER_EXECUTOR: "desktop",
  CLEANBREAK_DRY_RUN: "true",
  CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
  CLEANBREAK_REAL_PROVIDER_NAME: "Test Provider",
  CLEANBREAK_REAL_PROVIDER_PLAN_NAME: "Test trial",
  CLEANBREAK_REAL_PROVIDER_URL: "https://provider.example/billing",
  CLEANBREAK_REAL_PROVIDER_AMOUNT_CENTS: "100",
  CLEANBREAK_REAL_PROVIDER_CURRENCY: "USD",
  CLEANBREAK_REAL_PROVIDER_INTERVAL: "MONTHLY",
}
function decision(patch: Partial<DesktopDecision> = {}): DesktopDecision {
  return {
    type: "final_cancel_candidate",
    x: 200,
    y: 300,
    text: null,
    keys: null,
    deltaY: null,
    targetText: "Confirm cancellation",
    visibleText: "No fee",
    observedOrigin: "https://provider.example",
    destinationOrigin: null,
    pageStatus: "authenticated_provider",
    reasoning: "Stop before cancellation",
    confidence: 0.99,
    reason: null,
    ...patch,
  }
}
function png() {
  const bytes = Buffer.alloc(24)
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes)
  bytes.write("IHDR", 12)
  bytes.writeUInt32BE(1280, 16)
  bytes.writeUInt32BE(720, 20)
  return bytes
}
function harness(decisions = [decision()]) {
  const vm = {
    connect: vi.fn(async () => undefined),
    health: vi.fn(async () => ({ ready: true })),
    screenshot: vi.fn(async () => png()),
    display: { size: vi.fn(async () => ({ w: 1280, h: 720 })) },
    mouse: { click: vi.fn(async () => undefined) },
    keyboard: {
      type: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
    },
    stream: {
      start: vi.fn(async () => ({
        streamUrl: "wss://solari.example/private-stream-sentinel",
      })),
    },
    record: {
      start: vi.fn(async () => ({ path: "/tmp/record.mp4", fps: 10 })),
      stop: vi.fn(async () => ({ path: "/tmp/record.mp4", sizeBytes: 100 })),
    },
    downloadUrl: vi.fn(async () => ({
      url: "https://solari.example/record?token=private-recording-sentinel",
    })),
    pause: vi.fn(async () => undefined),
    close: vi.fn(),
    destroy: vi.fn(),
  }
  const client = {
    connect: vi.fn(async (_id: string) => vm as unknown as Desktop),
    pause: vi.fn(async () => ({
      sessionId: "test",
      status: "paused" as const,
    })),
  }
  let next = 0
  const planner = vi.fn(
    async (_input: Parameters<ReturnType<typeof createDesktopPlanner>>[0]) => ({
      decision: decisions[Math.min(next++, decisions.length - 1)],
      tokens: 100,
    }),
  )
  const viewer = {
    url: "http://127.0.0.1:12345/local-only/",
    setRecording: vi.fn(),
    close: vi.fn(async () => undefined),
  }
  const evidence = {
    directory: "offline",
    screenshot: vi.fn((step: number, _bytes: Uint8Array) => `step-${step}.png`),
    job: vi.fn(),
    validation: vi.fn(() => true),
  }
  const deps = {
    id: "test-desktop-run",
    client,
    planner,
    evidence,
    viewer: vi.fn(async () => viewer),
    prepare: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    reviewRecording: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
  }
  return { vm, client, planner, evidence, viewer, deps }
}

describe("Desktop config and strict planner", () => {
  it.each([
    "SOLARI_DESKTOP_ID",
    "CLEANBREAK_DRY_RUN",
    "CLEANBREAK_REAL_PROVIDER_AUTHORIZED",
  ])("requires explicit %s before any VM work", async (key) => {
    const h = harness()
    await expect(
      runDesktopDryRun({ ...env, [key]: undefined }, h.deps),
    ).rejects.toThrow(key)
    expect(h.client.connect).not.toHaveBeenCalled()
  })
  it("retains browser as the default executor", () => {
    expect(realProviderExecutor({})).toBe("browser")
    expect(realProviderExecutor(env)).toBe("desktop")
    expect(() =>
      realProviderExecutor({ CLEANBREAK_REAL_PROVIDER_EXECUTOR: "unknown" }),
    ).toThrow()
  })
  it("rejects non-dry-run and credential-bearing gateway URLs", () => {
    expect(() =>
      readDesktopConfig({ ...env, CLEANBREAK_DRY_RUN: "false" }),
    ).toThrow("CLEANBREAK_DRY_RUN")
    expect(() =>
      readDesktopConfig({
        ...env,
        SOLARI_DESKTOP_BASE_URL: "https://user:password@bad.example",
      }),
    ).toThrow("HTTPS origin")
  })
  it("sends screenshot, dimensions, goal and bounded history through strict Structured Outputs", async () => {
    const parse = vi.fn(async (_options: unknown) => ({
      output_parsed: decision(),
      usage: { input_tokens: 20, output_tokens: 10 },
    }))
    const planner = createDesktopPlanner(readDesktopConfig(env).agent, {
      responses: { parse },
    })
    const result = await planner({
      screenshot: png(),
      width: 1280,
      height: 720,
      allowedOrigin: "https://provider.example",
      history: Array.from({ length: 20 }, (_, i) => `step-${i}`),
    })
    const options = parse.mock.calls[0][0] as {
      store: boolean
      input: Array<{ role: string; content: unknown }>
      text: {
        format: {
          strict: boolean
          schema: { additionalProperties: boolean; required: string[] }
        }
      }
    }
    expect(options.store).toBe(false)
    expect(options.text.format.strict).toBe(true)
    expect(options.text.format.schema.additionalProperties).toBe(false)
    expect(options.text.format.schema.required).toContain("type")
    expect(options.input[0].role).toBe("developer")
    const parts = options.input[1].content as Array<{
      type: string
      text?: string
      image_url?: string
    }>
    expect(JSON.parse(parts[0].text!).history).toHaveLength(6)
    expect(JSON.parse(parts[0].text!)).toMatchObject({
      width: 1280,
      height: 720,
    })
    expect(parts[1].image_url).toBe(
      `data:image/png;base64,${png().toString("base64")}`,
    )
    expect(result.tokens).toBe(30)
  })
  it("rejects arbitrary code and missing structured fields", () => {
    expect(() =>
      desktopDecisionSchema.parse({ ...decision(), code: "exec(...)" }),
    ).toThrow()
    expect(() => desktopDecisionSchema.parse({ type: "click" })).toThrow()
  })
})

describe("offline visual Desktop dry-run lifecycle", () => {
  it("reconnects an existing VM, waits for health, captures each step, intercepts final action, and pauses", async () => {
    const h = harness([
      decision({ type: "click", targetText: "Billing" }),
      decision(),
    ])
    h.vm.health.mockResolvedValueOnce({ ready: false })
    const result = await runDesktopDryRun(env, h.deps)
    expect(h.client.connect).toHaveBeenCalledExactlyOnceWith(
      env.SOLARI_DESKTOP_ID,
    )
    expect(h.vm.connect).toHaveBeenCalledOnce()
    expect(h.vm.health).toHaveBeenCalledTimes(2)
    expect(h.evidence.screenshot).toHaveBeenCalledTimes(2)
    expect(h.vm.mouse.click).toHaveBeenCalledExactlyOnceWith(200, 300)
    expect(h.deps.confirm).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      state: "AWAITING_APPROVAL",
      paused: true,
      controlClosed: true,
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
    })
    expect(result.steps[1].execution).toBe("NOT_EXECUTED")
    expect(h.vm.record.start).toHaveBeenCalledOnce()
    expect(h.vm.record.stop).toHaveBeenCalledOnce()
    expect(h.vm.pause).toHaveBeenCalledOnce()
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.vm.destroy).not.toHaveBeenCalled()
    expect(h.viewer.close).toHaveBeenCalledOnce()
  })
  it("never clicks a final candidate or a cancellation mislabelled as click", async () => {
    for (const type of ["click", "final_cancel_candidate"] as const) {
      const h = harness([decision({ type })])
      expect((await runDesktopDryRun(env, h.deps)).state).toBe(
        "AWAITING_APPROVAL",
      )
      expect(h.vm.mouse.click).not.toHaveBeenCalled()
      expect(h.deps.confirm).not.toHaveBeenCalled()
    }
  })
  it.each([
    [{ confidence: 0.2 }, "LOW_CONFIDENCE"],
    [{ targetText: "Delete my account" }, "ACCOUNT_DELETION"],
    [{ targetText: "Accept offer" }, "RETENTION_OFFER"],
    [{ pageStatus: "challenge" }, "ANTI_BOT_CHALLENGE"],
    [{ pageStatus: "login" }, "LOGIN_REQUIRED"],
    [{ observedOrigin: "https://unrelated.example" }, "UNRELATED_ORIGIN"],
    [{ destinationOrigin: "https://unrelated.example" }, "UNRELATED_ORIGIN"],
    [{ pageStatus: "unknown" }, "PROVIDER_NOT_ESTABLISHED"],
    [{ x: 1280 }, "INVALID_COORDINATES"],
    [{ type: "key", targetText: null, keys: ["Return"] }, "KEY_NOT_ALLOWED"],
    [
      { type: "scroll", targetText: null, deltaY: 100 },
      "SCROLL_DELTA_UNSUPPORTED",
    ],
    [
      { type: "type", targetText: "Password", text: "private-password" },
      "UNSAFE_TARGET",
    ],
  ] as Array<[Partial<DesktopDecision>, string]>)(
    "fails closed on unsafe decision %#",
    async (patch, code) => {
      const h = harness([decision(patch)])
      const result = await runDesktopDryRun(env, h.deps)
      expect(result.stopReason).toBe(code)
      expect(result.state).toBe("FAILED")
      expect(h.vm.mouse.click).not.toHaveBeenCalled()
      expect(h.vm.keyboard.press).not.toHaveBeenCalled()
      expect(h.vm.keyboard.type).not.toHaveBeenCalled()
      expect(h.vm.pause).toHaveBeenCalledOnce()
      expect(h.vm.close).toHaveBeenCalledOnce()
    },
  )
  it("bounds steps and preserves only bounded tool history", async () => {
    const h = harness([
      decision({ type: "key", targetText: null, keys: ["Page_Down"] }),
    ])
    const result = await runDesktopDryRun(
      { ...env, CLEANBREAK_AGENT_MAX_STEPS: "8" },
      h.deps,
    )
    expect(result.stopReason).toBe("MAX_STEPS")
    expect(h.planner).toHaveBeenCalledTimes(8)
    expect(h.planner.mock.calls.at(-1)![0].history).toHaveLength(6)
  })
  it("bounds total model tokens before dispatch", async () => {
    const h = harness()
    h.planner.mockResolvedValue({ decision: decision(), tokens: 20_001 })
    expect((await runDesktopDryRun(env, h.deps)).stopReason).toBe(
      "TOKEN_BUDGET",
    )
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
  })
  it("limits typing to the fixed neutral cancellation reason", () => {
    expect(
      desktopPolicy(
        decision({
          type: "type",
          targetText: "cancellation reason",
          text: NEUTRAL_REASON,
        }),
        "https://provider.example",
        1280,
        720,
        0.7,
      ).result,
    ).toBe("ALLOW")
    expect(
      desktopPolicy(
        decision({
          type: "type",
          targetText: "cancellation reason",
          text: "private-token",
        }),
        "https://provider.example",
        1280,
        720,
        0.7,
      ).result,
    ).toBe("BLOCK")
  })
  it("requires fresh human confirmation and an unchanged screenshot before dispatch", async () => {
    const h = harness([decision({ type: "click", targetText: "Billing" })])
    h.deps.confirm.mockResolvedValue(false)
    expect((await runDesktopDryRun(env, h.deps)).stopReason).toBe(
      "NAVIGATION_NOT_CONFIRMED",
    )
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    const changed = harness([
      decision({ type: "click", targetText: "Billing" }),
    ])
    const next = png()
    next[8] = 1
    changed.vm.screenshot.mockResolvedValueOnce(png()).mockResolvedValue(next)
    expect((await runDesktopDryRun(env, changed.deps)).stopReason).toBe(
      "SCREEN_CHANGED",
    )
    expect(changed.vm.mouse.click).not.toHaveBeenCalled()
  })
  it("does not retry an input whose outcome is unknown", async () => {
    const h = harness([decision({ type: "click", targetText: "Billing" })])
    h.vm.mouse.click.mockRejectedValue(new Error("private-cookie"))
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.stopReason).toBe("ACTION_FAILED_OUTCOME_UNKNOWN_NO_RETRY")
    expect(h.vm.mouse.click).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain("private-cookie")
  })
  it.each([
    "connect",
    "health",
    "screenshot",
    "planner",
    "recording",
    "confirmation",
  ])("pauses and closes on %s failure", async (phase) => {
    const h = harness([decision({ type: "click", targetText: "Billing" })])
    const error = new Error("private-sdk-error")
    if (phase === "connect") h.vm.connect.mockRejectedValue(error)
    if (phase === "health") h.vm.health.mockResolvedValue({ ready: false })
    if (phase === "screenshot") h.vm.screenshot.mockRejectedValue(error)
    if (phase === "planner") h.planner.mockRejectedValue(error)
    if (phase === "recording") h.vm.record.start.mockRejectedValue(error)
    if (phase === "confirmation") h.deps.confirm.mockRejectedValue(error)
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.state).toBe("FAILED")
    expect(h.vm.pause).toHaveBeenCalledOnce()
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain("private-sdk-error")
  })
  it("tries gateway pause when attaching fails or handle pause fails", async () => {
    const h = harness()
    h.client.connect.mockRejectedValue(new Error("private-url"))
    expect((await runDesktopDryRun(env, h.deps)).paused).toBe(true)
    expect(h.client.pause).toHaveBeenCalledOnce()
    const fallback = harness()
    fallback.vm.pause.mockRejectedValue(new Error("private"))
    expect((await runDesktopDryRun(env, fallback.deps)).paused).toBe(true)
    expect(fallback.client.pause).toHaveBeenCalledOnce()
    expect(fallback.vm.close).toHaveBeenCalledOnce()
  })
  it("does not report success if pause cannot be confirmed", async () => {
    const h = harness()
    h.vm.pause.mockRejectedValue(new Error())
    h.client.pause.mockRejectedValue(new Error())
    const result = await runDesktopDryRun(env, h.deps)
    expect(result.state).toBe("FAILED")
    expect(result.paused).toBe(false)
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
  it("stops on interruption before any model-directed input and still pauses", async () => {
    const h = harness()
    const controller = new AbortController()
    h.deps.prepare.mockImplementation(async () => {
      controller.abort()
      return true
    })
    expect(
      (await runDesktopDryRun(env, { ...h.deps, signal: controller.signal }))
        .stopReason,
    ).toBe("INTERRUPTED")
    expect(h.vm.mouse.click).not.toHaveBeenCalled()
    expect(h.vm.pause).toHaveBeenCalledOnce()
  })
  it("redacts model free text and keeps capabilities out of validation artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "cleanbreak-desktop-test-"))
    const h = harness([
      decision({
        reasoning: "password private-password user@example.com",
        visibleText: "private-token",
        reason: "https://secret.example?token=private-token",
      }),
    ])
    const evidence = desktopEvidence("safe-run", root)
    try {
      const result = await runDesktopDryRun(env, {
        ...h.deps,
        id: "safe-run",
        evidence,
      })
      const artifact = readFileSync(
        join(evidence.directory, "validation.json"),
        "utf8",
      )
      const job = readFileSync(join(evidence.directory, "job.json"), "utf8")
      expect(job).toContain(env.SOLARI_DESKTOP_ID)
      for (const secret of [
        env.SOLARI_API_KEY!,
        env.OPENAI_API_KEY!,
        env.SOLARI_DESKTOP_ID!,
        "private-password",
        "private-token",
        "user@example.com",
        "private-stream-sentinel",
        "private-recording-sentinel",
      ])
        expect(artifact).not.toContain(secret)
      for (const secret of [
        "private-password",
        "private-token",
        "private-stream-sentinel",
        "private-recording-sentinel",
      ])
        expect(job).not.toContain(secret)
      expect(evidence.validation({ ...result, state: "FAILED" })).toBe(false)
    } finally {
      for (const file of readdirSync(evidence.directory))
        unlinkSync(join(evidence.directory, file))
      rmdirSync(evidence.directory)
      rmdirSync(root)
    }
  })
})

describe("private local Desktop viewer", () => {
  it("serves noVNC and memory-only stream settings, rejects other hosts and missing capability", async () => {
    const viewer = await startDesktopViewer(
      "wss://solari.example/private-stream",
      true,
    )
    try {
      const root = await fetch(viewer.url)
      expect(root.status).toBe(200)
      expect(root.headers.get("cache-control")).toBe("no-store")
      expect(await root.text()).not.toContain("private-stream")
      expect(await (await fetch(viewer.url + "session")).json()).toEqual({
        streamUrl: "wss://solari.example/private-stream",
        viewOnly: true,
      })
      expect((await fetch(viewer.url + "novnc/core/rfb.js")).status).toBe(200)
      expect((await fetch(new URL("/session", viewer.url))).status).toBe(404)
      expect(
        (
          await fetch(viewer.url, {
            headers: { Origin: "https://unrelated.example" },
          })
        ).status,
      ).toBe(404)
      const js = await (await fetch(viewer.url + "viewer.js")).text()
      expect(js).toContain("rfb.viewOnly = settings.viewOnly")
      expect(js).toContain("rfb.resizeSession = false")
    } finally {
      await viewer.close()
    }
  })
})
