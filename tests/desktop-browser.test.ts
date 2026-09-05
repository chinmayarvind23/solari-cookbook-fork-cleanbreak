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
      exitCode: 1,
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

describe("manual Desktop browser launch", () => {
  it("closes local resources without pausing when confirmation times out or is canceled", async () => {
    const h = harness()
    h.deps.confirm.mockResolvedValueOnce(false)
    await runDesktopOpen(h.env, h.deps)
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.viewer.close).toHaveBeenCalledOnce()
    expect(h.vm.pause).not.toHaveBeenCalled()
    expect(h.client.pause).not.toHaveBeenCalled()
  })
  it("waits for health, opens Firefox at the validated provider URL, then starts the viewer", async () => {
    const h = harness()
    h.vm.health.mockResolvedValueOnce({
      ready: false,
      display: false,
      vnc: false,
    })
    expect(await runDesktopOpen(h.env, h.deps)).toBe(0)
    expect(h.vm.open).toHaveBeenCalledExactlyOnceWith("firefox", [
      h.env.CLEANBREAK_REAL_PROVIDER_URL.split("?")[0],
    ])
    expect(h.vm.connect.mock.invocationCallOrder[0]).toBeLessThan(
      h.vm.health.mock.invocationCallOrder[0],
    )
    expect(h.vm.health.mock.invocationCallOrder[1]).toBeLessThan(
      h.vm.open.mock.invocationCallOrder[0],
    )
    expect(h.vm.open.mock.invocationCallOrder[0]).toBeLessThan(
      h.deps.wait.mock.invocationCallOrder[1],
    )
    expect(h.deps.wait.mock.calls).toEqual([[500], [BROWSER_RENDER_WAIT_MS]])
    expect(h.vm.health.mock.invocationCallOrder[2]).toBeLessThan(
      h.vm.stream.start.mock.invocationCallOrder[0],
    )
    expect(h.vm.stream.start.mock.invocationCallOrder[0]).toBeLessThan(
      h.deps.viewer.mock.invocationCallOrder[0],
    )
    expect(h.deps.output.mock.calls.slice(0, 3)).toEqual([
      ["Desktop connected."],
      ["Launching provider in Firefox..."],
      ["Browser launched."],
    ])
    expect(h.deps.confirm.mock.calls[0][0]).toContain(
      `Private manual desktop: ${h.viewer.url}`,
    )
    const logs = [
      ...h.deps.output.mock.calls.flat(),
      ...h.deps.confirm.mock.calls.flat(),
    ].join(" ")
    for (const value of [
      h.env.CLEANBREAK_REAL_PROVIDER_URL,
      h.marker,
      h.env.SOLARI_API_KEY,
      "wss://",
      "controlUrl",
      "streamUrl",
    ])
      expect(logs.includes(value)).toBe(false)
    expect(h.client.pause).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.client.destroy).not.toHaveBeenCalled()
    expect(h.vm.exec).not.toHaveBeenCalled()
  })
  it.each(["missing", "http", "credentials", "local"])(
    "rejects %s provider URL before connecting",
    async (kind) => {
      const h = harness()
      const urls: Record<string, string> = {
        missing: "",
        http: "http://provider.example/billing",
        credentials: `https://user:${h.marker}@provider.example`,
        local: "https://localhost/billing",
      }
      h.env.CLEANBREAK_REAL_PROVIDER_URL = urls[kind]
      expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
      expect(h.client.connect).not.toHaveBeenCalled()
      expect(h.deps.output.mock.calls.flat().join(" ").includes(h.marker)).toBe(
        false,
      )
    },
  )
  it("fails closed if Firefox and all known fallback executables are absent", async () => {
    const h = harness()
    h.vm.open.mockRejectedValueOnce(new Error(h.marker))
    expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
    expect(h.vm.exec.mock.calls).toEqual([
      ["which", { args: ["firefox"], timeoutMs: 5000 }],
      ["test", { args: ["-x", "/usr/bin/firefox"], timeoutMs: 5000 }],
      ["test", { args: ["-x", "/usr/bin/chromium"], timeoutMs: 5000 }],
      ["test", { args: ["-x", "/usr/bin/chromium-browser"], timeoutMs: 5000 }],
      ["test", { args: ["-x", "/usr/bin/google-chrome"], timeoutMs: 5000 }],
    ])
    expect(h.vm.open).toHaveBeenCalledOnce()
    expect(h.deps.output).toHaveBeenCalledWith("Desktop browser launch failed.")
    expect(h.deps.output.mock.calls.flat().join(" ").includes(h.marker)).toBe(
      false,
    )
    expect(h.vm.stream.start).not.toHaveBeenCalled()
    expect(h.deps.viewer).not.toHaveBeenCalled()
    expect(h.client.pause).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
  it("uses a fallback only after Firefox absence and executable presence are confirmed", async () => {
    const h = harness()
    h.vm.open.mockRejectedValueOnce(new Error(h.marker))
    h.vm.exec
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
    expect(await runDesktopOpen(h.env, h.deps)).toBe(0)
    expect(h.vm.open.mock.calls).toEqual([
      ["firefox", [h.env.CLEANBREAK_REAL_PROVIDER_URL.split("?")[0]]],
      ["/usr/bin/chromium", [h.env.CLEANBREAK_REAL_PROVIDER_URL.split("?")[0]]],
    ])
    expect(h.vm.exec.mock.invocationCallOrder[2]).toBeLessThan(
      h.vm.open.mock.invocationCallOrder[1],
    )
  })
  it.each([0, 127])(
    "does not fall back when absence is not established (probe exit %s)",
    async (exitCode) => {
      const h = harness()
      h.vm.open.mockRejectedValueOnce(new Error(h.marker))
      h.vm.exec.mockResolvedValueOnce({
        exitCode,
        stdout: h.marker,
        stderr: h.marker,
      })
      expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
      expect(h.vm.open).toHaveBeenCalledOnce()
      expect(h.vm.exec).toHaveBeenCalledOnce()
      expect(h.deps.viewer).not.toHaveBeenCalled()
      expect(h.deps.output.mock.calls.flat().join(" ").includes(h.marker)).toBe(
        false,
      )
    },
  )
  it("never starts the viewer when health drops after launch", async () => {
    const h = harness()
    h.vm.health
      .mockResolvedValueOnce({ ready: true, display: true, vnc: true })
      .mockResolvedValueOnce({ ready: false, display: false, vnc: false })
    expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
    expect(h.vm.open).toHaveBeenCalledOnce()
    expect(h.vm.stream.start).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
  it("bounds initial readiness polling without launching an app", async () => {
    const h = harness()
    h.vm.health.mockResolvedValue({ ready: false, display: false, vnc: false })
    expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
    expect(h.vm.health).toHaveBeenCalledTimes(30)
    expect(h.vm.open).not.toHaveBeenCalled()
  })
  it("manual auth never claims launch or presents a viewer when screenshot validation fails", async () => {
    const h = harness()
    h.vm.screenshot.mockRejectedValue(new Error(h.marker))
    expect(await runDesktopOpen(h.env, h.deps)).toBe(1)
    expect(h.deps.output).not.toHaveBeenCalledWith("Browser launched.")
    expect(h.deps.viewer).not.toHaveBeenCalled()
    expect(h.deps.saveScreenshot).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.deps.output.mock.calls.flat().join(" ").includes(h.marker)).toBe(
      false,
    )
  })
})

describe("developer browser test", () => {
  it("launches only example.com in Firefox and closes control without pausing or destroying", async () => {
    const h = harness()
    expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(0)
    expect(h.vm.open).toHaveBeenCalledExactlyOnceWith("firefox", [
      "https://example.com",
    ])
    expect(h.deps.wait).toHaveBeenCalledExactlyOnceWith(BROWSER_RENDER_WAIT_MS)
    expect(h.vm.open.mock.invocationCallOrder[0]).toBeLessThan(
      h.vm.health.mock.invocationCallOrder[0],
    )
    expect(h.vm.health).toHaveBeenCalledOnce()
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.deps.output.mock.calls).toEqual([["DESKTOP_BROWSER_LAUNCH_OK"]])
    expect(h.client.pause).not.toHaveBeenCalled()
    expect(h.vm.pause).not.toHaveBeenCalled()
    expect(h.client.destroy).not.toHaveBeenCalled()
    expect(h.vm.destroy).not.toHaveBeenCalled()
    expect(h.vm.exec).not.toHaveBeenCalled()
    expect(h.vm.stream.start).not.toHaveBeenCalled()
  })
  it.each(["connect", "open", "health", "close"])(
    "fails safely on %s without pause/destruction or success output",
    async (stage) => {
      const h = harness()
      const error = new Error(`https://example.invalid/?token=${h.marker}`)
      if (stage === "connect") h.vm.connect.mockRejectedValueOnce(error)
      if (stage === "open") h.vm.open.mockRejectedValueOnce(error)
      if (stage === "health")
        h.vm.health.mockResolvedValueOnce({
          ready: false,
          display: false,
          vnc: false,
        })
      if (stage === "close")
        h.vm.close.mockImplementationOnce(() => {
          throw error
        })
      expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(1)
      expect(h.deps.output.mock.calls.flat().join(" ").includes(h.marker)).toBe(
        false,
      )
      expect(h.deps.output).not.toHaveBeenCalledWith(
        "DESKTOP_BROWSER_LAUNCH_OK",
      )
      expect(h.vm.close).toHaveBeenCalledOnce()
      expect(h.client.pause).not.toHaveBeenCalled()
      expect(h.client.destroy).not.toHaveBeenCalled()
      expect(h.vm.exec.mock.calls.length).toBe(stage === "open" ? 5 : 0)
    },
  )
})

describe("safe shared browser diagnostics", () => {
  it.each(["diagnose", "manual"])(
    "%s uses the same fixed Google Chrome launcher and render gate",
    async (mode) => {
      const h = harness()
      h.vm.open.mockRejectedValueOnce(new Error(h.marker))
      h.vm.exec.mockImplementation(async (_cmd, options) => ({
        exitCode: (options as { args: string[] }).args.includes(
          "/usr/bin/google-chrome",
        )
          ? 0
          : 1,
        stdout: h.marker,
        stderr: h.env.SOLARI_API_KEY,
      }))
      expect(
        await (
          mode === "diagnose" ? runDesktopBrowserDiagnose : runDesktopOpen
        )(h.env, h.deps),
      ).toBe(0)
      expect(h.vm.open).toHaveBeenLastCalledWith("/usr/bin/google-chrome", [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--user-data-dir=/tmp/cleanbreak-chrome",
        "--new-window",
        mode === "diagnose"
          ? "https://example.com"
          : h.env.CLEANBREAK_REAL_PROVIDER_URL.split("?")[0],
      ])
      expect(h.vm.process.list).toHaveBeenCalledTimes(2)
      expect(h.vm.screenshot).toHaveBeenCalledOnce()
      if (mode === "diagnose") {
        expect(h.deps.saveScreenshot).toHaveBeenCalledExactlyOnceWith(
          renderImage,
        )
        expect(h.deps.output).toHaveBeenCalledWith(
          "renderArtifact: .cleanbreak/browser-render-test.png",
        )
      } else {
        expect(h.vm.screenshot.mock.invocationCallOrder[0]).toBeLessThan(
          h.vm.stream.start.mock.invocationCallOrder[0],
        )
        expect(h.deps.saveScreenshot).not.toHaveBeenCalled()
      }
      const log = h.deps.output.mock.calls.flat().join(" ")
      for (const value of [h.marker, h.env.SOLARI_API_KEY, "wss://"])
        expect(log.includes(value)).toBe(false)
    },
  )
  it.each(["test", "manual"])(
    "%s enables identical fallback semantics",
    async (mode) => {
      const h = harness()
      h.vm.open.mockRejectedValueOnce(new Error(h.marker))
      h.vm.exec
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: h.marker,
          stderr: h.marker,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: h.marker,
          stderr: h.marker,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: h.marker,
          stderr: h.marker,
        })
      expect(
        await (mode === "test" ? runDesktopBrowserTest : runDesktopOpen)(
          h.env,
          h.deps,
        ),
      ).toBe(0)
      expect(h.vm.open.mock.calls.map(([name]) => name)).toEqual([
        "firefox",
        "/usr/bin/chromium",
      ])
      const log = h.deps.output.mock.calls.flat().join(" ")
      expect(log.includes(h.marker)).toBe(false)
      expect(log.includes(h.env.CLEANBREAK_REAL_PROVIDER_URL)).toBe(false)
      expect(log.includes(h.env.SOLARI_API_KEY)).toBe(false)
    },
  )
  it.each([
    "firefox_open",
    "firefox_probe",
    "chromium_probe",
    "fallback_open",
    "render_wait",
    "health_recheck",
  ])("reports only the safe %s failure stage", async (stage) => {
    const h = harness()
    const error = Object.assign(new Error(h.env.CLEANBREAK_REAL_PROVIDER_URL), {
      body: h.marker,
      headers: h.env.SOLARI_API_KEY,
      stack: h.marker,
    })
    if (
      [
        "firefox_open",
        "firefox_probe",
        "chromium_probe",
        "fallback_open",
      ].includes(stage)
    )
      h.vm.open.mockRejectedValueOnce(error)
    if (stage === "firefox_open")
      h.vm.exec.mockResolvedValueOnce({
        exitCode: 0,
        stdout: h.marker,
        stderr: h.marker,
      })
    if (stage === "firefox_probe") h.vm.exec.mockRejectedValueOnce(error)
    if (stage === "fallback_open") {
      h.vm.exec
        .mockResolvedValueOnce({ exitCode: 1, stdout: h.marker, stderr: "" })
        .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      h.vm.open.mockRejectedValueOnce(error)
    }
    if (stage === "render_wait") h.deps.wait.mockRejectedValueOnce(error)
    if (stage === "health_recheck") h.vm.health.mockRejectedValueOnce(error)
    expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(1)
    expect(h.deps.output.mock.calls[0]).toEqual([`launchStage: ${stage}`])
    expect(h.deps.output).toHaveBeenCalledWith("result: failed")
    if (stage === "firefox_open")
      expect(h.deps.output).toHaveBeenCalledWith(
        "reason: FIREFOX_PRESENT_BUT_OPEN_FAILED",
      )
    if (stage === "chromium_probe")
      expect(h.deps.output).toHaveBeenCalledWith("reason: NO_SUPPORTED_BROWSER")
    const log = h.deps.output.mock.calls.flat().join(" ")
    for (const value of [
      h.marker,
      h.env.SOLARI_API_KEY,
      h.env.CLEANBREAK_REAL_PROVIDER_URL,
      "wss://",
      "https://",
      "headers",
      "body",
    ])
      expect(log.includes(value)).toBe(false)
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.client.pause).not.toHaveBeenCalled()
    expect(h.client.destroy).not.toHaveBeenCalled()
  })
  it("detects Firefox at its fixed path even when PATH lookup says absent", async () => {
    const h = harness()
    h.vm.open.mockRejectedValueOnce(new Error(h.marker))
    h.vm.exec
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
    expect(await runDesktopBrowserTest(h.env, h.deps)).toBe(1)
    expect(h.deps.output).toHaveBeenCalledWith(
      "reason: FIREFOX_PRESENT_BUT_OPEN_FAILED",
    )
    expect(h.vm.open).toHaveBeenCalledOnce()
  })
  it("diagnoses five locations with booleans/exit codes, then uses the same fallback helper", async () => {
    const h = harness()
    h.vm.open.mockRejectedValueOnce(
      new Error(h.env.CLEANBREAK_REAL_PROVIDER_URL),
    )
    h.vm.exec.mockImplementation(async (_cmd, options) => {
      const args = (options as { args: string[] }).args
      return {
        exitCode: args.includes("/usr/bin/chromium") ? 0 : 1,
        stdout: h.marker,
        stderr: h.env.SOLARI_API_KEY,
      }
    })
    expect(await runDesktopBrowserDiagnose(h.env, h.deps)).toBe(0)
    expect(h.deps.output.mock.calls).toEqual([
      ["ready: true"],
      ["firefoxExitCode: 1"],
      ["firefoxDetected: false"],
      ["firefoxPathExitCode: 1"],
      ["firefoxPathDetected: false"],
      ["chromiumExitCode: 0"],
      ["chromiumDetected: true"],
      ["chromiumBrowserExitCode: 1"],
      ["chromiumBrowserDetected: false"],
      ["chromeExitCode: 1"],
      ["chromeDetected: false"],
      ["launchPidValid: true"],
      ["chromeProcessDetected: true"],
      ["screenshotCaptured: true"],
      [`screenshotBytes: ${renderImage.length}`],
      ["renderArtifact: .cleanbreak/browser-render-test.png"],
      ["result: ok"],
    ])
    expect(h.vm.exec.mock.invocationCallOrder[4]).toBeLessThan(
      h.vm.open.mock.invocationCallOrder[0],
    )
    expect(h.vm.open.mock.calls).toEqual([
      ["firefox", ["https://example.com"]],
      ["/usr/bin/chromium", ["https://example.com"]],
    ])
    expect(h.vm.health).toHaveBeenCalledTimes(2)
    expect(h.vm.close).toHaveBeenCalledOnce()
    expect(h.client.pause).not.toHaveBeenCalled()
    expect(h.client.destroy).not.toHaveBeenCalled()
    expect(h.client.create).not.toHaveBeenCalled()
    expect(h.vm.stream.start).not.toHaveBeenCalled()
  })
  it("diagnose reports Firefox-present launch failure without disclosing probe stdout", async () => {
    const h = harness()
    h.vm.exec.mockResolvedValue({
      exitCode: 0,
      stdout: h.marker,
      stderr: h.marker,
    })
    h.vm.open.mockRejectedValueOnce(new Error(h.env.SOLARI_API_KEY))
    expect(await runDesktopBrowserDiagnose(h.env, h.deps)).toBe(1)
    expect(h.deps.output).toHaveBeenCalledWith("launchStage: firefox_open")
    expect(h.deps.output).toHaveBeenCalledWith(
      "reason: FIREFOX_PRESENT_BUT_OPEN_FAILED",
    )
    const log = h.deps.output.mock.calls.flat().join(" ")
    expect(log.includes(h.marker)).toBe(false)
    expect(log.includes(h.env.SOLARI_API_KEY)).toBe(false)
    expect(log.includes(h.env.CLEANBREAK_REAL_PROVIDER_URL)).toBe(false)
  })
  it("distinguishes unavailable probes from confirmed absence", async () => {
    const h = harness()
    h.vm.exec.mockRejectedValue(new Error(h.marker))
    expect(await runDesktopBrowserDiagnose(h.env, h.deps)).toBe(0)
    expect(h.deps.output).toHaveBeenCalledWith("firefoxProbeSucceeded: false")
    expect(h.deps.output).not.toHaveBeenCalledWith("firefoxDetected: false")
    expect(h.deps.output.mock.calls.flat().join(" ").includes(h.marker)).toBe(
      false,
    )
  })
  it("does not probe or launch when the initial health check is not ready", async () => {
    const h = harness()
    h.vm.health.mockResolvedValueOnce({
      ready: false,
      display: false,
      vnc: false,
    })
    expect(await runDesktopBrowserDiagnose(h.env, h.deps)).toBe(1)
    expect(h.deps.output).toHaveBeenCalledWith("ready: false")
    expect(h.vm.exec).not.toHaveBeenCalled()
    expect(h.vm.open).not.toHaveBeenCalled()
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
})
