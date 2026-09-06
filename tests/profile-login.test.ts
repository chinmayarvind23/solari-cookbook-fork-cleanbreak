// Checks manual local authentication and in-memory profile saves.
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CONFIRMATION_PROMPT,
  profileMetadata,
  runProfileHelper,
  storageStateDiagnostics,
  waitForConfirmation,
} from "@/scripts/profile-login"

vi.mock("node:readline", () => ({ createInterface: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

const environment = {
  SOLARI_API_KEY: "test-key-not-for-output",
  SOLARI_PROFILE_NAME: "cleanbreak-miro",
  CLEANBREAK_REAL_PROVIDER_NAME: "Miro",
  CLEANBREAK_REAL_PROVIDER_URL:
    "https://miro.com/app/settings/company/test-company/billing",
  CLEANBREAK_REAL_PROVIDER_PLAN_NAME: "Business Trial",
}

function harness() {
  const storageState = {
    cookies: [{ name: "session", value: "private-cookie" }],
    origins: [
      {
        origin: "https://miro.com",
        localStorage: [{ name: "token", value: "private-token" }],
        indexedDB: [
          {
            name: "private-db-name",
            version: 1,
            stores: [
              {
                name: "private-store-name",
                records: [
                  {
                    key: "private-record-key",
                    value: "private-indexeddb-token",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    toJSON: vi.fn(() => {
      throw new Error("Helper must not serialize storage state")
    }),
  }
  const profile = {
    id: "prof_test",
    name: "cleanbreak-miro",
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
    expect(run.page.goto).toHaveBeenCalledWith(
      environment.CLEANBREAK_REAL_PROVIDER_URL,
      {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      },
    )
    expect(run.context.storageState.mock.calls).toEqual([[{ indexedDB: true }]])
    expect(run.client.profiles.save).toHaveBeenCalledOnce()
    expect(run.client.profiles.save.mock.calls[0][0]).toBe("prof_test")
    expect(run.client.profiles.save.mock.calls[0][1]).toBe(run.storageState)
    expect(run.storageState.toJSON).not.toHaveBeenCalled()
    expect(run.client.launch).not.toHaveBeenCalled()
    expect(run.browser.close).toHaveBeenCalledOnce()
    expect(run.client.close).toHaveBeenCalledOnce()
    expect(JSON.parse(run.dependencies.output.mock.calls.at(-1)![0])).toEqual({
      name: "cleanbreak-miro",
      id: "prof_test",
      version: 2,
      sizeBytes: 321,
    })
    const output = run.dependencies.output.mock.calls.flat().join(" ")
    for (const secret of [
      environment.SOLARI_API_KEY,
      "private-cookie",
      "private-token",
      "private-db-name",
      "private-store-name",
      "private-record-key",
      "private-indexeddb-token",
      "localStorage",
      "indexedDB",
    ])
      expect(output).not.toContain(secret)
    expect(output).toContain(CONFIRMATION_PROMPT)
    expect(run.dependencies.output.mock.calls[1]).toEqual([
      "Log in and complete MFA manually in the local Chromium window. Confirm that Business Trial is visible in Miro's billing/subscription page.",
    ])
    expect(output).not.toContain(environment.CLEANBREAK_REAL_PROVIDER_URL)
    expect(output).not.toContain("Canva")
    expect(Object.keys(run.storageState)).not.toContain("provider")
  })

  it.each(["missing", "CleanBreak-Miro", "cleanbreak-miro "])(
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
      await runProfileHelper(
        ["--list"],
        { SOLARI_API_KEY: environment.SOLARI_API_KEY },
        run.dependencies,
      ),
    ).toBe(0)
    expect(run.dependencies.output.mock.calls).toEqual([
      [
        JSON.stringify({
          name: "cleanbreak-miro",
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
    expect(source).toContain("context.storageState({ indexedDB: true })")
    expect(source).not.toMatch(/CANVA_BILLING_URL|canva\.com|Canva/)
  })

  it.each([
    [undefined, "Set CLEANBREAK_REAL_PROVIDER_URL"],
    ["  ", "Set CLEANBREAK_REAL_PROVIDER_URL"],
    ["not-a-url", "must be a valid HTTPS URL"],
    ["http://miro.com/billing", "must use HTTPS"],
    ["javascript:alert(1)", "must use HTTPS"],
    [
      "https://private-user:private-password@miro.com/billing",
      "must not contain embedded username/password",
    ],
    [
      "https://private-user@miro.com/billing",
      "must not contain embedded username/password",
    ],
    [
      "https://:private-password@miro.com/billing",
      "must not contain embedded username/password",
    ],
  ])(
    "rejects invalid provider URL %# before any client/browser work",
    async (url, message) => {
      const run = harness()
      expect(
        await runProfileHelper(
          [],
          { ...environment, CLEANBREAK_REAL_PROVIDER_URL: url },
          run.dependencies,
        ),
      ).toBe(1)
      const output = run.dependencies.output.mock.calls.flat().join(" ")
      expect(output).toContain(message)
      expect(output).not.toContain("private-user")
      expect(output).not.toContain("private-password")
      expect(run.dependencies.createClient).not.toHaveBeenCalled()
      expect(run.dependencies.launchBrowser).not.toHaveBeenCalled()
      expect(run.client.profiles.save).not.toHaveBeenCalled()
    },
  )

  it.each([
    "CLEANBREAK_REAL_PROVIDER_NAME",
    "CLEANBREAK_REAL_PROVIDER_PLAN_NAME",
  ])("requires a safe %s display label", async (key) => {
    for (const value of [
      undefined,
      " ",
      "Bad\nInjected message",
      "Bad\u001b[2J",
      "Bad\u202eLabel",
      environment.SOLARI_API_KEY,
    ]) {
      const run = harness()
      expect(
        await runProfileHelper(
          [],
          { ...environment, [key]: value },
          run.dependencies,
        ),
      ).toBe(1)
      const output = run.dependencies.output.mock.calls.flat().join(" ")
      expect(output).toContain(key)
      expect(output).not.toContain("Injected message")
      expect(output).not.toContain(environment.SOLARI_API_KEY)
      expect(run.dependencies.createClient).not.toHaveBeenCalled()
      expect(run.dependencies.launchBrowser).not.toHaveBeenCalled()
    }
  })

  it("uses arbitrary provider/plan labels only in the instruction prompt, never for profile selection or navigation", async () => {
    const run = harness()
    const config = {
      ...environment,
      CLEANBREAK_REAL_PROVIDER_NAME: "Other Provider",
      CLEANBREAK_REAL_PROVIDER_PLAN_NAME: "Professional Annual",
    }
    expect(await runProfileHelper([], config, run.dependencies)).toBe(0)
    const lines = run.dependencies.output.mock.calls.flat() as string[]
    expect(
      lines.filter(
        (line) =>
          line.includes("Other Provider") ||
          line.includes("Professional Annual"),
      ),
    ).toEqual([
      "Log in and complete MFA manually in the local Chromium window. Confirm that Professional Annual is visible in Other Provider's billing/subscription page.",
    ])
    expect(run.page.goto).toHaveBeenCalledWith(
      environment.CLEANBREAK_REAL_PROVIDER_URL,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    )
    expect(run.client.profiles.save.mock.calls[0]).toEqual([
      "prof_test",
      run.storageState,
    ])
    expect(run.storageState.toJSON).not.toHaveBeenCalled()
  })

  it("suppresses raw navigation errors, including private URL parameters", async () => {
    const run = harness()
    run.page.goto.mockRejectedValue(new Error("private-url-token"))
    const config = {
      ...environment,
      CLEANBREAK_REAL_PROVIDER_URL: `${environment.CLEANBREAK_REAL_PROVIDER_URL}?token=private-url-token`,
    }
    expect(await runProfileHelper([], config, run.dependencies)).toBe(1)
    expect(run.dependencies.output.mock.calls.flat().join(" ")).not.toContain(
      "private-url-token",
    )
    expect(run.client.profiles.save).not.toHaveBeenCalled()
    expect(run.browser.close).toHaveBeenCalledOnce()
    expect(run.client.close).toHaveBeenCalledOnce()
  })

  it("fails closed on IndexedDB capture errors without a partial-state fallback", async () => {
    const run = harness()
    run.context.storageState.mockRejectedValue(
      new Error("private-indexeddb-token"),
    )
    expect(await runProfileHelper([], environment, run.dependencies)).toBe(1)
    expect(run.context.storageState.mock.calls).toEqual([[{ indexedDB: true }]])
    expect(run.client.profiles.save).not.toHaveBeenCalled()
    expect(run.dependencies.output.mock.calls.flat().join(" ")).not.toContain(
      "private-indexeddb-token",
    )
    expect(run.browser.close).toHaveBeenCalledOnce()
    expect(run.client.close).toHaveBeenCalledOnce()
  })
})

describe("count-only storage state diagnostics", () => {
  it("reports only counts and IndexedDB presence without reading any names or values", () => {
    const forbiddenRead = () => {
      throw new Error("Diagnostic read a private value")
    }
    const state = {
      cookies: [
        {
          get name(): string {
            return forbiddenRead()
          },
          get value(): string {
            return forbiddenRead()
          },
        },
      ],
      origins: [
        {
          get origin(): string {
            return forbiddenRead()
          },
          get localStorage(): [] {
            return forbiddenRead()
          },
          indexedDB: [
            {
              get name(): string {
                return forbiddenRead()
              },
              get stores(): [] {
                return forbiddenRead()
              },
            },
          ],
        },
      ],
      toJSON: forbiddenRead,
    }
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const diagnostics = storageStateDiagnostics(state)
    expect(diagnostics).toEqual({
      cookieCount: 1,
      originCount: 1,
      hasIndexedDB: true,
    })
    expect(JSON.stringify(diagnostics)).toBe(
      '{"cookieCount":1,"originCount":1,"hasIndexedDB":true}',
    )
    expect(output).not.toHaveBeenCalled()
  })

  it("handles absent state collections and origins with no IndexedDB", () => {
    expect(storageStateDiagnostics({})).toEqual({
      cookieCount: 0,
      originCount: 0,
      hasIndexedDB: false,
    })
    const state = {
      cookies: [],
      origins: [
        { origin: "https://provider.example", localStorage: [], indexedDB: [] },
      ],
    }
    expect(storageStateDiagnostics(state)).toEqual({
      cookieCount: 0,
      originCount: 1,
      hasIndexedDB: false,
    })
  })

  it("checks every origin rather than only the first origin", () => {
    const state = {
      cookies: [],
      origins: [
        { origin: "https://first.example", localStorage: [], indexedDB: [] },
        { origin: "https://second.example", localStorage: [], indexedDB: [{}] },
      ],
    }
    expect(storageStateDiagnostics(state)).toEqual({
      cookieCount: 0,
      originCount: 2,
      hasIndexedDB: true,
    })
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
