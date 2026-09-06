// Reserve the final Browser action before dispatch and recover uncertain outcomes safely.
import "server-only"

import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { Solari } from "@solarisdk/browser"

import { materiallyMatches } from "@/lib/agent/approval"
import { isCleanBreakDryRun } from "@/lib/agent/config"
import { observePage, type AgentPageLike } from "@/lib/agent/observer"
import { classifyTarget, proposedActionFrom } from "@/lib/agent/policy"
import {
  createAgentRepository,
  toPublicAgentJob,
  type AgentRepository,
} from "@/lib/agent/repository"
import type { PublicAgentJob } from "@/lib/agent/types"
import { getStreamMaxSubscription } from "@/lib/db"
import { readSolariConfig } from "@/lib/solari/config"
import type { ProfilesClient } from "@/lib/solari/profile"
import { pollForReplay } from "@/lib/solari/recording"
import type { Subscription } from "@/lib/subscriptions"

type CommitBrowser = {
  id: string
  newPage(): Promise<AgentPageLike>
  close(): Promise<void>
}

type CommitSolariClient = {
  profiles: ProfilesClient
  sessions: { getReplayUrl(id: string): Promise<{ url: string }> }
  launch(options: {
    profileId: string
    recording: true
    stealth: boolean
  }): Promise<CommitBrowser>
  close(): Promise<void>
}

export class CommitApprovalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "CommitApprovalError"
  }
}

export class InjectedCommitCrash extends Error {
  constructor(readonly point: string) {
    super(`Injected crash at ${point}`)
    this.name = "InjectedCommitCrash"
  }
}

export type CommitFaultHooks = Partial<
  Record<
    "beforeArm" | "afterArm" | "afterClickDispatch" | "afterClickReturned",
    () => void | Promise<void>
  >
>

export type CommitDependencies = {
  repository: AgentRepository
  createClient(apiKey: string): CommitSolariClient
  artifactDirectory: string
  now(): Date
  id(): string
  replayAttempts: number
  replayDelayMs: number
  hooks: CommitFaultHooks
  getSubscription(): Subscription
  dryRun: boolean
}

function defaultClient(apiKey: string): CommitSolariClient {
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
      (await solari.launch(options)) as unknown as CommitBrowser,
    close: () => solari.close(),
  }
}

function publicJob(repository: AgentRepository, jobId: string): PublicAgentJob {
  const job = repository.getJob(jobId)
  if (!job) throw new CommitApprovalError("JOB_NOT_FOUND", "Job not found.")
  return toPublicAgentJob(job, repository)
}

function validateStoredProposal(repository: AgentRepository, jobId: string) {
  const job = repository.getJob(jobId)
  const proposed = repository.getProposedAction(jobId)
  if (!job || !proposed) {
    throw new CommitApprovalError(
      "PROPOSED_ACTION_NOT_FOUND",
      "No authoritative proposed action exists for this job.",
    )
  }
  if (
    classifyTarget({
      id: "stored",
      role: proposed.targetRole,
      name: proposed.targetName,
      kind: "button",
      href: null,
      checked: null,
      value: null,
    }) !== "FINAL_CANCELLATION"
  ) {
    throw new CommitApprovalError(
      "POLICY_NO_LONGER_ELIGIBLE",
      "The proposed action is not an eligible final cancellation target.",
    )
  }
  return { job, proposed }
}

export async function approveCancellation(
  jobId: string,
  fingerprint: string,
  dependencies: Partial<CommitDependencies> = {},
): Promise<PublicAgentJob> {
  const repository = dependencies.repository ?? createAgentRepository()
  const now = dependencies.now ?? (() => new Date())
  const id = dependencies.id ?? (() => crypto.randomUUID())
  const hooks = dependencies.hooks ?? {}
  const { job, proposed } = validateStoredProposal(repository, jobId)
  const dryRun = dependencies.dryRun ?? isCleanBreakDryRun(process.env)
  if (dryRun) {
    if (job.state !== "AWAITING_APPROVAL") {
      throw new CommitApprovalError(
        "APPROVAL_NOT_ALLOWED",
        "Only a job awaiting approval can receive an approval intent.",
      )
    }
    if (fingerprint !== proposed.fingerprint) {
      throw new CommitApprovalError(
        "STALE_APPROVAL",
        "The approval does not match the current proposed action.",
      )
    }
    repository.updateJob(jobId, {
      errorCode: "DRY_RUN_ACTIVE",
      errorMessage:
        "Server-enforced dry-run mode accepted no commit: the final cancellation control was not clicked.",
    })
    return publicJob(repository, jobId)
  }
  const approvedAt = now().toISOString()
  const authorization = repository.authorizeApproval({
    jobId,
    fingerprint,
    approvalId: id(),
    approvedAt,
  })
  if (authorization.result === "DUPLICATE") return publicJob(repository, jobId)
  if ("code" in authorization) {
    throw new CommitApprovalError(
      authorization.code,
      "The server rejected this approval safely.",
    )
  }
  const approval = authorization.approval
  if (!job.profileId) {
    throw new CommitApprovalError(
      "PROFILE_NOT_FOUND",
      "The navigation session did not persist a reusable browser profile.",
    )
  }

  const config = readSolariConfig(process.env)
  const createClient = dependencies.createClient ?? defaultClient
  const artifactDirectory =
    dependencies.artifactDirectory ??
    resolve(process.cwd(), "artifacts", "agent", jobId, "commit")
  mkdirSync(artifactDirectory, { recursive: true })

  let client: CommitSolariClient | null = null
  let browser: CommitBrowser | null = null
  let armed = false
  let clickStarted = false
  let clickReturned = false
  let terminalTransition = false
  let browserReleased = false
  let clientClosed = false
  let profileStateSaved = false
  let pendingClick: Promise<unknown> | null = null

  try {
    client = createClient(config.apiKey)
    browser = await client.launch({
      profileId: job.profileId,
      recording: true,
      stealth: config.stealth,
    })
    const page = await browser.newPage()
    await page.goto(proposed.currentUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    })
    const observed = await observePage(page)

    if (
      /membership already canceled|subscription is canceled/i.test(
        observed.observation.visibleText,
      )
    ) {
      repository.recordNoExecution({
        jobId,
        approval,
        attemptId: id(),
        at: now().toISOString(),
        sessionId: browser.id,
        reason:
          "The service was already canceled when the fresh execution session reobserved it.",
      })
      return publicJob(repository, jobId)
    }

    const finalTargets = observed.observation.actions.filter(
      (action) => classifyTarget(action) === "FINAL_CANCELLATION",
    )
    if (finalTargets.length !== 1) {
      throw new CommitApprovalError(
        "FINAL_TARGET_NOT_UNIQUE",
        "The fresh page did not expose exactly one eligible final cancellation action.",
      )
    }
    const currentTarget = finalTargets[0]
    const reobservedScreenshot = resolve(
      artifactDirectory,
      "reobserved-terms.png",
    )
    await page.screenshot({ path: reobservedScreenshot, fullPage: true })
    const reobservedScreenshotPath = `artifacts/agent/${jobId}/commit/reobserved-terms.png`
    const current = proposedActionFrom(
      observed.observation,
      currentTarget,
      reobservedScreenshotPath,
      {
        jobId,
        subscription:
          dependencies.getSubscription?.() ?? getStreamMaxSubscription(),
        planName: proposed.snapshot.planName,
      },
    )
    if (!materiallyMatches(proposed, current)) {
      repository.saveProposedAction(jobId, current)
      repository.markTermsChanged(jobId)
      return publicJob(repository, jobId)
    }

    await hooks.beforeArm?.()
    const attempt = repository.armCommit({
      jobId,
      approval,
      attemptId: id(),
      armedAt: now().toISOString(),
      sessionId: browser.id,
    })
    if (!attempt) return publicJob(repository, jobId)
    armed = true
    await hooks.afterArm?.()

    const preScreenshotPath = resolve(artifactDirectory, "pre-click.png")
    await page.screenshot({ path: preScreenshotPath, fullPage: true })
    repository.updateCommitAttempt(jobId, {
      preScreenshotPath: `artifacts/agent/${jobId}/commit/pre-click.png`,
    })

    const target = observed.targets.get(currentTarget.id)
    if (!target) {
      throw new CommitApprovalError(
        "FRESH_TARGET_LOST",
        "The freshly observed final target was no longer available.",
      )
    }
    repository.markClickStarted(jobId, now().toISOString())
    clickStarted = true
    const resultNavigation = page
      .waitForURL(
        new URL("/demo/streammax/result", proposed.currentUrl).toString(),
        {
          waitUntil: "domcontentloaded",
          timeout: config.navigationTimeoutMs,
        },
      )
      .then(() => true)
      .catch(() => false)
    pendingClick = Promise.resolve(target.click())
    pendingClick.catch(() => undefined)
    await hooks.afterClickDispatch?.()
    await pendingClick
    const returnedAt = now().toISOString()
    repository.updateCommitAttempt(jobId, {
      clickReturnedAt: returnedAt,
      outcome: "CLICK_RETURNED",
    })
    clickReturned = true
    await hooks.afterClickReturned?.()
    await resultNavigation

    const postScreenshotPath = resolve(artifactDirectory, "post-click.png")
    await page.screenshot({ path: postScreenshotPath, fullPage: true })
    repository.updateCommitAttempt(jobId, {
      postScreenshotPath: `artifacts/agent/${jobId}/commit/post-click.png`,
    })
    repository.finishCommit({
      jobId,
      at: now().toISOString(),
      outcome: "CLICK_RETURNED",
    })
    terminalTransition = true

    // Approval to cancel is not approval to replace external credentials.
    // This fixture commit path has no authenticated-provider refresh flow.
    if (
      config.persistProfileState &&
      job.scenario !== "real-provider-dry-run"
    ) {
      try {
        await client.profiles.save(
          job.profileId,
          await page.context().storageState(),
        )
        profileStateSaved = true
      } catch {}
    }
  } catch (error) {
    if (error instanceof InjectedCommitCrash) throw error
    if (armed && !terminalTransition) {
      repository.finishCommit({
        jobId,
        at: now().toISOString(),
        outcome: clickReturned ? "CLICK_RETURNED" : "OUTCOME_UNKNOWN",
        errorCode: clickReturned
          ? "POST_CLICK_PROCESSING_FAILED"
          : clickStarted
            ? "FINAL_ACTION_OUTCOME_UNKNOWN"
            : "COMMIT_PRECLICK_FAILED",
        errorMessage: clickReturned
          ? "The final click returned, but later evidence processing failed. Independent verification is required."
          : clickStarted
            ? "The final click may have run. CleanBreak will not retry it automatically."
            : "The armed commit did not reach a confirmed click outcome. CleanBreak will not retry it.",
      })
    } else {
      repository.updateJob(jobId, {
        errorCode:
          error instanceof CommitApprovalError
            ? error.code
            : "COMMIT_REVALIDATION_FAILED",
        errorMessage:
          error instanceof CommitApprovalError
            ? error.message
            : "The fresh execution session failed before commit arming.",
      })
    }
  } finally {
    if (browser) {
      try {
        await browser.close()
        browserReleased = true
      } catch {}
      if (armed && client) {
        const replay = await pollForReplay(
          () => client!.sessions.getReplayUrl(browser!.id),
          {
            attempts: dependencies.replayAttempts,
            delayMs: dependencies.replayDelayMs,
          },
        )
        repository.updateCommitAttempt(jobId, {
          recordingStatus: replay.status,
          replayUrl: replay.url,
        })
      }
    }
    if (client) {
      try {
        await client.close()
        clientClosed = true
      } catch {}
    }
    if (armed) {
      repository.updateCommitAttempt(jobId, {
        browserReleased,
        clientClosed,
        profileStateSaved,
      })
    }
  }

  return publicJob(repository, jobId)
}

export function abortCancellation(
  jobId: string,
  fingerprint: string,
): PublicAgentJob {
  const repository = createAgentRepository()
  if (!repository.abortJob(jobId, fingerprint, new Date().toISOString())) {
    throw new CommitApprovalError(
      "ABORT_NOT_ALLOWED",
      "Only a job awaiting approval can be aborted.",
    )
  }
  return publicJob(repository, jobId)
}

export function recoverArmedCommit(
  jobId: string,
  repository: AgentRepository = createAgentRepository(),
  now: () => Date = () => new Date(),
): PublicAgentJob {
  repository.recoverArmedCommit(jobId, now().toISOString())
  return publicJob(repository, jobId)
}
