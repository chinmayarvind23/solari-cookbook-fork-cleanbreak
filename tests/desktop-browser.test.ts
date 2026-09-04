import { randomBytes } from "node:crypto"
import type { Desktop } from "@solarisdk/desktop"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runDesktopOpen } from "@/scripts/desktop-open"
import { runDesktopBrowserTest } from "@/scripts/desktop-browser-test"
import { BROWSER_RENDER_WAIT_MS } from "@/scripts/desktop-browser"

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
  }
  return { marker, env, vm, client, viewer, deps }
}
afterEach(() => vi.restoreAllMocks())

describe("manual Desktop browser launch", () => {
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
    expect(h.client.pause).toHaveBeenCalledOnce()
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
    expect(h.client.pause).toHaveBeenCalledOnce()
    expect(h.vm.close).toHaveBeenCalledOnce()
  })
  it("uses a fallback only after Firefox absence and executable presence are confirmed", async () => {
    const h = harness()
    h.vm.open.mockRejectedValueOnce(new Error(h.marker))
    h.vm.exec
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
    expect(await runDesktopOpen(h.env, h.deps)).toBe(0)
    expect(h.vm.open.mock.calls).toEqual([
      ["firefox", [h.env.CLEANBREAK_REAL_PROVIDER_URL.split("?")[0]]],
      ["/usr/bin/chromium", [h.env.CLEANBREAK_REAL_PROVIDER_URL.split("?")[0]]],
    ])
    expect(h.vm.exec.mock.invocationCallOrder[1]).toBeLessThan(
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
      expect(h.vm.exec).not.toHaveBeenCalled()
    },
  )
})
