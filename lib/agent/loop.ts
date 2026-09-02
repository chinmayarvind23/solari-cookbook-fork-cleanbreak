import { createHash } from "node:crypto"

import type { AgentConfig } from "@/lib/agent/config"
import type { ApprovalContext } from "@/lib/agent/approval"
import { evaluateActionPolicy, proposedActionFrom } from "@/lib/agent/policy"
import type { ObservedPage } from "@/lib/agent/observer"
import type { AgentRepository } from "@/lib/agent/repository"
import type {
  AgentMetrics,
  AgentStep,
  CancellationJobState,
  PageObservation,
  PlannerResult,
  ProposedAction,
} from "@/lib/agent/types"

export type AgentLoopResult = {
  state: Extract<CancellationJobState, "AWAITING_APPROVAL" | "FAILED">
  metrics: AgentMetrics
  proposedAction: ProposedAction | null
  errorCode: string | null
  errorMessage: string | null
}

type LoopDependencies = {
  jobId: string
  config: Pick<AgentConfig, "maxSteps" | "minConfidence">
  allowedOrigin: string
  repository: Pick<AgentRepository, "addStep" | "saveProposedAction">
  observe(): Promise<ObservedPage>
  plan(observation: PageObservation, progress: string[]): Promise<PlannerResult>
  execute(
    observed: ObservedPage,
    decision: PlannerResult["decision"],
  ): Promise<void>
  capture(step: number): Promise<string | null>
  now?: () => Date
  approvalContext?: ApprovalContext
}

function fingerprint(observation: PageObservation): string {
  const stable = JSON.stringify({
    url: observation.url,
    title: observation.title,
    headings: observation.headings,
    text: observation.visibleText,
    actions: observation.actions.map(({ id: _id, ...action }) => action),
  })
  return createHash("sha256").update(stable).digest("hex")
}

function emptyMetrics(): AgentMetrics {
  return {
    steps: 0,
    retentionsEncountered: 0,
    retentionsRejected: 0,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    policyBlocks: 0,
    unsafeActionsExecuted: 0,
    durationMs: 0,
  }
}

function safePlannerFailure(error: unknown) {
  const code =
    error instanceof Error &&
    ["OPENAI_REQUEST_FAILED", "OPENAI_INVALID_DECISION"].includes(error.name)
      ? error.name
      : "AGENT_PLANNER_FAILED"
  return {
    code,
    message:
      error instanceof Error && error.message
        ? error.message
        : "The planner failed safely.",
  }
}

export async function runAgentLoop(
  dependencies: LoopDependencies,
): Promise<AgentLoopResult> {
  const now = dependencies.now ?? (() => new Date())
  const startedAt = now().getTime()
  const metrics = emptyMetrics()
  const progress: string[] = []
  const seenRetention = new Set<string>()
  const fingerprints = new Map<string, number>()

  const finish = (
    state: AgentLoopResult["state"],
    errorCode: string | null,
    errorMessage: string | null,
    proposedAction: ProposedAction | null = null,
  ): AgentLoopResult => ({
    state,
    metrics: {
      ...metrics,
      durationMs: Math.max(0, now().getTime() - startedAt),
    },
    proposedAction,
    errorCode,
    errorMessage,
  })

  for (
    let stepNumber = 1;
    stepNumber <= dependencies.config.maxSteps;
    stepNumber += 1
  ) {
    const stepStarted = now().getTime()
    let observed: ObservedPage
    try {
      observed = await dependencies.observe()
    } catch {
      return finish(
        "FAILED",
        "AGENT_OBSERVATION_FAILED",
        "The current page could not be observed safely.",
      )
    }

    const pageFingerprint = fingerprint(observed.observation)
    const repeats = (fingerprints.get(pageFingerprint) ?? 0) + 1
    fingerprints.set(pageFingerprint, repeats)
    if (repeats >= 3) {
      return finish(
        "FAILED",
        "AGENT_LOOP_DETECTED",
        "The agent stopped after detecting a repeated page state.",
      )
    }

    for (const action of observed.observation.actions) {
      if (
        /claim .*off|accept (?:the )?offer|pause (?:my )?(?:membership|subscription)/i.test(
          action.name,
        )
      ) {
        seenRetention.add(action.name.toLowerCase())
      }
    }
    metrics.retentionsEncountered = seenRetention.size

    const screenshotPath = await dependencies
      .capture(stepNumber)
      .catch(() => null)
    let planned: PlannerResult
    metrics.modelCalls += 1
    try {
      planned = await dependencies.plan(observed.observation, progress)
    } catch (error) {
      const failure = safePlannerFailure(error)
      const failedStep: AgentStep = {
        id: crypto.randomUUID(),
        jobId: dependencies.jobId,
        stepNumber,
        observationId: observed.observation.id,
        observedAt: observed.observation.observedAt,
        url: observed.observation.url,
        title: observed.observation.title,
        actionType: null,
        targetId: null,
        targetRole: null,
        targetName: null,
        reasoning: null,
        confidence: null,
        risk: null,
        policyResult: "ERROR",
        policyReason: failure.code,
        screenshotPath,
        durationMs: Math.max(0, now().getTime() - stepStarted),
      }
      dependencies.repository.addStep(failedStep)
      metrics.steps = stepNumber
      return finish("FAILED", failure.code, failure.message)
    }
    metrics.inputTokens += planned.usage.inputTokens
    metrics.outputTokens += planned.usage.outputTokens

    const policy = evaluateActionPolicy({
      decision: planned.decision,
      observation: observed.observation,
      allowedOrigin: dependencies.allowedOrigin,
      minConfidence: dependencies.config.minConfidence,
    })
    const step: AgentStep = {
      id: crypto.randomUUID(),
      jobId: dependencies.jobId,
      stepNumber,
      observationId: observed.observation.id,
      observedAt: observed.observation.observedAt,
      url: observed.observation.url,
      title: observed.observation.title,
      actionType: planned.decision.type,
      targetId: planned.decision.targetId,
      targetRole: policy.target?.role ?? null,
      targetName: policy.target?.name ?? null,
      reasoning: planned.decision.reasoning,
      confidence: planned.decision.confidence,
      risk: policy.risk,
      policyResult: policy.result,
      policyReason: policy.reason,
      screenshotPath,
      durationMs: Math.max(0, now().getTime() - stepStarted),
    }
    dependencies.repository.addStep(step)
    metrics.steps = stepNumber

    if (policy.result === "INTERCEPT" && policy.target) {
      const proposed = proposedActionFrom(
        observed.observation,
        policy.target,
        screenshotPath,
        dependencies.approvalContext,
      )
      dependencies.repository.saveProposedAction(dependencies.jobId, proposed)
      return finish("AWAITING_APPROVAL", null, null, proposed)
    }
    if (policy.result === "BLOCK") {
      metrics.policyBlocks += 1
      return finish(
        "FAILED",
        policy.reason,
        "The proposed browser action was blocked by the deterministic policy.",
      )
    }

    try {
      await dependencies.execute(observed, planned.decision)
    } catch {
      return finish(
        "FAILED",
        "AGENT_ACTION_FAILED",
        "An allowed browser action could not be completed.",
      )
    }
    if (/no thanks|reject offer/i.test(policy.target?.name ?? "")) {
      metrics.retentionsRejected += 1
    }
    progress.push(
      `${planned.decision.type}:${policy.target?.name ?? planned.decision.url ?? "page"}`,
    )
  }

  return finish(
    "FAILED",
    "AGENT_MAX_STEPS_EXCEEDED",
    "The agent stopped at the configured step limit.",
  )
}
