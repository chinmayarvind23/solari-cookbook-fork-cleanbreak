import "server-only"

import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { Solari } from "@solarisdk/browser"

import {
  createAgentRepository,
  toPublicAgentJob,
  type AgentRepository,
} from "@/lib/agent/repository"
import type {
  PublicAgentJob,
  VerificationEvidence,
  VerificationResult,
} from "@/lib/agent/types"
import { readSolariConfig } from "@/lib/solari/config"
import type { ProfilesClient } from "@/lib/solari/profile"
import { pollForReplay } from "@/lib/solari/recording"
import { createReceiptForVerifiedJob } from "@/lib/receipts/builder"
import {
  assertReadOnlyVerificationAction,
  verifyObservation,
  type ReadOnlyObservation,
} from "@/lib/verification/policy"

export interface VerificationPageLike {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown>
  url(): string
  title(): Promise<string>
  evaluate<T>(script: string): Promise<T>
  screenshot(options: { path: string; fullPage: true }): Promise<unknown>
}

type VerificationBrowser = {
  id: string
  newPage(): Promise<VerificationPageLike>
  close(): Promise<void>
}

type VerificationClient = {
  profiles: ProfilesClient
  sessions: { getReplayUrl(id: string): Promise<{ url: string }> }
  launch(options: {
    profileId: string
    recording: true
    stealth: boolean
  }): Promise<VerificationBrowser>
  close(): Promise<void>
}

export type VerificationDependencies = {
  repository: AgentRepository
  createClient(apiKey: string): VerificationClient
  artifactDirectory: string
  now(): Date
  id(): string
  replayAttempts: number
  replayDelayMs: number
  navigationAttempts: number
  createReceipt(jobId: string): unknown | Promise<unknown>
}

function defaultClient(apiKey: string): VerificationClient {
  const solari = new Solari({ apiKey })
  return {
    profiles: {
      list: () => solari.profiles.list(),
      create: (options) => solari.profiles.create(options),
      save: (profileId, state) =>
        solari.profiles.save(
          profileId,
          state as Parameters<typeof solari.profiles.save>[1],
        ),
    },
    sessions: {
      getReplayUrl: (sessionId) => solari.sessions.getReplayUrl(sessionId),
    },
    launch: async (options) =>
      (await solari.launch(options)) as unknown as VerificationBrowser,
    close: () => solari.close(),
  }
}

function publicJob(repository: AgentRepository, jobId: string): PublicAgentJob {
  const job = repository.getJob(jobId)
  if (!job) throw new Error("Verification job not found.")
  return toPublicAgentJob(job, repository)
}

async function observe(
  page: VerificationPageLike,
): Promise<ReadOnlyObservation> {
  assertReadOnlyVerificationAction("observe")
  const content = await page.evaluate<
    Pick<ReadOnlyObservation, "visibleText" | "fields">
  >(`(() => ({
    visibleText: (document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 12000),
    fields: Array.from(document.querySelectorAll(".settings-row")).map((row) => {
      const left = row.firstElementChild;
      return {
        label: (left?.querySelector("span")?.textContent || "").trim(),
        detail: (left?.querySelector("small")?.textContent || "").trim(),
        value: (row.lastElementChild?.textContent || "").trim()
      };
    })
  }))()`)
  return {
    ...content,
    url: page.url(),
    title: await page.title(),
  }
}

export async function runIndependentVerification(
  jobId: string,
  dependencies: Partial<VerificationDependencies> = {},
): Promise<PublicAgentJob> {
  const repository = dependencies.repository ?? createAgentRepository()
  const existing = repository.getVerification(jobId)
  if (existing) return publicJob(repository, jobId)
  const job = repository.getJob(jobId)
  if (!job) throw new Error("Verification job not found.")
  if (job.state !== "VERIFYING") return publicJob(repository, jobId)
  const attempt = repository.getCommitAttempt(jobId)
  if (!job.profileId || !attempt?.sessionId) {
    throw new Error(
      "Verification requires a persisted profile and execution session.",
    )
  }

  const config = readSolariConfig(process.env)
  const started = (dependencies.now ?? (() => new Date()))()
  if (!repository.beginVerification(jobId, started.toISOString())) {
    return publicJob(repository, jobId)
  }
  const now = dependencies.now ?? (() => new Date())
  const id = dependencies.id ?? (() => crypto.randomUUID())
  const targetUrl = new URL(
    "/demo/streammax/billing",
    config.publicBaseUrl,
  ).toString()
  const artifactDirectory =
    dependencies.artifactDirectory ??
    resolve(process.cwd(), "artifacts", "agent", jobId, "verification")
  mkdirSync(artifactDirectory, { recursive: true })

  let client: VerificationClient | null = null
  let browser: VerificationBrowser | null = null
  let sessionId = "not-created"
  let evidence: VerificationEvidence | null = null
  let browserReleased = false
  let clientClosed = false
  let recordingStatus: VerificationResult["recordingStatus"] = "UNAVAILABLE"
  let replayUrl: string | null = null
  let policy: ReturnType<typeof verifyObservation> | null = null
  let errorCode: string | null = null
  let errorMessage: string | null = null
  let freshSessionMismatch = false

  try {
    client = (dependencies.createClient ?? defaultClient)(config.apiKey)
    browser = await client.launch({
      profileId: job.profileId,
      recording: true,
      stealth: config.stealth,
    })
    sessionId = browser.id
    repository.markVerificationSessionCreated(jobId)
    if (sessionId === attempt.sessionId) {
      freshSessionMismatch = true
      throw new Error("VERIFICATION_SESSION_NOT_FRESH")
    }

    const page = await browser.newPage()
    assertReadOnlyVerificationAction("navigate")
    let navigationError: unknown
    for (
      let index = 0;
      index < (dependencies.navigationAttempts ?? 2);
      index += 1
    ) {
      try {
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: config.navigationTimeoutMs,
        })
        navigationError = undefined
        break
      } catch (error) {
        navigationError = error
      }
    }
    if (navigationError) throw navigationError

    const observation = await observe(page)
    policy = verifyObservation(observation)
    const screenshotAbsolute = resolve(artifactDirectory, "account.png")
    assertReadOnlyVerificationAction("screenshot")
    await page.screenshot({ path: screenshotAbsolute, fullPage: true })
    evidence = {
      id: id(),
      jobId,
      phase: "VERIFICATION",
      capturedAt: now().toISOString(),
      url: observation.url,
      title: observation.title,
      visibleExcerpt: observation.visibleText.slice(0, 1200),
      normalizedState: {
        status: policy.status,
        autoRenew: policy.autoRenew,
        nextChargeDate: policy.nextChargeDate,
        nextChargeAmountCents: policy.nextChargeAmountCents,
        accessUntil: policy.accessUntil,
      },
      sessionId,
      screenshotPath: `artifacts/agent/${jobId}/verification/account.png`,
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "VERIFICATION_SESSION_NOT_FRESH"
    ) {
      errorCode = "VERIFICATION_SESSION_NOT_FRESH"
      errorMessage = "The verifier rejected a reused execution session."
    } else {
      errorCode = "VERIFICATION_BROWSER_FAILED"
      errorMessage =
        "The fresh read-only verification session could not inspect billing truth."
    }
  } finally {
    if (browser) {
      try {
        await browser.close()
        browserReleased = true
      } catch {
        errorCode ??= "VERIFICATION_CLEANUP_ERROR"
        errorMessage ??= "The verification browser could not be fully released."
      }
      if (browserReleased && client) {
        const replay = await pollForReplay(
          () => client!.sessions.getReplayUrl(browser!.id),
          {
            attempts: dependencies.replayAttempts ?? 3,
            delayMs: dependencies.replayDelayMs ?? 400,
          },
        )
        recordingStatus = replay.status
        replayUrl = replay.url
      }
    }
    if (client) {
      try {
        await client.close()
        clientClosed = true
      } catch {
        errorCode ??= "VERIFICATION_CLEANUP_ERROR"
        errorMessage ??= "The verification client could not be fully closed."
      }
    }
  }

  const completed = now()
  const outcome = policy ?? {
    status: "UNKNOWN" as const,
    autoRenew: null,
    nextChargeDate: null,
    nextChargeAmountCents: null,
    accessUntil: null,
    statusResult: "INCONCLUSIVE" as const,
    satisfiedCriteria: [],
    failedCriteria: ["Fresh account billing truth was unavailable."],
    explanation: "CleanBreak could not prove that future billing stopped.",
    errorCode: errorCode ?? "VERIFICATION_INCONCLUSIVE",
  }
  const result: VerificationResult = {
    jobId,
    status: outcome.statusResult,
    subscriptionStatus: outcome.status,
    autoRenew: outcome.autoRenew,
    nextChargeDate: outcome.nextChargeDate,
    nextChargeAmountCents: outcome.nextChargeAmountCents,
    accessUntil: outcome.accessUntil,
    evidence: evidence ? [evidence] : [],
    satisfiedCriteria: outcome.satisfiedCriteria,
    failedCriteria: outcome.failedCriteria,
    explanation: outcome.explanation,
    verificationSessionId: sessionId,
    verifiedAt: completed.toISOString(),
    targetUrl,
    recordingStatus,
    replayUrl,
    browserReleased,
    clientClosed,
    errorCode: errorCode ?? outcome.errorCode,
    errorMessage,
  }
  repository.finishVerification({
    result,
    evidence,
    durationMs: Math.max(0, completed.getTime() - started.getTime()),
    freshSessionMismatch,
  })
  if (result.status === "VERIFIED") {
    const createReceipt =
      dependencies.createReceipt ??
      (dependencies.repository ? null : createReceiptForVerifiedJob)
    if (createReceipt) {
      try {
        await createReceipt(jobId)
      } catch {
        // Verification truth is durable; receipt generation is independently retryable.
      }
    }
  }
  return publicJob(repository, jobId)
}
