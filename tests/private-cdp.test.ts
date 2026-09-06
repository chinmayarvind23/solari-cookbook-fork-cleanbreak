import { afterEach, expect, it, vi } from "vitest"
import { createConnection, createServer, type Socket } from "node:net"
import { chromium, type Browser } from "patchright-core"
import type { Desktop } from "@solarisdk/desktop"
import { privateDesktopCDP } from "@/lib/desktop/private-cdp"

let browser: Browser | undefined
let bridge: Awaited<ReturnType<typeof privateDesktopCDP>> | undefined
afterEach(async () => {
  await bridge?.close()
  bridge = undefined
  await browser?.close()
  browser = undefined
  vi.restoreAllMocks()
})

it("carries real Playwright CDP over private SDK streams without exposing Chrome or closing it", async () => {
  const reserve = createServer()
  await new Promise<void>((done) => reserve.listen(0, "127.0.0.1", done))
  const port = (reserve.address() as { port: number }).port
  await new Promise<void>((done) => reserve.close(() => done()))
  browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
    args: [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
    ],
  })
  const metadata = (await (
    await fetch(`http://127.0.0.1:${port}/json/version`)
  ).json()) as { webSocketDebuggerUrl: string }
  const transportSockets = new Set<Socket>()
  const log = vi.spyOn(console, "log")
  const start = vi.fn(async (_cmd, options) => {
    const remote = createConnection({ host: "127.0.0.1", port })
    transportSockets.add(remote)
    const done = new Promise<number>((resolve) =>
      remote.on("close", () => resolve(0)),
    )
    remote.on("error", () => {})
    remote.on("data", (data) =>
      options.onStdout(data.toString("base64") + "\n"),
    )
    return {
      stdin: async (data: string) => {
        remote.write(Buffer.from(data.trim(), "base64"))
      },
      wait: () => done,
      kill: async () => {
        remote.destroy()
      },
      onData: () => {},
      cmdId: "offline-transport",
    }
  })
  const vm = {
    ports: { list: async () => [{ port: 9222, addr: "127.0.0.1" }] },
    exec: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        endpoint: metadata.webSocketDebuggerUrl.replace(`:${port}`, ":9222"),
      }),
      stderr: "",
    }),
    commands: { start },
  } as unknown as Desktop
  bridge = await privateDesktopCDP(vm)
  // Browser-originated connections and callers without the private header fail.
  for (const headers of [
    {},
    { ...bridge.headers, Origin: "https://unrelated.example" },
  ]) {
    await expect(
      chromium.connectOverCDP(bridge.endpoint, { headers, timeout: 1000 }),
    ).rejects.toThrow()
    expect(start).not.toHaveBeenCalled()
  }
  const attached = await chromium.connectOverCDP(bridge.endpoint, {
    headers: bridge.headers,
    timeout: 10000,
  })
  const page = await attached.contexts()[0].newPage()
  await page.setContent("<h1>Offline DOM check</h1>")
  expect(await page.locator("h1").innerText()).toBe("Offline DOM check")
  await page.close()
  await bridge.close()
  bridge = undefined
  expect(browser.isConnected()).toBe(true)
  expect(log).not.toHaveBeenCalled()
  for (const socket of transportSockets) socket.destroy()
}, 30000)

it.each([
  { ports: [] },
  { ports: [{ port: 9222, addr: "0.0.0.0" }] },
  { ports: [{ port: 9222, addr: "::" }] },
])(
  "rejects missing/public debug listeners before touching browser data",
  async ({ ports }) => {
    const exec = vi.fn()
    await expect(
      privateDesktopCDP({
        ports: { list: async () => ports },
        exec,
        commands: { start: vi.fn() },
      } as unknown as Desktop),
    ).rejects.toThrow("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
    expect(exec).not.toHaveBeenCalled()
  },
)

it.each([
  "ws://unrelated.example:9222/devtools/browser/test",
  "ws://127.0.0.1:9222/devtools/browser/test?token=private",
  "http://127.0.0.1:9222/devtools/browser/test",
])(
  "rejects any unexpected endpoint without logging its value",
  async (endpoint) => {
    const start = vi.fn(),
      log = vi.spyOn(console, "log")
    await expect(
      privateDesktopCDP({
        ports: { list: async () => [{ port: 9222, addr: "127.0.0.1" }] },
        exec: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({ endpoint }),
        }),
        commands: { start },
      } as unknown as Desktop),
    ).rejects.toThrow("PRIVATE_DOM_CONNECTION_UNAVAILABLE")
    expect(start).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  },
)
