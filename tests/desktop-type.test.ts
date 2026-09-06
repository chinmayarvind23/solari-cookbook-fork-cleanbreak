// Checks literal keyboard input, secret handling, and cleanup.
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import fsPromises from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readHiddenText, runDesktopType } from "@/scripts/desktop-type"

vi.mock("@/lib/desktop/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop/session")>()),
  readDesktopSessionState: vi.fn(() => undefined),
}))

// Generated disposable test data, never real credentials or password fixtures.
const environment = () => ({
  SOLARI_API_KEY: randomBytes(24).toString("hex"),
  SOLARI_DESKTOP_SESSION_ID: `pool:vm:org.${randomBytes(24).toString("hex")}`,
})
function harness() {
  const vm = {
    connect: vi.fn(async () => undefined),
    health: vi.fn(async () => ({ ready: true, display: true, vnc: true })),
    close: vi.fn(),
    keyboard: { type: vi.fn(async (_text: string) => undefined) },
  }
  const client = { connect: vi.fn(async (_id: string) => vm) }
  const deps = {
    createClient: vi.fn(() => client),
    output: vi.fn(),
    readSecret: vi.fn(async () => randomBytes(24).toString("base64")),
    interactive: true,
    wait: vi.fn(async () => undefined),
  }
  return { vm, client, deps }
}
class Terminal extends EventEmitter {
  isTTY = true
  isRaw = false
  paused = true
  setRawMode = vi.fn((raw: boolean) => {
    this.isRaw = raw
    return this
  })
  isPaused() {
    return this.paused
  }
  resume() {
    this.paused = false
    return this
  }
  pause() {
    this.paused = true
    return this
  }
  read(signal: AbortSignal, output: (text: string) => void) {
    return readHiddenText(signal, output, this as unknown as NodeJS.ReadStream)
  }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("developer desktop literal typing", () => {
  it.each(["SOLARI_API_KEY", "SOLARI_DESKTOP_SESSION_ID"])(
    "requires %s before connecting",
    async (key) => {
      const { deps } = harness()
      expect(
        await runDesktopType(
          ["--test"],
          { ...environment(), [key]: " " },
          deps,
        ),
      ).toBe(1)
      expect(deps.output.mock.calls.flat().join(" ")).toContain(key)
      expect(deps.createClient).not.toHaveBeenCalled()
    },
  )
  it("connects only to the existing ID and types exact mixed-case test text once", async () => {
    const { vm, client, deps } = harness()
    const env = environment()
    expect(await runDesktopType(["--test"], env, deps)).toBe(0)
    expect(client.connect).toHaveBeenCalledExactlyOnceWith(
      env.SOLARI_DESKTOP_SESSION_ID,
    )
    expect(vm.connect).toHaveBeenCalledOnce()
    expect(vm.keyboard.type).toHaveBeenCalledExactlyOnceWith("AbCdEF123")
    expect(deps.readSecret).not.toHaveBeenCalled()
    expect(vm.close).toHaveBeenCalledOnce()
    expect(deps.output.mock.calls).toEqual([
      [`Desktop target: ${env.SOLARI_DESKTOP_SESSION_ID}`],
      ["Typed test text into focused desktop field."],
    ])
    expect(deps.output.mock.invocationCallOrder[0]).toBeLessThan(
      client.connect.mock.invocationCallOrder[0],
    )
  })
  it("uploads only terminal-confirmed text, with safe status and no console/file output", async () => {
    const { vm, deps } = harness()
    const env = environment()
    const generated = randomBytes(24).toString("base64")
    const terminal = new Terminal()
    const writes = [
      vi.spyOn(fs, "writeFileSync"),
      vi.spyOn(fs, "appendFileSync"),
      vi.spyOn(fs, "writeFile"),
      vi.spyOn(fs, "appendFile"),
      vi.spyOn(fs, "createWriteStream"),
      vi.spyOn(fs, "openSync"),
      vi.spyOn(fs, "open"),
      vi.spyOn(fs, "writeSync"),
      vi.spyOn(fs, "write"),
      vi.spyOn(fsPromises, "writeFile"),
      vi.spyOn(fsPromises, "appendFile"),
      vi.spyOn(fsPromises, "open"),
    ]
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(process.stdout, "write"),
      vi.spyOn(process.stderr, "write"),
    ]
    deps.readSecret.mockImplementation((...args: unknown[]) =>
      terminal.read(args[0] as AbortSignal, args[1] as (text: string) => void),
    )
    const result = runDesktopType(["--secret"], env, deps)
    await vi.waitFor(() => expect(terminal.isRaw).toBe(true))
    terminal.emit("data", Buffer.from(generated))
    expect(vm.keyboard.type).not.toHaveBeenCalled()
    terminal.emit("data", Buffer.from("\r"))
    expect(await result).toBe(0)
    // Boolean comparison avoids including the generated input in failure output.
    expect(
      vm.keyboard.type.mock.calls.length === 1 &&
        vm.keyboard.type.mock.calls[0][0] === generated,
    ).toBe(true)
    const output = deps.output.mock.calls.flat().join(" ")
    for (const value of [generated, env.SOLARI_API_KEY])
      expect(output.includes(value)).toBe(false)
    expect(deps.output.mock.calls.at(-1)).toEqual([
      "Typed secret into focused desktop field.",
    ])
    for (const spy of [...writes, ...logs])
      expect(spy.mock.calls.length).toBe(0)
    expect(vm.close).toHaveBeenCalledOnce()
    expect(terminal.isRaw).toBe(false)
    expect(terminal.eventNames()).toEqual([])
  })
  it("rejects secret arguments without echoing them", async () => {
    const { deps } = harness()
    const generated = randomBytes(24).toString("base64")
    expect(
      await runDesktopType(["--secret", generated], environment(), deps),
    ).toBe(1)
    expect(deps.output.mock.calls.flat().join(" ").includes(generated)).toBe(
      false,
    )
    expect(deps.createClient).not.toHaveBeenCalled()
  })
  it("rejects noninteractive secret entry before connecting", async () => {
    const { deps } = harness()
    expect(
      await runDesktopType(["--secret"], environment(), {
        ...deps,
        interactive: false,
      }),
    ).toBe(1)
    expect(deps.createClient).not.toHaveBeenCalled()
  })
  it.each(["connect", "health", "input", "type", "close"])(
    "cleans up on %s failure without exposing raw errors or retrying input",
    async (stage) => {
      const { vm, deps } = harness()
      const error = new Error(randomBytes(24).toString("base64"))
      if (stage === "connect") vm.connect.mockRejectedValueOnce(error)
      if (stage === "health") vm.health.mockRejectedValueOnce(error)
      if (stage === "input") deps.readSecret.mockRejectedValueOnce(error)
      if (stage === "type") vm.keyboard.type.mockRejectedValueOnce(error)
      if (stage === "close")
        vm.close.mockImplementationOnce(() => {
          throw error
        })
      expect(await runDesktopType(["--secret"], environment(), deps)).toBe(1)
      expect(vm.close).toHaveBeenCalledOnce()
      expect(vm.keyboard.type.mock.calls.length).toBe(
        stage === "type" || stage === "close" ? 1 : 0,
      )
      expect(
        deps.output.mock.calls.flat().join(" ").includes(error.message),
      ).toBe(false)
    },
  )
  it("bounds readiness polling and never reads or types a secret when not ready", async () => {
    const { vm, deps } = harness()
    vm.health.mockResolvedValue({ ready: false, display: false, vnc: false })
    expect(await runDesktopType(["--secret"], environment(), deps)).toBe(1)
    expect(vm.health).toHaveBeenCalledTimes(30)
    expect(deps.readSecret).not.toHaveBeenCalled()
    expect(vm.keyboard.type).not.toHaveBeenCalled()
    expect(vm.close).toHaveBeenCalledOnce()
  })
  it("withholds text and cleans up on a signal during terminal confirmation", async () => {
    const { vm, deps } = harness()
    const baseline = process.listenerCount("SIGINT")
    deps.readSecret.mockImplementation(async () => {
      process.emit("SIGINT")
      return randomBytes(12).toString("hex")
    })
    expect(await runDesktopType(["--secret"], environment(), deps)).toBe(1)
    expect(vm.keyboard.type).not.toHaveBeenCalled()
    expect(vm.close).toHaveBeenCalledOnce()
    expect(process.listenerCount("SIGINT")).toBe(baseline)
  })
})

describe("safe test-stage diagnostics", () => {
  it.each(["client_connect", "vm_connect", "health_check", "keyboard_type"])(
    "exposes %s and safe name/message, without error metadata",
    async (stage) => {
      const { vm, client, deps } = harness()
      const generated = randomBytes(24).toString("hex")
      const error = Object.assign(new Error("  Control channel closed  "), {
        name: "ConnectionError",
        headers: generated,
        body: generated,
        cause: generated,
        stack: generated,
      })
      if (stage === "client_connect")
        client.connect.mockRejectedValueOnce(error)
      if (stage === "vm_connect") vm.connect.mockRejectedValueOnce(error)
      if (stage === "health_check") vm.health.mockRejectedValueOnce(error)
      if (stage === "keyboard_type")
        vm.keyboard.type.mockRejectedValueOnce(error)
      expect(await runDesktopType(["--test"], environment(), deps)).toBe(1)
      expect(deps.output.mock.calls[1]).toEqual([
        `Desktop test failure: ${JSON.stringify({ stage, name: "ConnectionError", message: "Control channel closed" })}`,
      ])
      expect(deps.output.mock.calls.flat().join(" ").includes(generated)).toBe(
        false,
      )
      expect(vm.keyboard.type.mock.calls.length).toBe(
        stage === "keyboard_type" ? 1 : 0,
      )
      expect(vm.close.mock.calls.length).toBe(
        stage === "client_connect" ? 0 : 1,
      )
    },
  )
  it.each([
    "api-key",
    "encoded-key",
    "base64-key",
    "configured-token",
    "authorization",
    "cookie",
    "token",
    "secret",
    "password",
    "query",
    "body",
    "headers",
    "stack",
    "opaque",
    "name",
    "controls",
  ])("redacts %s without losing the stage", async (kind) => {
    const { vm, deps } = harness()
    const env = {
      ...environment(),
      TEST_ACCESS_TOKEN: randomBytes(24).toString("hex"),
    }
    const generated = randomBytes(24).toString("base64")
    const messages: Record<string, string> = {
      "api-key": env.SOLARI_API_KEY,
      "encoded-key": encodeURIComponent(env.SOLARI_API_KEY),
      "base64-key": Buffer.from(env.SOLARI_API_KEY).toString("base64"),
      "configured-token": env.TEST_ACCESS_TOKEN,
      authorization: `Authorization: Bearer ${generated}`,
      cookie: `Cookie: session=${generated}`,
      token: `token=${generated}`,
      secret: `secret: ${generated}`,
      password: `password: ${generated}`,
      query: `https://example.invalid/connect?data=${generated}`,
      body: JSON.stringify({ data: generated }),
      headers: `X-Custom: ${generated}`,
      stack: `Control channel closed\n at ${generated}`,
      opaque: generated,
      controls: `Control channel closed\u001b[31m${generated}`,
      name: "unrecognized remote response",
    }
    const error = new Error(messages[kind])
    error.name = kind === "name" ? generated : "ConnectionError"
    vm.connect.mockRejectedValueOnce(error)
    expect(await runDesktopType(["--test"], env, deps)).toBe(1)
    expect(deps.output.mock.calls[1]).toEqual([
      `Desktop test failure: ${JSON.stringify({ stage: "vm_connect", name: kind === "name" ? "Error" : "ConnectionError", message: "[redacted]" })}`,
    ])
    const output = deps.output.mock.calls.flat().join(" ")
    for (const value of [generated, env.SOLARI_API_KEY, env.TEST_ACCESS_TOKEN])
      expect(output.includes(value)).toBe(false)
  })
  it("redacts a configured credential even when it matches otherwise safe text", async () => {
    const { vm, deps } = harness()
    vm.connect.mockRejectedValueOnce(new Error("Control channel closed"))
    await runDesktopType(
      ["--test"],
      { ...environment(), TEST_SECRET: "Control channel closed" },
      deps,
    )
    expect(deps.output.mock.calls[1][0]).toContain('"message":"[redacted]"')
  })
  it("redacts malformed desktop targets and keys accidentally used as the ID", async () => {
    for (const kind of ["key", "controls"]) {
      const { deps } = harness()
      const env = environment()
      env.SOLARI_DESKTOP_SESSION_ID =
        kind === "key" ? env.SOLARI_API_KEY : "invalid\nAuthorization: data"
      expect(await runDesktopType(["--test"], env, deps)).toBe(1)
      expect(deps.createClient).not.toHaveBeenCalled()
      expect(
        deps.output.mock.calls.flat().join(" ").includes(env.SOLARI_API_KEY),
      ).toBe(false)
    }
  })
  it("keeps secret-mode SDK errors generic even when they echo the entered value", async () => {
    const { vm, deps } = harness()
    const generated = randomBytes(24).toString("base64")
    deps.readSecret.mockResolvedValueOnce(generated)
    vm.keyboard.type.mockImplementationOnce(async (value) => {
      throw Object.assign(new Error(value), { name: value })
    })
    const env = environment()
    expect(await runDesktopType(["--secret"], env, deps)).toBe(1)
    expect(deps.output.mock.calls).toEqual([
      [`Desktop target: ${env.SOLARI_DESKTOP_SESSION_ID}`],
      [
        "Typing was not confirmed; inspect the focused field before retrying. Raw SDK details withheld.",
      ],
    ])
    expect(deps.output.mock.calls.flat().join(" ").includes(generated)).toBe(
      false,
    )
    expect(vm.close).toHaveBeenCalledOnce()
  })
})

describe("hidden terminal reader", () => {
  it("disables echo before prompting, accepts Unicode and backspace, restores terminal", async () => {
    const terminal = new Terminal()
    const output = vi.fn(() => expect(terminal.isRaw).toBe(true))
    const pending = terminal.read(new AbortController().signal, output)
    const generated = randomBytes(16).toString("base64")
    terminal.emit("data", Buffer.from(generated + "é"))
    terminal.emit("data", Buffer.from([127]))
    terminal.emit("data", Buffer.from("\r\n"))
    expect((await pending) === generated).toBe(true)
    expect(output).toHaveBeenCalledOnce()
    expect(terminal.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(terminal.paused).toBe(true)
  })
  it.each([
    "ctrl-c",
    "ctrl-d",
    "escape",
    "paste",
    "empty",
    "end",
    "close",
    "error",
    "abort",
    "timeout",
    "overflow",
  ])("cancels safely on %s", async (event) => {
    vi.useFakeTimers()
    const terminal = new Terminal()
    const controller = new AbortController()
    const pending = terminal.read(controller.signal, vi.fn())
    const rejected = expect(pending).rejects.toThrow(
      "Hidden input canceled or unavailable.",
    )
    if (event === "ctrl-c") terminal.emit("data", Buffer.from([3]))
    if (event === "ctrl-d") terminal.emit("data", Buffer.from([4]))
    if (event === "escape") terminal.emit("data", Buffer.from([27]))
    if (event === "paste")
      terminal.emit("data", Buffer.from(randomBytes(12).toString("hex") + "\n"))
    if (event === "empty") terminal.emit("data", Buffer.from("\r"))
    if (["end", "close", "error"].includes(event)) terminal.emit(event)
    if (event === "abort") controller.abort()
    if (event === "timeout") vi.advanceTimersByTime(5 * 60_000)
    if (event === "overflow") terminal.emit("data", Buffer.alloc(16_385, 65))
    await rejected
    expect(terminal.isRaw).toBe(false)
    expect(terminal.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
  it("rejects piped input without attaching listeners", async () => {
    const terminal = new Terminal()
    terminal.isTTY = false
    await expect(
      terminal.read(new AbortController().signal, vi.fn()),
    ).rejects.toThrow("active terminal")
    expect(terminal.setRawMode).not.toHaveBeenCalled()
    expect(terminal.eventNames()).toEqual([])
  })
})
