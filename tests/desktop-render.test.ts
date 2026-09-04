import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import type { Desktop } from "@solarisdk/desktop"
import sharp from "sharp"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  launchDesktopBrowser,
  reportBrowserLaunchFailure,
} from "@/scripts/desktop-browser"
import {
  validBrowserScreenshot,
  writeBrowserRenderArtifact,
  RENDER_ARTIFACT,
} from "@/scripts/desktop-render"
import { renderImage } from "./helpers/render-image"

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

function harness() {
  const privateValue = randomBytes(24).toString("hex")
  const url = `https://example.com/company/${privateValue}`
  const vm = {
    open: vi.fn(async (name: string, _args?: string[]) => {
      if (name === "firefox") throw new Error(privateValue)
      return 123
    }),
    exec: vi.fn(async (cmd: string, options?: { args?: string[] }) => ({
      exitCode:
        cmd === "id" || options?.args?.includes("/usr/bin/google-chrome")
          ? 0
          : 1,
      stdout: cmd === "id" ? "0\n" : privateValue,
      stderr: privateValue,
    })),
    process: {
      list: vi.fn(async () => [
        { pid: 123, name: "chrome", cmd: privateValue },
      ]),
    },
    screenshot: vi.fn(async (): Promise<Uint8Array> => renderImage),
    health: vi.fn(async () => ({ ready: true, display: true, vnc: true })),
  }
  const options = {
    fallback: true,
    wait: vi.fn(async (_ms: number) => undefined),
    output: vi.fn(),
    saveScreenshot: vi.fn(),
  }
  const launch = (allowNoSandbox = false) =>
    launchDesktopBrowser(
      vm as unknown as Desktop,
      url,
      new AbortController().signal,
      { ...options, allowNoSandbox },
    )
  async function failure(allowNoSandbox = false) {
    try {
      await launch(allowNoSandbox)
      return false
    } catch (error) {
      return reportBrowserLaunchFailure(error, options.output)
    }
  }
  return { vm, options, launch, failure, privateValue, url }
}

describe("process and render gate", () => {
  it("uses detected Google Chrome with a new GUI window and requires process plus decoded screenshot", async () => {
    const h = harness()
    await h.launch()
    expect(h.vm.open.mock.calls).toEqual([
      ["firefox", [h.url]],
      ["/usr/bin/google-chrome", ["--new-window", h.url]],
    ])
    expect(h.vm.process.list).toHaveBeenCalledTimes(2)
    expect(h.vm.screenshot).toHaveBeenCalledExactlyOnceWith()
    expect(h.options.saveScreenshot).toHaveBeenCalledExactlyOnceWith(
      renderImage,
    )
    expect(h.options.output).toHaveBeenCalledWith("launchPidValid: true")
    expect(h.options.output).toHaveBeenCalledWith("chromeProcessDetected: true")
    expect(h.options.output).toHaveBeenCalledWith("screenshotCaptured: true")
    expect(
      h.options.output.mock.calls.flat().join(" ").includes(h.privateValue),
    ).toBe(false)
    expect(h.vm.exec.mock.calls.some(([cmd]) => cmd === "id")).toBe(false)
  })
  it("does not accept PID + VM health if the process exited", async () => {
    const h = harness()
    h.vm.process.list.mockResolvedValue([])
    expect(await h.failure()).toBe(true)
    expect(h.options.output).toHaveBeenCalledWith(
      "reason: CHROME_PROCESS_EXITED",
    )
    expect(h.options.saveScreenshot).not.toHaveBeenCalled()
    expect(h.vm.open).toHaveBeenCalledTimes(2)
    expect(h.vm.exec.mock.calls.some(([cmd]) => cmd === "id")).toBe(false)
  })
  it("does not accept an unrelated existing Chrome PID as a launched child", async () => {
    const h = harness()
    h.vm.process.list.mockResolvedValue([
      { pid: 999, name: "chrome", cmd: h.privateValue },
    ])
    expect(await h.failure()).toBe(true)
    expect(h.options.output).toHaveBeenCalledWith(
      "reason: CHROME_PROCESS_EXITED",
    )
  })
  it("requires the process to remain alive after screenshot capture", async () => {
    const h = harness()
    h.vm.process.list
      .mockResolvedValueOnce([
        { pid: 123, name: "chrome", cmd: h.privateValue },
      ])
      .mockResolvedValueOnce([])
    expect(await h.failure()).toBe(true)
    expect(h.options.saveScreenshot).not.toHaveBeenCalled()
  })
  it("requires a screenshot and bounds polling without relaunching", async () => {
    const h = harness()
    h.vm.screenshot.mockRejectedValue(new Error(h.privateValue))
    expect(await h.failure(true)).toBe(true)
    expect(h.options.output).toHaveBeenCalledWith("reason: SCREENSHOT_FAILED")
    expect(h.vm.screenshot).toHaveBeenCalledTimes(8)
    expect(h.vm.open).toHaveBeenCalledTimes(2)
    expect(h.options.saveScreenshot).not.toHaveBeenCalled()
  })
  it("caps even an unresponsive screenshot RPC at the remaining ten-second deadline", async () => {
    vi.useFakeTimers()
    const h = harness()
    h.vm.screenshot.mockImplementation(() => new Promise(() => {}))
    const result = h.failure()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toBe(true)
    expect(h.options.output).toHaveBeenCalledWith("reason: SCREENSHOT_FAILED")
    expect(vi.getTimerCount()).toBe(0)
  })
  it("retries transient screenshot capture only while the browser is alive", async () => {
    const h = harness()
    h.vm.screenshot.mockResolvedValueOnce(new Uint8Array())
    await h.launch()
    expect(h.vm.screenshot).toHaveBeenCalledTimes(2)
    expect(h.vm.open).toHaveBeenCalledTimes(2)
  })
  it("reports Google open and unhealthy desktop failures with fixed reasons", async () => {
    const h = harness()
    h.vm.open.mockRejectedValue(new Error(h.privateValue))
    expect(await h.failure()).toBe(true)
    expect(h.options.output).toHaveBeenCalledWith("reason: CHROME_OPEN_FAILED")
    const unhealthy = harness()
    unhealthy.vm.health.mockResolvedValue({
      ready: false,
      display: false,
      vnc: false,
    })
    expect(await unhealthy.failure()).toBe(true)
    expect(unhealthy.options.output).toHaveBeenCalledWith(
      "reason: DESKTOP_NOT_READY",
    )
  })
  it("attempts normal Chrome before exactly one opted-in, root-evidenced no-sandbox fallback", async () => {
    const h = harness()
    h.vm.process.list.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await h.launch(true)
    expect(h.vm.open.mock.calls).toEqual([
      ["firefox", [h.url]],
      ["/usr/bin/google-chrome", ["--new-window", h.url]],
      ["/usr/bin/google-chrome", ["--no-sandbox", "--new-window", h.url]],
    ])
    expect(h.vm.exec).toHaveBeenCalledWith("id", {
      args: ["-u"],
      timeoutMs: 1000,
    })
    expect(h.options.output).toHaveBeenCalledWith("rootContextDetected: true")
    expect(h.options.output).toHaveBeenCalledWith("sandboxRelaxationUsed: true")
    const args = h.vm.open.mock.calls.flatMap(([, args]) => args ?? [])
    expect(args.includes("--headless")).toBe(false)
    expect(args.includes("--disable-gpu")).toBe(false)
  })
  it("does not weaken sandboxing without a confirmed root UID", async () => {
    const h = harness()
    h.vm.process.list.mockResolvedValue([])
    const normalExec = h.vm.exec.getMockImplementation()!
    h.vm.exec.mockImplementation(async (cmd, opts) =>
      cmd === "id"
        ? { exitCode: 0, stdout: "1000\n", stderr: h.privateValue }
        : normalExec(cmd, opts),
    )
    expect(await h.failure(true)).toBe(true)
    expect(h.vm.open).toHaveBeenCalledTimes(2)
  })
  it("never retries sandbox flags more than once or after an ambiguous process-list failure", async () => {
    const h = harness()
    h.vm.process.list.mockResolvedValue([])
    expect(await h.failure(true)).toBe(true)
    expect(h.vm.open).toHaveBeenCalledTimes(3)
    const ambiguous = harness()
    ambiguous.vm.process.list.mockRejectedValue(
      new Error(ambiguous.privateValue),
    )
    expect(await ambiguous.failure(true)).toBe(true)
    expect(ambiguous.vm.open).toHaveBeenCalledTimes(2)
  })
})

describe("private render artifact", () => {
  it("rejects empty, truncated, tiny and blank image payloads", async () => {
    const blank = await sharp({
      create: { width: 400, height: 240, channels: 3, background: "black" },
    })
      .png({ compressionLevel: 0 })
      .toBuffer()
    const tiny = await sharp(renderImage).resize(10, 10).png().toBuffer()
    for (const image of [
      new Uint8Array(),
      renderImage.subarray(0, -12),
      tiny,
      blank,
    ])
      expect(await validBrowserScreenshot(image)).toBe(false)
    expect(await validBrowserScreenshot(renderImage)).toBe(true)
  })
  it("has a single fixed ignored artifact path and writes only image bytes", () => {
    writeBrowserRenderArtifact(renderImage)
    expect(mkdirSync).toHaveBeenCalledExactlyOnceWith(
      resolve(process.cwd(), ".cleanbreak"),
      { recursive: true, mode: 0o700 },
    )
    expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(
      resolve(process.cwd(), RENDER_ARTIFACT),
      renderImage,
      { mode: 0o600 },
    )
    expect(
      execFileSync("git", ["check-ignore", RENDER_ARTIFACT], {
        encoding: "utf8",
      }).trim(),
    ).toBe(RENDER_ARTIFACT)
  })
})
