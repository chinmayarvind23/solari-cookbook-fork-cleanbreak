import "server-only"

import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { Solari } from "@solarisdk/browser"

import { agentReadiness, readAgentConfig } from "@/lib/agent/config"
import { runAgentLoop } from "@/lib/agent/loop"
import {
  executeDecision,
  observePage,
  type AgentPageLike,
} from "@/lib/agent/observer"
import { createOpenAIPlanner } from "@/lib/agent/planner"
import {
  createAgentRepository,
  toPublicAgentJob,
  type AgentRepository,
} from "@/lib/agent/repository"
import { assertJobTransition } from "@/lib/agent/state"
import type { CancellationJob, PublicAgentJob } from "@/lib/agent/types"
import { getDemoState, getStreamMaxSubscription } from "@/lib/db"
import { readSolariConfig, getSolariReadiness } from "@/lib/solari/config"
import {
  resolveReusableProfile,
  type ProfilesClient,
} from "@/lib/solari/profile"
import { pollForReplay } from "@/lib/solari/recording"

type AgentBrowser = {
  id: string
  newPage(): Promise<AgentPageLike>
  close(): Promise<void>
}

type AgentSolariClient = {
  profiles: ProfilesClient
  sessions: { getReplayUrl(id: string): Promise<{ url: string }> }
  launch(options: {
    profileId: string
    recording: true
    stealth: boolean
  }): Promise<AgentBrowser>
  close(): Promise<void>
}

type RuntimeDependencies = {
  repository: AgentRepository
  createClient(apiKey: string): AgentSolariClient
  createPlanner: typeof createOpenAIPlanner
  artifactDirectory: string
  now?: () => Date
  id?: () => string
  replayAttempts?: number
  replayDelayMs?: number
}

function initialJob(options: {
  id: string
  createdAt: string
  scenario: string
  model: string
  targetUrl: string
}): CancellationJob {
  return {
    id: options.id,
    subscriptionId: "sub_streammax",
    state: "READY",
    scenario: options.scenario,
    model: options.model,
    targetUrl: options.targetUrl,
    createdAt: options.createdAt,
    completedAt: null,
    sessionId: null,
    profileId: null,
    recordingStatus: "PENDING",
    replayUrl: null,
    latestScreenshotPath: null,
    steps: 0,
    retentionsEncountered: 0,
    retentionsRejected: 0,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    policyBlocks: 0,
    unsafeActionsExecuted: 0,
    durationMs: 0,
    browserReleased: false,
    clientClosed: false,
    profileStateSaved: false,
    errorCode: null,
    errorMessage: null,
    approvalsRequested: 0,
    approvalsGranted: 0,
    approvalsAborted: 0,
    approvalToCommitMs: null,
    commitAttempts: 0,
    duplicateCommitRequestsBlocked: 0,
    staleApprovalsBlocked: 0,
    changedTermsReapprovalRequired: 0,
    destructiveClicksExecuted: 0,
    automaticDestructiveRetries: 0,
    commitsWithUnknownOutcome: 0,
  }
}

export function agentRuntimeReadiness() {
  const agent = agentReadiness(process.env)
  const solari = getSolariReadiness(process.env)
  return {
    ready:
      agent.configured && solari.apiKeyConfigured && solari.publicTargetValid,
    model: agent.model,
    message: !agent.configured ? agent.message : solari.message,
    targetHost: solari.targetHost,
  }
}

export function latestAgentJob(): PublicAgentJob | null {
  const repository = createAgentRepository()
  const job = repository.getLatestJob()
  return job ? toPublicAgentJob(job, repository) : null
}

export async function runCancellationAgent(
  dependencies?: Partial<RuntimeDependencies>,
): Promise<PublicAgentJob> {
  const agentConfig = readAgentConfig(process.env)
  const solariConfig = readSolariConfig(process.env)
  const repository = dependencies?.repository ?? createAgentRepository()
  const now = dependencies?.now ?? (() => new Date())
  const id = dependencies?.id?.() ?? crypto.randomUUID()
  const startedAt = now()
  const fixture = getDemoState()
  const job = initialJob({
    id,
    createdAt: startedAt.toISOString(),
    scenario: fixture.scenario,
    model: agentConfig.model,
    targetUrl: solariConfig.targetUrl,
  })
  repository.createJob(job)
  assertJobTransition("READY", "NAVIGATING")
  repository.updateJob(id, { state: "NAVIGATING" })

  const createClient =
    dependencies?.createClient ??
    ((apiKey: string): AgentSolariClient => {
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
          (await solari.launch(options)) as unknown as AgentBrowser,
        close: () => solari.close(),
      }
    })
  const artifactDirectory =
    dependencies?.artifactDirectory ??
    resolve(process.cwd(), "artifacts", "agent", id)
  mkdirSync(artifactDirectory, { recursive: true })

  let client: AgentSolariClient | null = null
  let browser: AgentBrowser | null = null
  let browserReleased = false
  let clientClosed = false
  let profileSaved = false
  let result: Awaited<ReturnType<typeof runAgentLoop>> | null = null
  let runtimeFailure: { code: string; message: string } | null = null
  let latestScreenshotPath: string | null = null

  try {
    client = createClient(solariConfig.apiKey)
    const profile = await resolveReusableProfile(client.profiles, {
      configuredId: solariConfig.profileId,
      name: solariConfig.profileName,
    })
    repository.updateJob(id, { profileId: profile.id })

    browser = await client.launch({
      profileId: profile.id,
      recording: true,
      stealth: solariConfig.stealth,
    })
    repository.updateJob(id, { sessionId: browser.id })
    const page = await browser.newPage()
    await page.goto(solariConfig.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: solariConfig.navigationTimeoutMs,
    })
    const planner = (dependencies?.createPlanner ?? createOpenAIPlanner)(
      agentConfig,
    )

    result = await runAgentLoop({
      jobId: id,
      config: agentConfig,
      allowedOrigin: new URL(solariConfig.targetUrl).origin,
      repository,
      observe: () => observePage(page),
      plan: planner,
      execute: (observed, decision) =>
        executeDecision(
          page,
          observed,
          decision,
          solariConfig.navigationTimeoutMs,
        ),
      capture: async (step) => {
        const filename = `step-${String(step).padStart(2, "0")}.png`
        const absolutePath = resolve(artifactDirectory, filename)
        await page.screenshot({ path: absolutePath, fullPage: true })
        latestScreenshotPath = `artifacts/agent/${id}/${filename}`
        repository.updateJob(id, { latestScreenshotPath })
        return latestScreenshotPath
      },
      now,
      approvalContext: {
        jobId: id,
        subscription: getStreamMaxSubscription(),
        planName: "Premium",
      },
    })

    if (solariConfig.persistProfileState) {
      await client.profiles.save(
        profile.id,
        await page.context().storageState(),
      )
      profileSaved = true
    }
  } catch {
    runtimeFailure = {
      code: "AGENT_RUNTIME_FAILED",
      message: "The recorded browser dry run failed safely.",
    }
  } finally {
    if (browser) {
      try {
        await browser.close()
        browserReleased = true
      } catch {
        runtimeFailure ??= {
          code: "SOLARI_CLEANUP_ERROR",
          message: "The Solari browser could not be fully released.",
        }
      }
      repository.updateJob(id, { browserReleased })
      if (browserReleased && client) {
        const replay = await pollForReplay(
          () => client!.sessions.getReplayUrl(browser!.id),
          {
            attempts: dependencies?.replayAttempts,
            delayMs: dependencies?.replayDelayMs,
          },
        )
        repository.updateJob(id, {
          recordingStatus: replay.status,
          replayUrl: replay.url,
        })
      }
    } else {
      repository.updateJob(id, { recordingStatus: "UNAVAILABLE" })
    }
    if (client) {
      try {
        await client.close()
        clientClosed = true
      } catch {
        runtimeFailure ??= {
          code: "SOLARI_CLEANUP_ERROR",
          message: "The Solari client could not be fully closed.",
        }
      }
    }

    const completedAt = now()
    const finalState = runtimeFailure ? "FAILED" : (result?.state ?? "FAILED")
    assertJobTransition("NAVIGATING", finalState)
    repository.updateJob(id, {
      state: finalState,
      completedAt: completedAt.toISOString(),
      ...(result?.metrics ?? {}),
      durationMs:
        result?.metrics.durationMs ??
        Math.max(0, completedAt.getTime() - startedAt.getTime()),
      latestScreenshotPath,
      browserReleased,
      clientClosed,
      profileStateSaved: profileSaved,
      errorCode:
        runtimeFailure?.code ??
        (result ? result.errorCode : "AGENT_RUNTIME_FAILED"),
      errorMessage:
        runtimeFailure?.message ??
        (result
          ? result.errorMessage
          : "The agent did not produce a terminal result."),
    })
  }

  const completed = repository.getJob(id)
  if (!completed) throw new Error("The cancellation job could not be read.")
  return toPublicAgentJob(completed, repository)
}
