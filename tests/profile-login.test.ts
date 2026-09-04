import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CANVA_BILLING_URL,
  CONFIRMATION_PROMPT,
  profileMetadata,
  runProfileHelper,
  waitForConfirmation,
} from "@/scripts/profile-login"

vi.mock("node:readline", () => ({ createInterface: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

const environment = {
  SOLARI_API_KEY: "test-key-not-for-output",
  SOLARI_PROFILE_NAME: "cleanbreak-canva",
}

function harness() {
  const storageState = {
    cookies: [{ name: "session", value: "private-cookie" }],
    origins: [
      {
        origin: "https://www.canva.com",
        localStorage: [{ name: "token", value: "private-token" }],
      },
    ],
    toJSON: vi.fn(() => {
      throw new Error("Helper must not serialize storage state")
    }),
  }
  const profile = {
    id: "prof_test",
    name: "cleanbreak-canva",
    version: 1,
    sizeBytes: "0",
    storageState,
  }
  const client = {
    profiles: {
      list: vi.fn(async () => [profile]),
      create: vi.fn(),
      save: vi.fn(async (_id: string, _state: unknown) => ({
        version: 2,
        sizeBytes: 321,
      })),
    },
    launch: vi.fn(),
    close: vi.fn(async () => undefined),
  }
  const page = { goto: vi.fn(async () => null) }
  const context = {
    newPage: vi.fn(async () => page),
    storageState: vi.fn(async () => storageState),
  }
  const browser = Object.assign(new EventEmitter(), {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  })
  const dependencies = {
    createClient: vi.fn(() => client),
    launchBrowser: vi.fn(async () => browser),
    confirm: vi.fn(async (_signal: AbortSignal) => undefined),
    interactive: true,
    output: vi.fn(),
  }
  return { client, browser, context, page, profile, storageState, dependencies }
}

describe("developer local profile login", () => {
  it("looks up the exact existing profile and uploads the identical in-memory object only after confirmation", async () => {
    const run = harness()
    run.dependencies.confirm.mockImplementation(async () => {
      expect(run.context.storageState).not.toHaveBeenCalled()
      expect(run.client.profiles.save).not.toHaveBeenCalled()
    })
    expect(await runProfileHelper([], environment, run.dependencies)).toBe(0)
    expect(run.client.profiles.list).toHaveBeenCalledOnce()
    expect(run.page.goto).toHaveBeenCalledWith(CANVA_BILLING_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    expect(run.context.storageState.mock.calls).toEqual([[]])
    expect(run.client.profiles.save).toHaveBeenCalledOnce()
    expect(run.client.profiles.save.mock.calls[0][0]).toBe("prof_test")
    expect(run.client.profiles.save.mock.calls[0][1]).toBe(run.storageState)
    expect(run.storageState.toJSON).not.toHaveBeenCalled()
    expect(run.client.launch).not.toHaveBeenCalled()
    expect(run.browser.close).toHaveBeenCalledOnce()
    expect(run.client.close).toHaveBeenCalledOnce()
    expect(JSON.parse(run.dependencies.output.mock.calls.at(-1)![0])).toEqual({
      name: "cleanbreak-canva",
      id: "prof_test",
      version: 2,
      sizeBytes: 321,
      nonEmpty: true,
    })
    const output = run.dependencies.output.mock.calls.flat().join(" ")
    for (const secret of [
      environment.SOLARI_API_KEY,
      "private-cookie",
      "private-token",
      "localStorage",
    ])
      expect(output).not.toContain(secret)
    expect(output).toContain(CONFIRMATION_PROMPT)
  })

  it.each(["missing", "CleanBreak-Canva", "cleanbreak-canva "])(
    "fails on nonmatching name %s without creating a profile or browser",
    async (name) => {
      const run = harness()
      expect(
        await runProfileHelper(
          [],
          { ...environment, SOLARI_PROFILE_NAME: name },
          run.dependencies,
        ),
      ).toBe(1)
      expect(run.dependencies.output.mock.calls.flat().join(" ")).toContain(
        "No profile exactly matches",
      )
      expect(run.dependencies.launchBrowser).not.toHaveBeenCalled()
      expect(run.client.profiles.create).not.toHaveBeenCalled()
      expect(run.client.close).toHaveBeenCalledOnce()
    },
  )

  it("cancellation does not capture or upload state", async () => {
    const run = harness()
    run.dependencies.confirm.mockRejectedValue(new Error("canceled"))
    expect(await runProfileHelper([], environment, run.dependencies)).toBe(1)
    expect(run.context.storageState).not.toHaveBeenCalled()
    expect(run.client.profiles.save).not.toHaveBeenCalled()
    expect(run.browser.close).toHaveBeenCalledOnce()
    expect(run.client.close).toHaveBeenCalledOnce()
  })

  it("browser disconnect aborts confirmation and does not upload", async () => {
    const run = harness()
    run.dependencies.confirm.mockImplementation(async (signal) => {
      run.browser.emit("disconnected")
      expect(signal.aborted).toBe(true)
    })
    expect(await runProfileHelper([], environment, run.dependencies)).toBe(1)
    expect(run.client.profiles.save).not.toHaveBeenCalled()
  })

  it("withholds upload error contents and closes the client even if browser cleanup fails", async () => {
    const run = harness()
    run.client.profiles.save.mockRejectedValue(new Error("private-cookie"))
    run.browser.close.mockRejectedValue(new Error("private-token"))
    expect(await runProfileHelper([], environment, run.dependencies)).toBe(1)
    expect(run.client.close).toHaveBeenCalledOnce()
    const output = run.dependencies.output.mock.calls.flat().join(" ")
    expect(output).not.toContain("private-cookie")
    expect(output).not.toContain("private-token")
  })

  it("rejects piped confirmation without launching", async () => {
    const run = harness()
    expect(
      await runProfileHelper([], environment, {
        ...run.dependencies,
        interactive: false,
      }),
    ).toBe(1)
    expect(run.dependencies.launchBrowser).not.toHaveBeenCalled()
  })

  it("lists only safe metadata without browser or state access", async () => {
    const run = harness()
    expect(
      await runProfileHelper(["--list"], environment, run.dependencies),
    ).toBe(0)
    expect(run.dependencies.output.mock.calls).toEqual([
      [
        JSON.stringify({
          name: "cleanbreak-canva",
          id: "prof_test",
          version: 1,
          sizeBytes: 0,
        }),
      ],
    ])
    expect(run.dependencies.launchBrowser).not.toHaveBeenCalled()
    expect(run.client.profiles.save).not.toHaveBeenCalled()
    expect(run.client.close).toHaveBeenCalledOnce()
  })

  it("distinguishes absent size from numeric zero", () => {
    expect(
      profileMetadata({ id: "p", name: "n", sizeBytes: "0" }).sizeBytes,
    ).toBe(0)
    expect(
      profileMetadata({ id: "p", name: "n", sizeBytes: null }).sizeBytes,
    ).toBe("not exposed")
  })

  it("has no filesystem-writing, recording, or persistent-context API in the helper", () => {
    const source = readFileSync(
      new URL("../scripts/profile-login.ts", import.meta.url),
      "utf8",
    )
    expect(source).not.toMatch(
      /(?:node:fs|writeFile|createWriteStream|launchPersistentContext|recordVideo|recordHar|\.tracing|\.screenshot)/,
    )
    expect(source).toContain("headless: false")
    expect(source).toContain("context.storageState()")
  })
})

describe("terminal confirmation", () => {
  it.each(["close", "SIGINT"])(
    "does not mistake %s for Enter",
    async (event) => {
      const terminal = Object.assign(new EventEmitter(), { close: vi.fn() })
      vi.mocked(createInterface).mockReturnValue(terminal as never)
      const pending = waitForConfirmation(new AbortController().signal)
      const rejection = expect(pending).rejects.toThrow("canceled")
      terminal.emit(event)
      await rejection
    },
  )

  it("resolves only on an empty submitted line", async () => {
    const terminal = Object.assign(new EventEmitter(), { close: vi.fn() })
    vi.mocked(createInterface).mockReturnValue(terminal as never)
    const pending = waitForConfirmation(new AbortController().signal)
    terminal.emit("line", "not confirmation")
    expect(terminal.close).not.toHaveBeenCalled()
    terminal.emit("line", "")
    await expect(pending).resolves.toBeUndefined()
    expect(terminal.close).toHaveBeenCalledOnce()
  })
})
