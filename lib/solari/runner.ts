// Run the Browser connection smoke check with controlled cleanup.
import type { SolariConfig } from "@/lib/solari/config"
import {
  type ProfilesClient,
  resolveReusableProfile,
} from "@/lib/solari/profile"
import { pollForReplay } from "@/lib/solari/recording"
import type {
  PublicSolariRun,
  SolariRun,
  SolariRunRepository,
} from "@/lib/solari/types"
import { toPublicSolariRun } from "@/lib/solari/types"

export interface BrowserPageLike {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown>
  getByRole(
    role: "heading",
    options: { name: string },
  ): { waitFor(options: { timeout: number }): Promise<void> }
  title(): Promise<string>
  locator(selector: "body"): { innerText(): Promise<string> }
  screenshot(options: { path: string; fullPage: true }): Promise<unknown>
  context(): { storageState(): Promise<unknown> }
}

export interface BrowserSessionLike {
  id: string
  newPage(): Promise<BrowserPageLike>
  close(): Promise<void>
}

export interface SolariClientLike {
  profiles: ProfilesClient
  sessions: { getReplayUrl(id: string): Promise<{ url: string }> }
  launch(options: {
    profileId: string
    recording: true
    stealth: boolean
  }): Promise<BrowserSessionLike>
  close(): Promise<void>
}

type RunDependencies = {
  repository: SolariRunRepository
  createClient(apiKey: string): SolariClientLike
  prepareScreenshot(runId: string): {
    absolutePath: string
    relativePath: string
  }
  id?: () => string
  now?: () => Date
  replayAttempts?: number
  replayDelayMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

function safeError(
  error: unknown,
  stage: string,
): {
  code: string
  message: string
} {
  if (stage === "navigation-load") {
    return {
      code: "TARGET_UNREACHABLE",
      message:
        "The remote browser could not reach the public CleanBreak target.",
    }
  }
  if (stage === "navigation-ready") {
    return {
      code: "NAVIGATION_TIMEOUT",
      message: "The StreamMax account page did not become usable in time.",
    }
  }
  if (stage === "screenshot") {
    return {
      code: "SCREENSHOT_FAILED",
      message: "The browser reached the target but could not capture evidence.",
    }
  }
  if (stage === "profile") {
    return {
      code: "SOLARI_PROFILE_ERROR",
      message:
        error instanceof Error && error.message.includes("configured")
          ? error.message
          : "The reusable Solari profile could not be resolved.",
    }
  }
  if (stage === "cleanup") {
    return {
      code: "SOLARI_CLEANUP_ERROR",
      message: "The Solari browser resources could not be fully released.",
    }
  }
  return {
    code: "SOLARI_SESSION_ERROR",
    message: "The recorded Solari browser session could not be completed.",
  }
}

export async function runSolariSmoke(
  config: SolariConfig,
  dependencies: RunDependencies,
): Promise<PublicSolariRun> {
  const now = dependencies.now ?? (() => new Date())
  const started = now()
  const id = dependencies.id?.() ?? crypto.randomUUID()
  const initial: SolariRun = {
    id,
    createdAt: started.toISOString(),
    completedAt: null,
    status: "RUNNING",
    sessionId: null,
    profileId: null,
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
  }
  dependencies.repository.create(initial)

  let client: SolariClientLike | null = null
  let browser: BrowserSessionLike | null = null
  let stage = "client"
  let failure: { code: string; message: string } | null = null
  let browserReleased = false
  let clientClosed = false
  const persist = (patch: Parameters<SolariRunRepository["update"]>[1]) => {
    try {
      dependencies.repository.update(id, patch)
    } catch {
      failure ??= {
        code: "RUN_METADATA_ERROR",
        message: "The Solari run metadata could not be fully persisted.",
      }
    }
  }

  try {
    client = dependencies.createClient(config.apiKey)
    stage = "profile"
    const profile = await resolveReusableProfile(client.profiles, {
      configuredId: config.profileId,
      name: config.profileName,
    })
    persist({
      profileId: profile.id,
      profileCreated: profile.created,
    })

    stage = "launch"
    browser = await client.launch({
      profileId: profile.id,
      recording: true,
      stealth: config.stealth,
    })
    persist({ sessionId: browser.id })

    stage = "navigation-load"
    const page = await browser.newPage()
    await page.goto(config.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    })
    stage = "navigation-ready"
    await page
      .getByRole("heading", { name: "Welcome back, Casey" })
      .waitFor({ timeout: config.navigationTimeoutMs })
    const [pageTitle, bodyText] = await Promise.all([
      page.title(),
      page.locator("body").innerText(),
    ])
    persist({
      pageTitle: pageTitle.slice(0, 300),
      observedText: bodyText.replace(/\s+/g, " ").trim().slice(0, 500),
    })

    stage = "screenshot"
    const screenshot = dependencies.prepareScreenshot(id)
    await page.screenshot({ path: screenshot.absolutePath, fullPage: true })
    persist({
      screenshotPath: screenshot.relativePath,
    })

    if (config.persistProfileState) {
      stage = "profile-save"
      await client.profiles.save(
        profile.id,
        await page.context().storageState(),
      )
      persist({ profileStateSaved: true })
    }
  } catch (error) {
    failure = safeError(error, stage)
  } finally {
    if (browser) {
      try {
        await browser.close()
        browserReleased = true
      } catch (error) {
        failure ??= safeError(error, "cleanup")
      }
      persist({ browserReleased })

      if (browserReleased && client) {
        const replayClient = client
        const sessionId = browser.id
        const replay = await pollForReplay(
          () => replayClient.sessions.getReplayUrl(sessionId),
          {
            attempts: dependencies.replayAttempts,
            delayMs: dependencies.replayDelayMs,
            sleep: dependencies.sleep,
          },
        )
        persist({
          recordingStatus: replay.status,
          replayUrl: replay.url,
        })
      }
    } else {
      persist({ recordingStatus: "UNAVAILABLE" })
    }

    if (client) {
      try {
        await client.close()
        clientClosed = true
      } catch (error) {
        failure ??= safeError(error, "cleanup")
      }
    }

    const completed = now()
    persist({
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      status: failure ? "FAILED" : "SUCCEEDED",
      clientClosed,
      errorCode: failure?.code ?? null,
      errorMessage: failure?.message ?? null,
    })
  }

  const completedRun = dependencies.repository.getById(id)
  if (!completedRun) throw new Error("The Solari run record could not be read.")
  return toPublicSolariRun(completedRun)
}
