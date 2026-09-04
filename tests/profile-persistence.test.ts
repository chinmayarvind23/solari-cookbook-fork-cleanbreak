import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as db from "@/lib/db"
import { createAgentRepository } from "@/lib/agent/repository"
import {
  runCancellationAgent,
  type CancellationRuntimeTarget,
} from "@/lib/agent/runtime"
import type { AgentPageLike } from "@/lib/agent/observer"
import type { PageObservation } from "@/lib/agent/types"
import { readSolariConfig } from "@/lib/solari/config"
import { providerPageBlocker } from "@/lib/solari/profile-persistence"

const providerUrl = "https://provider.example/settings/billing"
const providerOrigin = "https://provider.example"

describe("profile persistence trust boundary (offline)", () => {
  let database: DatabaseSync
  let artifactDirectory: string
  let page: AgentPageLike
  let observation: { url: string; title: string; text: string }
  let target: CancellationRuntimeTarget
  let stop: boolean
  const state = {
    cookies: [
      {
        name: "synthetic",
        value: "private-state-sentinel",
        domain: "provider.example",
      },
    ],
    origins: [],
    toJSON: () => {
      throw new Error("State must not be serialized locally")
    },
  }
  const save = vi.fn(async (_id: string, _state: unknown) => ({}))
  const storageState = vi.fn(async () => state)
  const closeBrowser = vi.fn(async () => undefined)
  const closeClient = vi.fn(async () => undefined)
  const launch = vi.fn()
  const confirmSave = vi.fn(async () => true)
  const verifyAuthenticatedPage = vi.fn(() => true)
  let output: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("OPENAI_API_KEY", "offline-test-key")
    vi.stubEnv("SOLARI_API_KEY", "offline-test-key")
    vi.stubEnv("SOLARI_PROFILE_NAME", "test-provider-profile")
    vi.stubEnv("SOLARI_PROFILE_ID", "")
    vi.stubEnv("SOLARI_PERSIST_PROFILE_STATE", "true")
    vi.stubEnv("CLEANBREAK_PUBLIC_BASE_URL", providerOrigin)
    database = db.createDatabase(":memory:")
    artifactDirectory = mkdtempSync(
      join(tmpdir(), "cleanbreak-profile-policy-"),
    )
    output = vi.spyOn(console, "log").mockImplementation(() => undefined)
    observation = {
      url: providerUrl,
      title: "Account billing",
      text: "Paid membership active. No fee.",
    }
    stop = false
    target = {
      scenario: "real-provider-dry-run",
      targetUrl: providerUrl,
      subscription: {
        ...db.listSubscriptions(database)[0],
        url: providerUrl,
        domain: "provider.example",
      },
      planName: "Test plan",
      autoRenew: true,
      profileStateRefresh: {
        allowedPageUrls: [providerUrl],
        verifyAuthenticatedPage,
        confirmSave,
      },
    }
    page = {
      url: () => observation.url,
      title: async () => observation.title,
      evaluate: async <T>() =>
        ({
          headings: [observation.title],
          visibleText: observation.text,
          actions: [
            {
              domIndex: 0,
              role: "button",
              name: "Confirm cancellation",
              kind: "submit",
              href: null,
              checked: null,
              value: "",
            },
          ],
        }) as T,
      locator: () => ({
        nth: () => ({ click: vi.fn(), fill: vi.fn(), selectOption: vi.fn() }),
      }),
      goto: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      context: () => ({ storageState }),
    }
    launch.mockImplementation(async () => ({
      id: "offline-session",
      newPage: async () => page,
      close: closeBrowser,
    }))
  })

  afterEach(() => {
    database.close()
    // Screenshot mock never writes. This also fails if the runtime wrote state.
    rmdirSync(artifactDirectory)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  async function run(fixture = false) {
    if (fixture) {
      vi.spyOn(db, "getDemoState").mockReturnValue(db.getDemoState(database))
      vi.spyOn(db, "getStreamMaxSubscription").mockReturnValue(
        db.listSubscriptions(database)[0],
      )
    }
    return runCancellationAgent(
      {
        repository: createAgentRepository(database),
        artifactDirectory,
        id: () => "offline-profile-job",
        replayAttempts: 1,
        replayDelayMs: 0,
        createClient: () => ({
          profiles: {
            list: async () => [
              { id: "profile-test", name: "test-provider-profile" },
            ],
            create: vi.fn(),
            save,
          },
          sessions: {
            getReplayUrl: async () => ({
              url: "https://replay.example/offline",
            }),
          },
          launch,
          close: closeClient,
        }),
        createPlanner: () => async (observed) => ({
          decision: {
            type: stop ? "needs_human" : "final_cancel_candidate",
            observationId: observed.id,
            targetId: stop ? null : "el_1",
            confidence: 0.99,
            reasoning: "Offline test",
            reason: stop ? "Human intervention required" : null,
            value: null,
            url: null,
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      },
      fixture ? undefined : target,
    )
  }

  async function expectSkipped(reason: string) {
    const result = await run()
    expect(save).not.toHaveBeenCalled()
    expect(storageState).not.toHaveBeenCalled()
    expect(result.profileStateSaved).toBe(false)
    expect(result.profileStateSaveSkippedReason).toBe(reason)
    expect(
      createAgentRepository(database).getJob(result.id)
        ?.profileStateSaveSkippedReason,
    ).toBe(reason)
    expect(closeBrowser).toHaveBeenCalledOnce()
    expect(closeClient).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      browserReleased: true,
      clientClosed: true,
      destructiveClicksExecuted: 0,
      unsafeActionsExecuted: 0,
    })
    expect(output).not.toHaveBeenCalled()
  }

  it.each([
    "Just a moment...",
    "Cloudflare",
    "CAPTCHA challenge",
    "Access denied",
    "Bot protection",
    "Verify you are human",
    "We'll have you designing again soon",
  ])("never saves an anti-bot interstitial: %s", async (title) => {
    observation.title = title
    stop = true
    await expectSkipped("ANTI_BOT_CHALLENGE")
    expect(confirmSave).not.toHaveBeenCalled()
    expect(verifyAuthenticatedPage).not.toHaveBeenCalled()
  })

  it("blocks challenge persistence even if the model incorrectly declares success", async () => {
    observation.title = "Just a moment..."
    await expectSkipped("ANTI_BOT_CHALLENGE")
  })

  it.each([
    "Log in",
    "Sign in",
    "Enter your password",
    "MFA verification code",
  ])("never saves login pages: %s", async (title) => {
    observation.title = title
    stop = true
    await expectSkipped("LOGIN_REQUIRED")
  })

  it("skips state after initial navigation fails", async () => {
    vi.mocked(page.goto).mockRejectedValue(
      new Error("private navigation error"),
    )
    await expectSkipped("PROVIDER_NOT_REACHED")
  })

  it("skips an unrelated origin even with positive adapter output", async () => {
    observation.url = "https://unrelated.example/settings/billing"
    await expectSkipped("PROVIDER_NOT_REACHED")
  })

  it("still attaches the profile but the dry-run CLI cannot opt in through env alone", async () => {
    delete target.profileStateRefresh
    await expectSkipped("PERSISTENCE_DISABLED")
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "profile-test" }),
    )
    expect(confirmSave).not.toHaveBeenCalled()
  })

  it.each([undefined, "", "false"])(
    "defaults external persistence off (%s), even with a refresh flow",
    async (value) => {
      vi.stubEnv("SOLARI_PERSIST_PROFILE_STATE", value)
      await expectSkipped("PERSISTENCE_DISABLED")
    },
  )

  it("does not equate a provider page or approval boundary with authentication", async () => {
    verifyAuthenticatedPage.mockReturnValue(false)
    await expectSkipped("AUTHENTICATION_NOT_ESTABLISHED")
  })

  it("fails closed when the trusted authentication check throws", async () => {
    verifyAuthenticatedPage.mockImplementation(() => {
      throw new Error("private verifier error")
    })
    await expectSkipped("AUTHENTICATION_NOT_ESTABLISHED")
  })

  it("requires an exact allowed authenticated URL, not merely the same origin", async () => {
    observation.url = "https://provider.example/public"
    await expectSkipped("AUTHENTICATION_NOT_ESTABLISHED")
  })

  it("skips any failed run including needs_human on an otherwise plausible page", async () => {
    stop = true
    await expectSkipped("RUN_NOT_SUCCESSFUL")
  })

  it("requires fresh explicit save confirmation", async () => {
    confirmSave.mockResolvedValue(false)
    await expectSkipped("SAVE_NOT_CONFIRMED")
  })

  it("rechecks after confirmation and blocks a newly arrived challenge", async () => {
    confirmSave.mockImplementation(async () => {
      observation.title = "Just a moment..."
      return true
    })
    await expectSkipped("ANTI_BOT_CHALLENGE")
  })

  it("rechecks after state capture and blocks login expiry", async () => {
    storageState.mockImplementation(async () => {
      observation.title = "Sign in"
      return state
    })
    const result = await run()
    expect(save).not.toHaveBeenCalled()
    expect(result.profileStateSaveSkippedReason).toBe("LOGIN_REQUIRED")
    expect(closeBrowser).toHaveBeenCalledOnce()
    expect(closeClient).toHaveBeenCalledOnce()
  })

  it("rejects an empty state despite positive authentication evidence", async () => {
    storageState.mockResolvedValue({ ...state, cookies: [], origins: [] })
    const result = await run()
    expect(save).not.toHaveBeenCalled()
    expect(result.profileStateSaveSkippedReason).toBe("STATE_EMPTY")
  })

  it("may save authenticated allowed state only through an enabled confirmed refresh flow", async () => {
    const result = await run()
    expect(result.state).toBe("AWAITING_APPROVAL")
    expect(confirmSave).toHaveBeenCalledOnce()
    expect(verifyAuthenticatedPage).toHaveBeenCalledTimes(3)
    expect(save).toHaveBeenCalledExactlyOnceWith("profile-test", state)
    expect(save.mock.calls[0][1]).toBe(state)
    expect(storageState).toHaveBeenCalledExactlyOnceWith()
    expect(result.profileStateSaved).toBe(true)
    expect(result.profileStateSaveSkippedReason).toBeNull()
    expect(closeBrowser).toHaveBeenCalledOnce()
    expect(closeClient).toHaveBeenCalledOnce()
    expect(output).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("private-state-sentinel")
  })

  it("still closes both resources on save failure without exposing raw errors", async () => {
    save.mockRejectedValue(new Error("private-state-sentinel"))
    const result = await run()
    expect(result.profileStateSaved).toBe(false)
    expect(result.profileStateSaveSkippedReason).toBe("PROFILE_SAVE_FAILED")
    expect(closeBrowser).toHaveBeenCalledOnce()
    expect(closeClient).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain("private-state-sentinel")
  })

  it("closes the client even if browser cleanup fails while saving is skipped", async () => {
    delete target.profileStateRefresh
    closeBrowser.mockRejectedValue(new Error("private cleanup error"))
    const result = await run()
    expect(save).not.toHaveBeenCalled()
    expect(closeClient).toHaveBeenCalledOnce()
    expect(result.profileStateSaveSkippedReason).toBe("PERSISTENCE_DISABLED")
  })

  it("preserves successful live-fixture persistence without a refresh flow", async () => {
    vi.stubEnv("SOLARI_PERSIST_PROFILE_STATE", undefined)
    const result = await run(true)
    expect(result.state).toBe("AWAITING_APPROVAL")
    expect(save).toHaveBeenCalledExactlyOnceWith("profile-test", state)
    expect(result.profileStateSaved).toBe(true)
    expect(result.profileStateSaveSkippedReason).toBeNull()
    expect(confirmSave).not.toHaveBeenCalled()
  })

  it("preserves the fixture's explicit disable setting", async () => {
    vi.stubEnv("SOLARI_PERSIST_PROFILE_STATE", "false")
    const result = await run(true)
    expect(save).not.toHaveBeenCalled()
    expect(result.profileStateSaveSkippedReason).toBe("PERSISTENCE_DISABLED")
  })

  it("has different safe defaults for attachment targets and fixtures", () => {
    const env = {
      SOLARI_API_KEY: "offline-key",
      CLEANBREAK_PUBLIC_BASE_URL: providerOrigin,
    }
    expect(readSolariConfig(env, providerUrl).persistProfileState).toBe(false)
    expect(readSolariConfig(env).persistProfileState).toBe(true)
  })

  it("fails closed on missing or malformed page observations", () => {
    expect(providerPageBlocker(null, providerOrigin)).toBe(
      "PROVIDER_NOT_REACHED",
    )
    expect(
      providerPageBlocker(
        { url: "invalid" } as PageObservation,
        providerOrigin,
      ),
    ).toBe("PROVIDER_NOT_REACHED")
  })

  it("migrates existing v4 jobs without losing history and can reopen v5", async () => {
    await run()
    // Build an isolated v4 database with a historical job, never the user's DB.
    database.exec(
      "ALTER TABLE cancellation_jobs DROP COLUMN profile_state_save_skipped_reason; PRAGMA user_version = 4;",
    )
    const migrationPath = join(artifactDirectory, "migration.db")
    database.prepare("VACUUM INTO ?").run(migrationPath)
    let migrated = db.createDatabase(migrationPath)
    try {
      expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(
        5,
      )
      const job = createAgentRepository(migrated).getJob("offline-profile-job")
      expect(job?.profileStateSaved).toBe(true)
      expect(job?.profileStateSaveSkippedReason).toBeNull()
    } finally {
      migrated.close()
    }
    migrated = db.createDatabase(migrationPath)
    try {
      expect(
        createAgentRepository(migrated).getJob("offline-profile-job")?.state,
      ).toBe("AWAITING_APPROVAL")
    } finally {
      migrated.close()
      unlinkSync(migrationPath)
    }
  })
})
