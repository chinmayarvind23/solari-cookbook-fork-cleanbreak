import { randomBytes } from "node:crypto"
import type { Desktop } from "@solarisdk/desktop"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runDesktopOpen } from "@/scripts/desktop-open"
import {
  runDesktopBrowserDiagnose,
  runDesktopBrowserTest,
} from "@/scripts/desktop-browser-test"
import { BROWSER_RENDER_WAIT_MS } from "@/scripts/desktop-browser"
import { renderImage } from "./helpers/render-image"

function harness() {
  const marker = randomBytes(24).toString("hex")
  const env = {
    SOLARI_API_KEY: randomBytes(24).toString("hex"),
    SOLARI_DESKTOP_SESSION_ID: `pool:vm:org.${randomBytes(24).toString("hex")}`,
    CLEANBREAK_REAL_PROVIDER_AUTHORIZED: "true",
    CLEANBREAK_REAL_PROVIDER_URL: `https://provider.example/company/${marker}/billing?account=${marker}`,
  }
  const vm = {
    connect: vi.fn(async () => undefined),
    health: vi.fn(async () => ({ ready: true, display: true, vnc: true })),
    open: vi.fn(async (_name: string, _args?: string[]) => 123),
    screenshot: vi.fn(async () => renderImage),
    process: {
      list: vi.fn(async () => [
        { pid: 123, name: "firefox", cmd: marker },
        { pid: 123, name: "chrome", cmd: marker },
      ]),
    },
    exec: vi.fn(async (_cmd: string, _opts?: unknown) => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    })),
    close: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    stream: {
      start: vi.fn(async () => ({
        streamUrl: `wss://example.invalid/stream?token=${marker}`,
      })),
    },
  }
  const client = {
    connect: vi.fn(async (_id: string) => vm as unknown as Desktop),
    pause: vi.fn(async (_id: string) => ({
      sessionId: env.SOLARI_DESKTOP_SESSION_ID,
      status: "paused" as const,
    })),
    destroy: vi.fn(),
    create: vi.fn(),
  }
  const viewer = {
    url: "http://127.0.0.1:12345/private-viewer/",
    setRecording: vi.fn(),
    close: vi.fn(async () => undefined),
  }
  const deps = {
    createClient: vi.fn(() => client),
    output: vi.fn(),
    interactive: true,
    wait: vi.fn(async (_ms: number) => undefined),
    viewer: vi.fn(async () => viewer),
    confirm: vi.fn(async (_prompt: string) => true),
    saveScreenshot: vi.fn(),
  }
  return { marker, env, vm, client, viewer, deps }
}
afterEach(() => vi.restoreAllMocks())

const chromeArgs = (url: string) => [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--user-data-dir=/tmp/cleanbreak-chrome",
  "--new-window",
  url,
]
const modes = ["manual", "test", "diagnose"] as const
type Mode = (typeof modes)[number]
const command = (mode: Mode) =>
  mode === "manual"
    ? runDesktopOpen
    : mode === "test"
      ? runDesktopBrowserTest
      : runDesktopBrowserDiagnose

describe("Chrome-only Desktop commands", () => {
  it.each(["S", "R"])(
    "accepts the live guest comm process field with state %s, without logging cmdline",
    async (state) => {
      const h = harness()
      h.vm.process.list.mockResolvedValue([
        { pid: 123, comm: "chrome", cmdline: h.marker, state },
      ] as unknown as Awaited<ReturnType<typeof h.vm.process.list>>)
      expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(0)
      expect(h.vm.screenshot).toHaveBeenCalledOnce()
      expect(h.deps.output.mock.calls.flat().join(" ")).not.toContain(h.marker)
    },
  )
  it.each(["Z", "X"])(
    "does not accept a dead Chrome process with state %s",
    async (state) => {
      const h = harness()
      h.vm.process.list.mockResolvedValue([
        { pid: 123, comm: "chrome", cmdline: h.marker, state },
      ] as unknown as Awaited<ReturnType<typeof h.vm.process.list>>)
      expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(1)
      expect(h.deps.output).toHaveBeenCalledWith(
        "reason: CHROME_PROCESS_EXITED",
      )
      expect(h.deps.output.mock.calls.flat().join(" ")).not.toContain(h.marker)
    },
  )
  it.each(modes)(
    "%s positively detects Chrome and never opens Firefox or Chromium",
    async (mode) => {
      const h = harness()
      expect(await command(mode)(h.env, h.deps)).toBe(0)
      expect(h.vm.open).toHaveBeenCalledExactlyOnceWith(
        "/usr/bin/google-chrome",
        chromeArgs(
          mode === "manual"
            ? h.env.CLEANBREAK_REAL_PROVIDER_URL.split("?")[0]
            : "https://example.com",
        ),
      )
      expect(h.vm.exec).toHaveBeenCalledWith("test", {
        args: ["-x", "/usr/bin/google-chrome"],
        timeoutMs: 5000,
      })
      expect(h.vm.health.mock.invocationCallOrder[0]).toBeLessThan(
        h.vm.open.mock.invocationCallOrder[0],
      )
      expect(h.vm.exec.mock.invocationCallOrder.at(-1)!).toBeLessThan(
        h.vm.open.mock.invocationCallOrder[0],
      )
      expect(h.deps.wait).toHaveBeenCalledWith(BROWSER_RENDER_WAIT_MS)
      expect(h.vm.process.list).toHaveBeenCalledTimes(2)
      expect(h.vm.screenshot).toHaveBeenCalledOnce()
      expect(h.vm.close).toHaveBeenCalledOnce()
      expect(h.vm.pause).not.toHaveBeenCalled()
      expect(h.client.pause).not.toHaveBeenCalled()
      expect(h.vm.destroy).not.toHaveBeenCalled()
      expect(h.client.destroy).not.toHaveBeenCalled()
      expect(h.client.create).not.toHaveBeenCalled()
      if (mode === "manual") {
        expect(h.deps.output.mock.calls.slice(0, 3)).toEqual([
          ["Desktop connected."],
          ["Launching provider in Chrome..."],
          ["Browser launched."],
        ])
        expect(h.vm.screenshot.mock.invocationCallOrder[0]).toBeLessThan(
          h.vm.stream.start.mock.invocationCallOrder[0],
        )
        expect(h.deps.confirm.mock.calls[0][0]).toContain(h.viewer.url)
        expect(h.viewer.close).toHaveBeenCalledOnce()
        expect(h.deps.saveScreenshot).not.toHaveBeenCalled()
      } else {
        expect(h.vm.stream.start).not.toHaveBeenCalled()
        expect(h.deps.viewer).not.toHaveBeenCalled()
      }
      if (mode === "test")
        expect(h.deps.output.mock.calls).toEqual([
          ["DESKTOP_BROWSER_LAUNCH_OK"],
        ])
      if (mode === "diagnose") {
        expect(h.deps.output).toHaveBeenCalledWith("chromeDetected: true")
        expect(h.deps.output).toHaveBeenCalledWith("screenshotCaptured: true")
        expect(h.deps.output).toHaveBeenCalledWith("result: ok")
        expect(h.deps.output).toHaveBeenCalledWith(
          "renderArtifact: .cleanbreak/browser-render-test.png",
        )
        expect(h.deps.saveScreenshot).toHaveBeenCalledExactlyOnceWith(
          renderImage,
        )
      }
      const log = [
        ...h.deps.output.mock.calls.flat(),
        ...h.deps.confirm.mock.calls.flat(),
      ].join(" ")
      for (const secret of [
        h.marker,
        h.env.SOLARI_API_KEY,
        h.env.CLEANBREAK_REAL_PROVIDER_URL,
        "wss://",
        "controlUrl",
        "streamUrl",
      ])
        expect(log).not.toContain(secret)
      expect(JSON.stringify(h.vm.open.mock.calls)).not.toContain("--headless")
    },
  )

  it.each(modes)(
    "%s fails closed without installing or substituting another browser when Chrome is absent",
    async (mode) => {
      const h = harness()
      h.vm.exec.mockResolvedValue({
        exitCode: 1,
        stdout: h.marker,
        stderr: h.env.SOLARI_API_KEY,
      })
      expect(await command(mode)(h.env, h.deps)).toBe(1)
      expect(h.vm.open).not.toHaveBeenCalled()
      expect(h.deps.viewer).not.toHaveBeenCalled()
      expect(h.vm.close).toHaveBeenCalledOnce()
      expect(h.deps.output.mock.calls.flat().join(" ")).not.toContain(h.marker)
    },
  )

  it.each([
    "connect",
    "probe",
    "open",
    "process",
    "screenshot",
    "close",
  ] as const)(
    "cleans up and hides raw %s failures without retrying launch",
    async (stage) => {
      const h = harness()
      const error = Object.assign(
        new Error(h.env.CLEANBREAK_REAL_PROVIDER_URL),
        { body: h.marker, headers: h.env.SOLARI_API_KEY, stack: h.marker },
      )
      if (stage === "connect") h.vm.connect.mockRejectedValue(error)
      if (stage === "probe") h.vm.exec.mockRejectedValue(error)
      if (stage === "open") h.vm.open.mockRejectedValue(error)
      if (stage === "process") h.vm.process.list.mockRejectedValue(error)
      if (stage === "screenshot") h.vm.screenshot.mockRejectedValue(error)
      if (stage === "close")
        h.vm.close.mockImplementation(() => {
          throw error
        })
      expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(1)
      expect(h.vm.open.mock.calls.length).toBeLessThanOrEqual(1)
      expect(h.deps.output).not.toHaveBeenCalledWith(
        "DESKTOP_BROWSER_LAUNCH_OK",
      )
      const log = h.deps.output.mock.calls.flat().join(" ")
      for (const secret of [
        h.marker,
        h.env.SOLARI_API_KEY,
        h.env.CLEANBREAK_REAL_PROVIDER_URL,
        "headers",
        "body",
      ])
        expect(log).not.toContain(secret)
      expect(h.vm.close).toHaveBeenCalledOnce()
      expect(h.vm.pause).not.toHaveBeenCalled()
      expect(h.vm.destroy).not.toHaveBeenCalled()
    },
  )

  it.each([
    "chrome_probe",
    "chrome_open",
    "render_wait",
    "health_recheck",
  ] as const)("exposes only fixed diagnostic stage %s", async (stage) => {
    const h = harness()
    if (stage === "chrome_probe")
      h.vm.exec.mockRejectedValue(new Error(h.marker))
    if (stage === "chrome_open")
      h.vm.open.mockRejectedValue(new Error(h.marker))
    if (stage === "render_wait")
      h.deps.wait.mockRejectedValue(new Error(h.marker))
    if (stage === "health_recheck")
      h.vm.health
        .mockResolvedValueOnce({ ready: true, display: true, vnc: true })
        .mockResolvedValue({ ready: false, display: false, vnc: false })
    expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(1)
    expect(h.deps.output).toHaveBeenCalledWith("launchStage: " + stage)
    expect(h.deps.output).toHaveBeenCalledWith("result: failed")
    expect(h.deps.output.mock.calls.flat().join(" ")).not.toContain(h.marker)
  })

  it.each([0, -1, NaN])(
    "does not accept invalid launch PID %s",
    async (pid) => {
      const h = harness()
      h.vm.open.mockResolvedValue(pid)
      expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(1)
      expect(h.deps.output).toHaveBeenCalledWith("reason: CHROME_OPEN_FAILED")
      expect(h.vm.open).toHaveBeenCalledOnce()
    },
  )

  it.each(modes)(
    "%s requires a live Chrome process, not merely a healthy VM",
    async (mode) => {
      const h = harness()
      h.vm.process.list.mockResolvedValue([])
      expect(await command(mode)(h.env, h.deps)).toBe(1)
      expect(h.vm.open).toHaveBeenCalledOnce()
      expect(h.deps.viewer).not.toHaveBeenCalled()
      expect(h.deps.output).not.toHaveBeenCalledWith("Browser launched.")
    },
  )

  it("manual mode waits for ready and closes its viewer after canceled confirmation", async () => {
    const h = harness()
    h.vm.health.mockResolvedValueOnce({
      ready: false,
      display: false,
      vnc: false,
    })
    h.deps.confirm.mockResolvedValue(false)
    expect(await runDesktopOpen(h.env, h.deps)).toBe(0)
    expect(h.deps.wait.mock.calls).toEqual([[500], [BROWSER_RENDER_WAIT_MS]])
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.viewer.close).toHaveBeenCalledOnce()
    expect(h.vm.pause).not.toHaveBeenCalled()
  })

  it("manual mode never starts the viewer when screenshot verification fails", async () => {
    const h = harness()
    h.vm.screenshot.mockRejectedValue(new Error(h.marker))
    expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
    expect(h.deps.viewer).not.toHaveBeenCalled()
    expect(h.deps.output).not.toHaveBeenCalledWith("Browser launched.")
    expect(h.deps.saveScreenshot).not.toHaveBeenCalled()
  })

  it("bounds initial readiness without opening an app", async () => {
    const h = harness()
    h.vm.health.mockResolvedValue({ ready: false, display: false, vnc: false })
    expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
    expect(h.vm.health).toHaveBeenCalledTimes(30)
    expect(h.vm.open).not.toHaveBeenCalled()
  })

  it.each([
    "",
    "http://provider.example",
    "https://localhost",
    "https://user:password@provider.example",
  ])("rejects unsafe provider target before connection", async (url) => {
    const h = harness()
    h.env.CLEANBREAK_REAL_PROVIDER_URL = url
    expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
    expect(h.client.connect).not.toHaveBeenCalled()
    expect(h.vm.open).not.toHaveBeenCalled()
  })

  it("never logs arbitrary executable probe stdout or process command lines", async () => {
    const h = harness()
    h.vm.exec.mockResolvedValue({
      exitCode: 0,
      stdout: h.marker,
      stderr: h.env.SOLARI_API_KEY,
    })
    expect(await runDesktopBrowserDiagnose(h.env, h.deps)).toBe(0)
    const log = h.deps.output.mock.calls.flat().join(" ")
    expect(log).not.toContain(h.marker)
    expect(log).not.toContain(h.env.SOLARI_API_KEY)
    expect(log).not.toContain(h.env.CLEANBREAK_REAL_PROVIDER_URL)
    expect(h.vm.exec).toHaveBeenCalledTimes(6)
  })
})
