import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { desktopCancellationDriver } from "@/lib/cancellations/desktop"
import { runDesktopDryRun } from "@/lib/desktop/runtime"
import type { FinalDispatchGrant } from "@/lib/cancellations/dispatch"
import type { ProductConfig } from "@/lib/cancellations/config"
const shared = vi.hoisted(() => ({
  vm: undefined as any,
  image: undefined as Uint8Array | undefined,
  extracted: undefined as any,
}))
vi.mock("@solarisdk/desktop", () => ({
  DesktopClient: class {
    async connect() {
      return shared.vm
    }
  },
}))
vi.mock("@/lib/desktop/runtime", async (original) => ({
  ...(await original<typeof import("@/lib/desktop/runtime")>()),
  runDesktopDryRun: vi.fn(async () => ({
    state: "AWAITING_APPROVAL",
    stopReason: "FINAL_ACTION_BOUNDARY",
    finalBoundaryEstablished: true,
    steps: [{ adapterRule: "ENTRY", execution: "NAVIGATION_RETURNED" }],
    proposedAction: { x: 200, y: 300 },
  })),
}))
vi.mock("@/lib/cancellations/extraction", () => ({
  createBillingExtractor:
    () =>
    async (
      _image: Uint8Array,
      contextId: string,
      screenshot: string,
      mode: string,
    ) => ({
      ...shared.extracted,
      contextId,
      screenshot,
      surface: mode === "VERIFY" ? "BILLING_PAGE" : "FINAL_CANCELLATION",
    }),
}))
const config: ProductConfig = {
  env: {
    NODE_ENV: "test",
    SOLARI_API_KEY: "offline-only-key",
    SOLARI_DESKTOP_SESSION_ID: "pool:vm:org.test-session",
    CLEANBREAK_DRY_RUN: "false",
    CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
    CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL: "true",
  },
  startUrl: "https://miro.com/app/settings/company/synthetic/billing",
  scope: {
    provider: "miro",
    providerOrigin: "https://miro.com",
    subscriptionKey: "synthetic-subscription",
    sessionBinding: "synthetic-session-hash",
    planName: "Business Trial",
    expectedAmountCents: 24000,
    currency: "USD",
    interval: "YEARLY",
    accessPolicy: "PRESERVE_PREPAID_ACCESS",
  },
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.useRealTimers()
})
async function setup() {
  shared.image = await sharp({
    create: { width: 1280, height: 720, channels: 4, background: "white" },
  })
    .png()
    .toBuffer()
  shared.vm = {
    connect: vi.fn(async () => {}),
    health: vi.fn(async () => ({ ready: true })),
    screenshot: vi.fn(async () => shared.image),
    display: { size: vi.fn(async () => ({ w: 1280, h: 720 })) },
    pause: vi.fn(async () => {}),
    close: vi.fn(),
    open: vi.fn(async () => 123),
    exec: vi.fn(async () => ({
      exitCode: 0,
      stdout: "never-log-arbitrary-output",
    })),
    mouse: { click: vi.fn(async () => {}) },
    keyboard: { type: vi.fn(), press: vi.fn() },
    destroy: vi.fn(),
  }
  shared.extracted = {
    version: 1,
    observedAt: new Date().toISOString(),
    scope: config.scope,
    matched: true,
    authenticated: true,
    confidence: 0.99,
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
    screenshotHash: "synthetic-hash",
    billing: {
      subscriptionStatus: "CANCELED",
      renewalStatus: "OFF",
      nextChargePresent: false,
      nextChargeAmountCents: null,
      nextChargeDate: null,
      accessUntil: null,
    },
  }
  vi.stubEnv("CLEANBREAK_DRY_RUN", "false")
  vi.stubEnv("CLEANBREAK_REAL_PROVIDER_AUTHORIZED", "true")
  vi.stubEnv("CLEANBREAK_ALLOW_DESTRUCTIVE_CANCEL", "true")
  return desktopCancellationDriver(config, `offline-${randomUUID()}`)
}
describe("Desktop product adapter isolation", () => {
  it.each([
    ["TOKEN_BUDGET", "DESKTOP_NAVIGATION_TOKEN_BUDGET"],
    ["NAVIGATION_NO_PROGRESS", "DESKTOP_NAVIGATION_NO_PROGRESS"],
    ["MAX_STEPS", "DESKTOP_NAVIGATION_MAX_STEPS"],
    ["private-unknown-error", "FINAL_BOUNDARY_NOT_ESTABLISHED"],
  ])(
    "preserves safe navigation failure %s without adding final authority",
    async (stopReason, code) => {
      const driver = await setup()
      vi.mocked(runDesktopDryRun).mockResolvedValueOnce({
        state: "FAILED",
        stopReason,
        finalBoundaryEstablished: false,
        steps: [{ adapterRule: "ENTRY", execution: "NAVIGATION_RETURNED" }],
      } as Awaited<ReturnType<typeof runDesktopDryRun>>)
      await driver.connect()
      await expect(driver.navigate(vi.fn())).rejects.toThrow(code)
      expect(shared.vm.mouse.click).not.toHaveBeenCalled()
      await driver.close()
    },
  )
  it("preserves the observed navigation stop before any final dispatch", async () => {
    const driver = await setup()
    vi.mocked(runDesktopDryRun).mockResolvedValueOnce({
      state: "FAILED",
      stopReason: "MODEL_STOPPED",
      finalBoundaryEstablished: false,
      steps: [{ adapterRule: "ENTRY", execution: "NAVIGATION_RETURNED" }],
    } as Awaited<ReturnType<typeof runDesktopDryRun>>)
    await driver.connect()
    await expect(driver.navigate(vi.fn())).rejects.toThrow(
      "DESKTOP_NAVIGATION_MODEL_STOPPED",
    )
    expect(shared.vm.mouse.click).not.toHaveBeenCalled()
    await driver.close()
  })
  it("uses the existing autonomous dry-run navigator with no viewer or terminal", async () => {
    const driver = await setup()
    await driver.connect()
    await driver.navigate(vi.fn())
    expect(runDesktopDryRun).toHaveBeenCalledWith(
      expect.objectContaining({ CLEANBREAK_DRY_RUN: "true" }),
      expect.objectContaining({ auto: true, privateWorker: true }),
    )
    expect(shared.vm.mouse.click).not.toHaveBeenCalled()
    await driver.close()
    expect(shared.vm.pause).not.toHaveBeenCalled()
    expect(shared.vm.close).toHaveBeenCalled()
    expect(shared.vm.destroy).not.toHaveBeenCalled()
  })
  it("verification reconnects, opens a configured billing window and never dispatches input", async () => {
    const driver = await setup(),
      log = vi.spyOn(console, "log")
    await driver.connect()
    vi.useFakeTimers()
    const verification = driver.verify()
    await vi.runAllTimersAsync()
    const result = await verification
    expect(result.fresh).toBe(true)
    expect(shared.vm.open).toHaveBeenCalledWith(
      "/usr/bin/google-chrome",
      expect.arrayContaining(["--new-window", config.startUrl]),
    )
    expect(shared.vm.connect).toHaveBeenCalledTimes(2)
    expect(shared.vm.screenshot).toHaveBeenCalledTimes(2)
    expect(shared.vm.mouse.click).not.toHaveBeenCalled()
    expect(shared.vm.keyboard.type).not.toHaveBeenCalled()
    expect(shared.vm.keyboard.press).not.toHaveBeenCalled()
    expect(shared.vm.destroy).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
  it("a direct destructive call without a minted commit grant cannot dispatch", async () => {
    const driver = await setup()
    const boundary = await driver.navigate(vi.fn())
    shared.vm.screenshot.mockResolvedValue(
      await sharp({
        create: { width: 1280, height: 720, channels: 4, background: "black" },
      })
        .png()
        .toBuffer(),
    )
    await expect(
      driver.clickFinal(boundary, {} as FinalDispatchGrant),
    ).rejects.toThrow("COMMIT_GATE_REQUIRED")
    expect(shared.vm.mouse.click).not.toHaveBeenCalled()
    await driver.close()
  })
})
