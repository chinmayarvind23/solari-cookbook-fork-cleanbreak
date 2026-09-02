import type { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createDatabase } from "@/lib/db"
import { readSolariConfig, SolariConfigurationError } from "@/lib/solari/config"
import { resolveReusableProfile } from "@/lib/solari/profile"
import { pollForReplay } from "@/lib/solari/recording"
import { createSolariRunRepository } from "@/lib/solari/repository"
import {
  type BrowserPageLike,
  type BrowserSessionLike,
  type SolariClientLike,
  runSolariSmoke,
} from "@/lib/solari/runner"
import type {
  SolariRun,
  SolariRunPatch,
  SolariRunRepository,
} from "@/lib/solari/types"

const config = readSolariConfig({
  SOLARI_API_KEY: "test-secret-key",
  CLEANBREAK_PUBLIC_BASE_URL: "https://cleanbreak.example",
})

class MemoryRepository implements SolariRunRepository {
  run: SolariRun | null = null

  create(run: SolariRun) {
    this.run = { ...run }
  }

  update(_id: string, patch: SolariRunPatch) {
    if (!this.run) throw new Error("Missing run")
    this.run = { ...this.run, ...patch }
  }

  getById() {
    return this.run ? { ...this.run } : null
  }

  getLatest() {
    return this.getById()
  }
}

function createHarness(
  options: {
    failNavigation?: boolean
    failWait?: boolean
    failScreenshot?: boolean
    replayUnavailable?: boolean
  } = {},
) {
  const repository = new MemoryRepository()
  const closeBrowser = vi.fn(async () => undefined)
  const closeClient = vi.fn(async () => undefined)
  const saveProfile = vi.fn(async () => ({}))
  const launch = vi.fn(async (): Promise<BrowserSessionLike> => {
    const page: BrowserPageLike = {
      goto: vi.fn(async () => {
        if (options.failNavigation) throw new Error("timeout and secret")
      }),
      getByRole: vi.fn(() => ({
        waitFor: vi.fn(async () => {
          if (options.failWait) throw new Error("timeout detail")
        }),
      })),
      title: vi.fn(async () => "StreamMax | Account"),
      locator: vi.fn(() => ({
        innerText: vi.fn(async () => "Welcome back, Casey Premium plan"),
      })),
      screenshot: vi.fn(async () => {
        if (options.failScreenshot) throw new Error("disk detail")
      }),
      context: vi.fn(() => ({
        storageState: vi.fn(async () => ({ cookies: [] })),
      })),
    }
    return { id: "session_123", newPage: async () => page, close: closeBrowser }
  })
  const getReplayUrl = vi.fn(async () => {
    if (options.replayUnavailable) throw { status: 404 }
    return { url: "https://replay.example/session_123" }
  })
  const client: SolariClientLike = {
    profiles: {
      list: async () => [{ id: "profile_123", name: "cleanbreak-demo" }],
      create: async ({ name }) => ({ id: "profile_new", name }),
      save: saveProfile,
    },
    sessions: { getReplayUrl },
    launch,
    close: closeClient,
  }
  const dependencies = {
    repository,
    createClient: vi.fn(() => client),
    prepareScreenshot: () => ({
      absolutePath: "C:/safe/evidence.png",
      relativePath: "artifacts/solari/run_123.png",
    }),
    id: () => "run_123",
    now: vi
      .fn()
      .mockReturnValueOnce(new Date("2026-09-02T12:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-09-02T12:00:02.500Z")),
    replayAttempts: 2,
    replayDelayMs: 0,
    sleep: vi.fn(async () => undefined),
  }

  return {
    repository,
    closeBrowser,
    closeClient,
    saveProfile,
    launch,
    getReplayUrl,
    dependencies,
  }
}

describe("Solari configuration boundaries", () => {
  it("rejects a missing server-side API key", () => {
    expect(() =>
      readSolariConfig({
        CLEANBREAK_PUBLIC_BASE_URL: "https://cleanbreak.example",
      }),
    ).toThrow(SolariConfigurationError)
  })

  it("builds the deterministic StreamMax target from the public base URL", () => {
    expect(config.targetUrl).toBe(
      "https://cleanbreak.example/demo/streammax/account",
    )
  })

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.4",
    "http://[::1]:3000",
  ])("rejects a local or private target: %s", (publicUrl) => {
    expect(() =>
      readSolariConfig({
        SOLARI_API_KEY: "secret",
        CLEANBREAK_PUBLIC_BASE_URL: publicUrl,
      }),
    ).toThrow(/publicly reachable/)
  })
})

describe("reusable Solari profiles", () => {
  it("reuses a configured profile after checking the account profile list", async () => {
    const list = vi.fn(async () => [
      { id: "profile_configured", name: "saved" },
    ])
    const create = vi.fn()

    await expect(
      resolveReusableProfile(
        { list, create, save: vi.fn() },
        { configuredId: "profile_configured", name: "cleanbreak-demo" },
      ),
    ).resolves.toEqual({ id: "profile_configured", created: false })
    expect(list).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })

  it("creates a named reusable profile only when none exists", async () => {
    const create = vi.fn(async ({ name }) => ({ id: "new_profile", name }))
    await expect(
      resolveReusableProfile(
        { list: async () => [], create, save: vi.fn() },
        { name: "cleanbreak-demo" },
      ),
    ).resolves.toEqual({ id: "new_profile", created: true })
    expect(create).toHaveBeenCalledWith({ name: "cleanbreak-demo" })
  })
})

describe("recorded Solari smoke lifecycle", () => {
  it("launches with the reusable profile and recording enabled", async () => {
    const harness = createHarness()
    await runSolariSmoke(config, harness.dependencies)

    expect(harness.launch).toHaveBeenCalledWith({
      profileId: "profile_123",
      recording: true,
      stealth: false,
    })
  })

  it("releases the browser and client after a successful observation", async () => {
    const harness = createHarness()
    const run = await runSolariSmoke(config, harness.dependencies)

    expect(run).toMatchObject({
      status: "SUCCEEDED",
      browserReleased: true,
      clientClosed: true,
      profileStateSaved: true,
    })
    expect(harness.closeBrowser).toHaveBeenCalledOnce()
    expect(harness.closeClient).toHaveBeenCalledOnce()
  })

  it("releases resources when navigation fails", async () => {
    const harness = createHarness({ failNavigation: true })
    const run = await runSolariSmoke(config, harness.dependencies)

    expect(run).toMatchObject({
      status: "FAILED",
      errorCode: "TARGET_UNREACHABLE",
      browserReleased: true,
      clientClosed: true,
    })
  })

  it("uses a safe timeout category when the account page never becomes usable", async () => {
    const harness = createHarness({ failWait: true })
    const run = await runSolariSmoke(config, harness.dependencies)

    expect(run).toMatchObject({
      status: "FAILED",
      errorCode: "NAVIGATION_TIMEOUT",
      browserReleased: true,
      clientClosed: true,
    })
  })

  it("releases resources when screenshot capture fails", async () => {
    const harness = createHarness({ failScreenshot: true })
    const run = await runSolariSmoke(config, harness.dependencies)

    expect(run).toMatchObject({
      status: "FAILED",
      errorCode: "SCREENSHOT_FAILED",
      browserReleased: true,
      clientClosed: true,
    })
  })

  it("still releases resources when a metadata update throws", async () => {
    const harness = createHarness()
    const update = harness.repository.update.bind(harness.repository)
    let firstUpdate = true
    harness.repository.update = (id, patch) => {
      if (firstUpdate) {
        firstUpdate = false
        throw new Error("sqlite detail")
      }
      update(id, patch)
    }

    const run = await runSolariSmoke(config, harness.dependencies)

    expect(run).toMatchObject({
      status: "FAILED",
      errorCode: "RUN_METADATA_ERROR",
      browserReleased: true,
      clientClosed: true,
    })
  })

  it("stores session evidence without serializing the API key", async () => {
    const harness = createHarness()
    const run = await runSolariSmoke(config, harness.dependencies)

    expect(run).toMatchObject({
      sessionId: "session_123",
      profileId: "profile_123",
      pageTitle: "StreamMax | Account",
      screenshotUrl: "/api/solari/runs/run_123/screenshot",
    })
    expect(JSON.stringify(run)).not.toContain("test-secret-key")
  })

  it("keeps a successful browser run successful when replay processing lags", async () => {
    const harness = createHarness({ replayUnavailable: true })
    const run = await runSolariSmoke(config, harness.dependencies)

    expect(run).toMatchObject({
      status: "SUCCEEDED",
      recordingStatus: "UNAVAILABLE",
      replayUrl: null,
    })
    expect(harness.getReplayUrl).toHaveBeenCalledTimes(2)
  })
})

describe("replay and SQLite persistence", () => {
  let database: DatabaseSync | undefined

  afterEach(() => database?.close())

  it("bounds replay polling and reports an unavailable replay", async () => {
    const fetchReplay = vi.fn(async () => {
      throw { status: 404 }
    })
    const sleep = vi.fn(async () => undefined)

    await expect(
      pollForReplay(fetchReplay, { attempts: 3, delayMs: 1, sleep }),
    ).resolves.toEqual({ status: "UNAVAILABLE", url: null })
    expect(fetchReplay).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it("persists and reads the run metadata through SQLite", () => {
    database = createDatabase(":memory:")
    const repository = createSolariRunRepository(database)
    const harness = createHarness()
    const initial = harness.repository.run
    expect(initial).toBeNull()

    repository.create({
      id: "sqlite_run",
      createdAt: "2026-09-02T12:00:00.000Z",
      completedAt: null,
      status: "RUNNING",
      sessionId: "session_sqlite",
      profileId: "profile_sqlite",
      profileCreated: false,
      targetUrl: config.targetUrl,
      pageTitle: null,
      observedText: null,
      screenshotPath: null,
      recordingStatus: "PENDING",
      replayUrl: null,
      durationMs: null,
      browserReleased: false,
      clientClosed: false,
      profileStateSaved: false,
      errorCode: null,
      errorMessage: null,
    })
    repository.update("sqlite_run", {
      status: "SUCCEEDED",
      browserReleased: true,
    })

    expect(repository.getLatest()).toMatchObject({
      id: "sqlite_run",
      sessionId: "session_sqlite",
      status: "SUCCEEDED",
      browserReleased: true,
    })
  })
})
